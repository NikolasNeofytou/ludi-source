'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { audit } from '@/lib/audit';
import { requireAdmin, requireVenueAccess, type Viewer } from '@/lib/auth';
import { syncComponents } from '@/lib/components';
import { getCopy, type Locale } from '@/lib/copy';
import { invalid, toFormError } from '@/lib/form-errors';
import {
  PitchComponents,
  PitchFields,
  PitchUpdate,
  RowId,
  VenueAdminUpdate,
  VenueCreate,
  VenueOwnerUpdate,
  toCents,
  toCoords,
  type FormState,
} from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';

// Server actions for the #41e forms.
//
// These run on the server with the CALLER's cookies, so the Supabase client
// they build carries the caller's JWT and every write lands under their own
// RLS policies. That is the point: an action is not a privileged context.
// Nothing here uses the service-role key, and nothing should — the moment
// it does, RLS stops being the boundary ADR-0019 relies on.
//
// The enrolment flow's actions live in enrol-actions.ts and share the error
// mapping in form-errors.ts.

// A write RLS silently filtered out. PostgREST reports an UPDATE that
// matched no visible row as success with zero rows, so without this a save
// the database refused would still say "saved".
function notSaved(what: 'venue' | 'pitch', locale: Locale): FormState {
  const t = getCopy(locale).actions;
  return { status: 'error', message: what === 'venue' ? t.notSavedVenue : t.notSavedPitch };
}

// Stored coordinates come back as floats; the form posts them at 6 dp
// (≈ 0.1 m). Anything closer than that is the same point, re-serialised.
const COORD_EPSILON = 1e-6;
function sameCoord(a: number | null | undefined, b: number): boolean {
  return a != null && Math.abs(a - b) < COORD_EPSILON;
}

// An owner may only ever act on a venue they actually own. RLS enforces
// this too, but a WITH CHECK failure surfaces as an opaque 42501 — this
// turns it into a sentence, and stops a mistyped hidden field from looking
// like a permissions bug.
function ownsVenue(viewer: Viewer, venueId: string): boolean {
  return viewer.isAdmin || viewer.venues.some((v) => v.id === venueId);
}

// ── Venues ───────────────────────────────────────────────────────────

export async function createVenue(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const viewer = await requireAdmin(); // creating a venue is a platform act — ADR-0019

  const parsed = VenueCreate.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors);

  const { lat, lng, ...rest } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('venues')
    .insert({ ...rest, coords: toCoords(lng, lat) })
    .select('id')
    .single();

  if (error) return toFormError(error);

  await audit(supabase, viewer, {
    action_type: 'create_venue',
    target_type: 'venue',
    target_id: data.id,
    reason: `created venue "${parsed.data.name}"`,
  });

  revalidatePath('/venues');
  redirect(`/venues?created=${data.id}`);
}

export async function updateVenue(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const viewer = await requireVenueAccess();
  const { locale } = viewer;
  const t = getCopy(locale).actions;

  const idParsed = RowId.safeParse(formData.get('id'));
  if (!idParsed.success) return notSaved('venue', locale);
  const id = idParsed.data;
  if (!ownsVenue(viewer, id)) {
    return { status: 'error', message: t.venueNotYours };
  }

  // The admin parse accepts the commercial fields; the owner parse has no
  // such keys, so an owner who posts `take_rate_bps` by hand has it dropped
  // here — before the database has to refuse it.
  const schema = viewer.isAdmin ? VenueAdminUpdate : VenueOwnerUpdate;
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors, locale);

  const { lat, lng, ...rest } = parsed.data;
  const supabase = await createClient();

  // Only write the pin if it moved. The form always posts coordinates, so
  // an owner fixing a phone number would otherwise re-round the stored
  // point to 6 dp on every save, and the audit row would claim the venue
  // was relocated each time.
  const { data: stored, error: loadError } = await supabase
    .from('venues')
    .select('lat, lng')
    .eq('id', id)
    .maybeSingle<{ lat: number | null; lng: number | null }>();
  if (loadError) return toFormError(loadError, locale);
  if (!stored) return notSaved('venue', locale);
  const moved = !sameCoord(stored.lat, lat) || !sameCoord(stored.lng, lng);

  const { data: saved, error } = await supabase
    .from('venues')
    .update(moved ? { ...rest, coords: toCoords(lng, lat) } : rest)
    .eq('id', id)
    .select('id');

  if (error) return toFormError(error, locale);
  if (!saved?.length) return notSaved('venue', locale);

  const fields = Object.keys(rest);
  await audit(supabase, viewer, {
    action_type: 'update_venue',
    target_type: 'venue',
    target_id: id,
    reason: 'venue details updated',
    payload: { fields: moved ? fields.concat('coords') : fields },
  });

  revalidatePath('/venues');
  revalidatePath(`/venues/${id}/edit`);
  return { status: 'success', message: t.venueSaved };
}

// ── Pitches ──────────────────────────────────────────────────────────

export async function createPitch(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const viewer = await requireVenueAccess();
  const { locale } = viewer;
  const t = getCopy(locale).actions;

  const parsed = PitchFields.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors, locale);

  const { venue_id, price_per_hour_eur, ...rest } = parsed.data;
  if (!ownsVenue(viewer, venue_id)) {
    return { status: 'error', message: t.onlyOwnVenue };
  }

  const supabase = await createClient();
  // `is_verified` is deliberately not sent. It defaults to false, and
  // tg_pitches_force_unverified_on_insert forces it false for a
  // non-privileged writer regardless — verification is a platform decision
  // made through admin-toggle-pitch (M3 #18).
  const { data, error } = await supabase
    .from('pitches')
    .insert({
      ...rest,
      venue_id,
      price_per_hour_cents: toCents(price_per_hour_eur),
    })
    .select('id')
    .single();

  if (error) return toFormError(error, locale);

  await audit(supabase, viewer, {
    action_type: 'create_pitch',
    target_type: 'pitch',
    target_id: data.id,
    reason: `created pitch "${parsed.data.name}"`,
    payload: { venue_id },
  });

  revalidatePath('/pitches');
  redirect(`/pitches?created=${data.id}`);
}

export async function updatePitch(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const viewer = await requireVenueAccess();
  const { locale } = viewer;
  const t = getCopy(locale).actions;

  const idParsed = RowId.safeParse(formData.get('id'));
  if (!idParsed.success) return notSaved('pitch', locale);
  const id = idParsed.data;

  const parsed = PitchUpdate.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors, locale);

  const supabase = await createClient();

  // Access is checked against the venue the pitch is ACTUALLY in, not a
  // venue the form claims — a hidden field is the caller's to rewrite.
  const { data: pitch, error: loadError } = await supabase
    .from('pitches')
    .select('venue_id')
    .eq('id', id)
    .maybeSingle<{ venue_id: string }>();
  if (loadError) return toFormError(loadError, locale);
  if (!pitch || !ownsVenue(viewer, pitch.venue_id)) {
    return { status: 'error', message: t.pitchNotYours };
  }

  const { price_per_hour_eur, ...rest } = parsed.data;
  // venue_id is intentionally NOT in the update payload. Moving a pitch
  // between venues is a data-integrity act, and the column guard rejects it
  // for a non-privileged writer anyway; sending it would turn a legitimate
  // no-op edit into a permissions error.
  const { data: saved, error } = await supabase
    .from('pitches')
    .update({ ...rest, price_per_hour_cents: toCents(price_per_hour_eur) })
    .eq('id', id)
    .select('id');

  if (error) return toFormError(error, locale);
  if (!saved?.length) return notSaved('pitch', locale);

  // What it is made of (ADR-0032). Only when the form carried the field —
  // the create form has no venue to offer leaves from, and must not wipe
  // a composition it never showed.
  let components: string[] | null = null;
  if (formData.has('has_components')) {
    const compParsed = PitchComponents.safeParse(formData.getAll('components'));
    if (!compParsed.success) return invalid({ components: [t.pickCourtsFromList] }, locale);
    components = compParsed.data.filter((c) => c !== id);
    const compError = await syncComponents(supabase, id, components);
    if (compError) return compError;
  }

  await audit(supabase, viewer, {
    action_type: 'update_pitch',
    target_type: 'pitch',
    target_id: id,
    reason: 'pitch details updated',
    payload: {
      venue_id: pitch.venue_id,
      fields: Object.keys(rest).concat('price_per_hour_cents'),
      ...(components ? { components } : {}),
    },
  });

  revalidatePath('/pitches');
  revalidatePath(`/pitches/${id}/edit`);
  return { status: 'success', message: t.pitchSaved };
}
