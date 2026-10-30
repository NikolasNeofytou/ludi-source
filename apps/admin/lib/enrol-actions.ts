'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { audit } from '@/lib/audit';
import { requireAdmin } from '@/lib/auth';
import { invalid, invalidDeep, toFormError } from '@/lib/form-errors';
// (composites: see enrolCourts)
import { rowsFromFormData } from '@/lib/form-rows';
import {
  EnableCity,
  EnrolCourts,
  EnrolHours,
  EnrolPublish,
  EnrolVenue,
  toCents,
  toCoords,
  type FormState,
} from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';

// The counter flow (plans/venue-enrol.md, ADR-0031). Admin only, every
// step: creating a venue and granting its owner are platform acts
// (ADR-0019), and the flow is the founder's, not the owner's.
//
// Each step writes ONE statement, so it is all-or-nothing, and audits one
// row per thing created with the same vocabulary the standalone forms use.
// No step stores "where the flow is" — that is read from the rows.

export async function enrolVenue(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const viewer = await requireAdmin();

  const parsed = EnrolVenue.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors);

  const { lat, lng, ...rest } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('venues')
    .insert({ ...rest, coords: toCoords(lng, lat), is_active: false })
    .select('id')
    .single();
  if (error) return toFormError(error);

  await audit(supabase, viewer, {
    action_type: 'create_venue',
    target_type: 'venue',
    target_id: data.id,
    reason: `created venue "${parsed.data.name}" (enrolment, inactive)`,
  });

  revalidatePath('/venues');
  redirect(`/venues/${data.id}/enrol/courts`);
}

export async function enrolCourts(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const viewer = await requireAdmin();

  const parsed = EnrolCourts.safeParse({
    venue_id: formData.get('venue_id'),
    courts: rowsFromFormData(formData, 'courts'),
  });
  if (!parsed.success) return invalidDeep(parsed.error);

  const { venue_id, courts } = parsed.data;
  const supabase = await createClient();

  // A row with a count expands into numbered courts; a row that names what
  // it is made of is a composite (ADR-0032). Leaves go in first, in one
  // statement; composites second, then their make-up — resolved by name
  // against the leaves just inserted and any already at the venue.
  const leaves = courts
    .filter((c) => c.made_of.length === 0)
    .flatMap((c) => expandRow(c.name, c.count).map((name) => ({ ...c, name })));
  const composites = courts.filter((c) => c.made_of.length > 0);
  for (const [i, c] of courts.entries()) {
    if (c.made_of.length > 0 && c.count !== 1) {
      return invalid({ [`courts.${i}.count`]: ['A court made of others is one court'] });
    }
  }

  const toRow = (c: { name: string; type: string; surface: string; price_per_hour_eur: number }) => ({
    venue_id,
    name: c.name,
    type: c.type,
    surface: c.surface,
    price_per_hour_cents: toCents(c.price_per_hour_eur),
  });

  // `is_verified` is not sent: it defaults false and two triggers keep it
  // there until the venue's Stripe account is active. Amenities are the
  // column's default (empty) — the owner adds them later if they care.
  const created: { id: string; name: string }[] = [];
  if (leaves.length) {
    const { data, error } = await supabase.from('pitches').insert(leaves.map(toRow)).select('id, name');
    if (error) return toFormError(error);
    created.push(...(data ?? []));
  }

  if (composites.length) {
    const { data: existing, error: existingError } = await supabase
      .from('pitches')
      .select('id, name')
      .eq('venue_id', venue_id);
    if (existingError) return toFormError(existingError);
    const byName = new Map<string, string>();
    for (const p of [...(existing ?? []), ...created]) byName.set(p.name.trim().toLowerCase(), p.id);

    for (const [i, c] of courts.entries()) {
      if (c.made_of.length === 0) continue;
      const unknown = c.made_of.filter((n) => !byName.has(n.trim().toLowerCase()));
      if (unknown.length) {
        return invalid({
          [`courts.${i}.made_of`]: [`No court called ${unknown.map((n) => `"${n}"`).join(', ')}`],
        });
      }
    }

    const { data: compRows, error: compError } = await supabase
      .from('pitches')
      .insert(composites.map(toRow))
      .select('id, name');
    if (compError) return toFormError(compError);
    created.push(...(compRows ?? []));

    const links = composites.flatMap((c) => {
      const parent = (compRows ?? []).find((r) => r.name === c.name);
      if (!parent) return [];
      return c.made_of.map((n) => ({
        parent_pitch_id: parent.id,
        child_pitch_id: byName.get(n.trim().toLowerCase())!,
      }));
    });
    const { error: linkError } = await supabase.from('pitch_components').insert(links);
    if (linkError) {
      return linkError.code === '23514'
        ? {
            status: 'error',
            message:
              'A court made of others can only use plain courts at this venue — not another composite.',
          }
        : toFormError(linkError);
    }
  }

  for (const pitch of created) {
    await audit(supabase, viewer, {
      action_type: 'create_pitch',
      target_type: 'pitch',
      target_id: pitch.id,
      reason: `created pitch "${pitch.name}" (enrolment)`,
      payload: { venue_id },
    });
  }

  revalidatePath('/pitches');
  redirect(`/venues/${venue_id}/enrol/hours`);
}

// "Court" × 3 → Court 1, Court 2, Court 3; "Court 4" × 2 → Court 4, Court 5.
// A single row keeps its name as typed.
function expandRow(name: string, count: number): string[] {
  if (count === 1) return [name];
  const m = /^(.*?)(\d+)\s*$/.exec(name);
  const base = m ? m[1]!.trimEnd() : name.trim();
  const start = m ? Number(m[2]) : 1;
  return Array.from({ length: count }, (_, k) => `${base} ${start + k}`);
}

export async function enrolHours(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const viewer = await requireAdmin();

  const parsed = EnrolHours.safeParse({
    venue_id: formData.get('venue_id'),
    slot_duration_minutes: formData.get('slot_duration_minutes'),
    days: rowsFromFormData(formData, 'days'),
  });
  if (!parsed.success) return invalidDeep(parsed.error);

  const { venue_id, slot_duration_minutes, days } = parsed.data;
  const supabase = await createClient();

  // Only courts with no hours yet. A court whose hours were already set —
  // by this step on an earlier visit, or by hand in the editor — keeps
  // them; the grid is a setup tool, not the hours editor (ADR-0031).
  const [{ data: pitches, error: pitchError }, { data: scheduled, error: schedError }] =
    await Promise.all([
      supabase.from('pitches').select('id, name').eq('venue_id', venue_id),
      supabase
        .from('pitch_schedules')
        .select('pitch_id, pitch:pitches!inner ( venue_id )')
        .eq('pitch.venue_id', venue_id),
    ]);
  if (pitchError) return toFormError(pitchError);
  if (schedError) return toFormError(schedError);

  const alreadySet = new Set((scheduled ?? []).map((s) => s.pitch_id as string));
  const targets = (pitches ?? []).filter((p) => !alreadySet.has(p.id));
  if (targets.length === 0) {
    return {
      status: 'error',
      message:
        (pitches ?? []).length === 0
          ? 'This venue has no courts yet — add them first.'
          : 'Every court already has hours. Change them per court from Pitches → Hours.',
    };
  }

  const open = days.filter((d) => !d.closed);
  const rows = targets.flatMap((p) =>
    open.map((d) => ({
      pitch_id: p.id,
      day_of_week: d.day_of_week,
      opens_at: d.opens_at!,
      closes_at: d.closes_at!,
      slot_duration_minutes,
    })),
  );

  const { error } = await supabase.from('pitch_schedules').insert(rows);
  if (error) {
    // 23P01 is the overlap exclusion from #41b. It cannot fire for a court
    // with no windows unless two grid rows share a day, which the form
    // prevents — so it means the page was stale. Say that.
    if (error.code === '23P01') {
      return {
        status: 'error',
        message: 'A court gained hours while this page was open. Reload and try again.',
      };
    }
    return toFormError(error);
  }

  const summary = open
    .map((d) => `${d.day_of_week}:${d.opens_at}–${d.closes_at}`)
    .join(' ');
  for (const p of targets) {
    await audit(supabase, viewer, {
      action_type: 'schedule_change',
      target_type: 'pitch',
      target_id: p.id,
      reason: `set weekly hours (enrolment) ${summary}`,
      payload: {
        kind: 'enrol_hours',
        slot_duration_minutes,
        days: open.map((d) => ({
          day_of_week: d.day_of_week,
          opens_at: d.opens_at,
          closes_at: d.closes_at,
        })),
      },
    });
  }

  revalidatePath('/pitches');
  redirect(`/venues/${venue_id}/enrol/owner`);
}

export async function publishVenue(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const viewer = await requireAdmin();

  const parsed = EnrolPublish.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors);
  const { venue_id } = parsed.data;

  const supabase = await createClient();
  const { data: saved, error } = await supabase
    .from('venues')
    .update({ is_active: true })
    .eq('id', venue_id)
    .select('id, name');
  if (error) return toFormError(error);
  if (!saved?.length) {
    return { status: 'error', message: 'That venue wasn’t found. Reload and try again.' };
  }

  await audit(supabase, viewer, {
    action_type: 'update_venue',
    target_type: 'venue',
    target_id: venue_id,
    reason: `published venue "${saved[0]!.name}" (enrolment)`,
    payload: { fields: ['is_active'] },
  });

  revalidatePath('/venues');
  revalidatePath(`/venues/${venue_id}/edit`);
  redirect(`/venues?created=${venue_id}`);
}

// A founder decision, taken where it arises. The Review page says "this
// city is not enabled for players"; this is the button under that line.
// One UPDATE under the caller's JWT — cities_admin_write has been admin-only
// since day one — scoped to NOT is_enabled so a double submit is a no-op,
// not a second audit row.
export async function enableCity(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const viewer = await requireAdmin();

  const parsed = EnableCity.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors);

  const { venue_id, city_id } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('cities')
    .update({ is_enabled: true })
    .eq('id', city_id)
    .eq('is_enabled', false)
    .select('code, name_en')
    .maybeSingle();
  if (error) return toFormError(error);
  if (!data) {
    return { status: 'error', message: 'That city is already enabled — reload the page.' };
  }

  await audit(supabase, viewer, {
    action_type: 'enable_city',
    target_type: 'city',
    target_id: city_id,
    reason: `enabled ${data.name_en} for players (enrolment review)`,
    payload: { code: data.code, venue_id },
  });

  revalidatePath('/venues');
  revalidatePath(`/venues/${venue_id}/enrol/review`);
  return {
    status: 'success',
    message: `${data.name_en} is on — players there can see published venues now.`,
  };
}
