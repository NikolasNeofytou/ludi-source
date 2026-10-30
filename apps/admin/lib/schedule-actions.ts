'use server';

import { revalidatePath } from 'next/cache';

import { audit } from '@/lib/audit';
import { requireVenueAccess, type Viewer } from '@/lib/auth';
import { getCopy, type AdminCopy, type Locale } from '@/lib/copy';
import { invalid } from '@/lib/form-errors';
import { venueDateKey, venueToday } from '@/lib/format';
import { rosterByBookingId, type RosterRow } from '@/lib/roster';
import {
  OverrideCreate,
  ScheduleRowRef,
  ScheduleWindowCreate,
  ScheduleWindowUpdate,
  dayOfWeekOfKey,
  defaultSlotMinutes,
  type FormState,
} from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';

// Schedule editor actions (M6 #41f).
//
// The whole point of this file is the refusal. get_available_slots subtracts
// bookings from availability; nothing subtracts availability from bookings.
// So closing a Saturday leaves a PAID booking pointing at a shut pitch —
// no slot released, nobody notified, a player at a locked gate.
//
// Cancelling those bookings automatically is not on the table: it moves
// money, which belongs to admin-refund-booking with its audit row and its
// required reason. So an availability edit that would strand a booking is
// REFUSED, and the message names what is in the way.
//
// Every read and write below is scoped to (id, pitch_id), not id alone.
// assertOwnsPitch vouches for the pitch_id in the form; without the scope a
// row id from someone else's pitch would ride along on that vouching.

type Booking = {
  id: string;
  code: string;
  starts_at: string;
  ends_at: string;
  state: string;
};

// Every message below is picked from the account's dictionary (ADR-0037):
// `words(viewer)` is the schedule vocabulary in the caller's language.
type Words = AdminCopy['actions']['schedule'];
const words = (viewer: Viewer): Words => getCopy(viewer.locale).actions.schedule;

// What an owner sees when something failed that they cannot fix by
// changing the form. The raw database error goes to the server log, never
// to the page — it means nothing to an owner and can leak schema detail.
function saveFailed(locale: Locale): FormState {
  return { status: 'error', message: getCopy(locale).actions.saveFailed };
}

function unexpected(context: string, error: unknown, locale: Locale): FormState {
  console.error(`[schedule] ${context}:`, error);
  return saveFailed(locale);
}

async function collisionError(
  supabase: SupabaseClient,
  bookings: Booking[],
  what: string,
  t: Words,
): Promise<FormState> {
  const n = bookings.length;
  const codes = bookings.slice(0, 5).map((b) => b.code).join(', ');
  const more = n > 5 ? t.andMore(n - 5) : '';

  // "Cancel them first" was a dead end for app bookings: an owner can
  // un-book a walk-in, but an app booking has a player's money behind it
  // and only Ludi can move or refund it. So the way out depends on where
  // each booking came from. If the lookup fails, every booking counts as
  // an app booking — pointing an owner at Ludi is never wrong, pointing
  // them at a Cancel button that isn't there is.
  let origins = new Map<string, RosterRow>();
  try {
    origins = await rosterByBookingId(
      supabase,
      bookings.map((b) => b.id),
    );
  } catch (e) {
    console.error('[schedule] collision origin lookup failed:', e);
  }
  const walkIns = bookings.filter((b) => origins.get(b.id)?.origin === 'walk_in').length;
  const fromApp = n - walkIns;

  let wayOut: string;
  if (fromApp === 0) {
    wayOut = t.wayOutCancel(n);
  } else if (walkIns === 0) {
    wayOut = t.wayOutApp(n);
  } else {
    wayOut = t.wayOutMixed(walkIns, fromApp);
  }

  // The refusal stays a hard block; the link makes it actionable (#41k):
  // it lands on /bookings filtered to the venue-local days the clashes fall
  // on, where the walk-in cancel is one click away and the app bookings can
  // be read off for the email.
  const days = bookings.map((b) => venueDateKey(new Date(b.starts_at))).sort();
  const from = days[0];
  const to = days[days.length - 1];
  return {
    status: 'error',
    message: t.collision({ n, codes, more, what, wayOut }),
    link: {
      href: `/bookings?from=${from}&to=${to}`,
      label: n === 1 ? t.viewBooking : t.viewBookings,
    },
  };
}

async function pitchVenueId(
  supabase: SupabaseClient,
  pitchId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('pitches')
    .select('venue_id')
    .eq('id', pitchId)
    .maybeSingle<{ venue_id: string }>();
  return data?.venue_id ?? null;
}

// `pitches` is publicly readable when bookable, so loading the row proves
// nothing about the caller. Same check the RLS write policy makes, surfaced
// as a sentence instead of an opaque 42501.
async function assertOwnsPitch(
  supabase: SupabaseClient,
  viewer: Viewer,
  pitchId: string,
): Promise<FormState | null> {
  if (viewer.isAdmin) return null;
  const venueId = await pitchVenueId(supabase, pitchId);
  if (!venueId || !viewer.venues.some((v) => v.id === venueId)) {
    return { status: 'error', message: getCopy(viewer.locale).actions.pitchNotYours };
  }
  return null;
}

// null = the check itself failed (logged). The caller refuses the change:
// an edit we could not check is an edit we cannot promise is safe.
async function bookingsInWeeklyWindow(
  supabase: SupabaseClient,
  pitchId: string,
  dayOfWeek: number,
  opensAt: string,
  closesAt: string,
): Promise<Booking[] | null> {
  const { data, error } = await supabase.rpc('bookings_in_weekly_window', {
    p_pitch_id: pitchId,
    p_day_of_week: dayOfWeek,
    p_opens_at: opensAt,
    p_closes_at: closesAt,
  });
  if (error) {
    console.error('[schedule] bookings_in_weekly_window failed:', error);
    return null;
  }
  return (data ?? []) as Booking[];
}

// Every exception change goes through one question: which bookings on that
// date would sit outside the day's hours AFTERWARDS? An exception REPLACES
// the day's weekly hours (#41a) and a date may hold several windows (#41b),
// so neither "the new window alone" nor "removing can only add hours back"
// is the right test. Asked of the database, which resolves the precedence
// exactly as get_available_slots does (and owns the Nicosia arithmetic).
async function bookingsStrandedByOverrideChange(
  supabase: SupabaseClient,
  args: {
    pitchId: string;
    date: string;
    removeOverrideId?: string;
    add?: { isClosed: boolean; opensAt: string | null; closesAt: string | null };
  },
): Promise<Booking[] | null> {
  const { data, error } = await supabase.rpc('bookings_stranded_by_override_change', {
    p_pitch_id: args.pitchId,
    p_date: args.date,
    p_remove_override_id: args.removeOverrideId ?? null,
    p_add_is_closed: args.add ? args.add.isClosed : null,
    p_add_opens_at: args.add?.opensAt ?? null,
    p_add_closes_at: args.add?.closesAt ?? null,
  });
  if (error) {
    console.error('[schedule] bookings_stranded_by_override_change failed:', error);
    return null;
  }
  return (data ?? []) as Booking[];
}

// Known database refusals become sentences; anything else is logged and
// shown as the generic save failure.
function fail(
  context: string,
  error: { code?: string; message: string },
  viewer: Viewer,
  kind: 'window' | 'exception' = 'window',
): FormState {
  const t = words(viewer);
  // 23P01 is the exclusion constraint from #41b — two windows overlapping,
  // or, for exceptions, a closure and an open window on the same date.
  if (error.code === '23P01') {
    return {
      status: 'error',
      message: kind === 'window' ? t.overlapWindow : t.overlapException,
    };
  }
  if (error.code === '42501') {
    return { status: 'error', message: getCopy(viewer.locale).actions.notYours };
  }
  if (error.code === '23514') {
    return { status: 'error', message: t.timesOutside };
  }
  // The database's own stranding guard. The checks in this file run first,
  // so this only fires when a booking landed between our check and our
  // write — the page the owner is looking at is already out of date.
  if (
    error.code === 'P0001' &&
    error.message.startsWith('SCHEDULE_CHANGE_STRANDS_BOOKINGS')
  ) {
    return { status: 'error', message: t.wouldStrand };
  }
  return unexpected(context, error, viewer.locale);
}

function revalidate(pitchId: string) {
  revalidatePath(`/pitches/${pitchId}/schedule`);
  revalidatePath('/pitches');
}

// ── Weekly windows ───────────────────────────────────────────────────

export async function addScheduleWindow(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const viewer = await requireVenueAccess();
  const t = words(viewer);
  const parsed = ScheduleWindowCreate.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors, viewer.locale);

  const supabase = await createClient();
  const denied = await assertOwnsPitch(supabase, viewer, parsed.data.pitch_id);
  if (denied) return denied;

  // Adding availability can never strand a booking, so no collision check.
  const { error } = await supabase.from('pitch_schedules').insert(parsed.data);
  if (error) return fail('add window', error, viewer);

  const { pitch_id, day_of_week, opens_at, closes_at } = parsed.data;
  await audit(supabase, viewer, {
    action_type: 'schedule_change',
    target_type: 'pitch',
    target_id: pitch_id,
    reason: `added weekly window ${opens_at}–${closes_at} (day ${day_of_week})`,
    payload: { kind: 'add_window', day_of_week, opens_at, closes_at },
  });

  revalidate(parsed.data.pitch_id);
  return { status: 'success', message: t.windowAdded };
}

export async function updateScheduleWindow(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const viewer = await requireVenueAccess();
  const t = words(viewer);
  const parsed = ScheduleWindowUpdate.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors, viewer.locale);

  const { id, pitch_id, opens_at, closes_at, slot_duration_minutes } = parsed.data;

  const supabase = await createClient();
  const denied = await assertOwnsPitch(supabase, viewer, pitch_id);
  if (denied) return denied;

  const { data: existing, error: loadError } = await supabase
    .from('pitch_schedules')
    .select('day_of_week, opens_at, closes_at')
    .eq('id', id)
    .eq('pitch_id', pitch_id)
    .maybeSingle<{ day_of_week: number; opens_at: string; closes_at: string }>();
  if (loadError) return fail('load window', loadError, viewer);
  if (!existing) return { status: 'error', message: t.windowGone };

  // The day comes from the stored row, never the form: this edit changes
  // hours, and the collision check below must ask about the day the window
  // is actually on.
  const day_of_week = existing.day_of_week;

  // Only the REMOVED slivers can strand anything. Shrinking 23:00 → 22:00
  // endangers 22:00–23:00, not the whole evening — checking the entire new
  // window would refuse edits that are perfectly safe, and an editor that
  // cries wolf is one people learn to route around. ('24:00' sorts after
  // every other 'HH:MM', so a midnight close compares correctly as text.)
  const oldOpen = existing.opens_at.slice(0, 5);
  const oldClose = existing.closes_at.slice(0, 5);
  const removed: Array<[string, string]> = [];
  if (opens_at > oldOpen) removed.push([oldOpen, opens_at]);
  if (closes_at < oldClose) removed.push([closes_at, oldClose]);

  for (const [from, to] of removed) {
    const clashes = await bookingsInWeeklyWindow(
      supabase,
      pitch_id,
      day_of_week,
      from,
      to,
    );
    if (!clashes) return saveFailed(viewer.locale);
    if (clashes.length) {
      return collisionError(supabase, clashes, t.hoursRemoving(from, to), t);
    }
  }

  const { data: updated, error } = await supabase
    .from('pitch_schedules')
    .update({ opens_at, closes_at, slot_duration_minutes })
    .eq('id', id)
    .eq('pitch_id', pitch_id)
    .select('id');
  if (error) return fail('update window', error, viewer);
  if (!updated?.length) return { status: 'error', message: t.windowGone };

  await audit(supabase, viewer, {
    action_type: 'schedule_change',
    target_type: 'pitch',
    target_id: pitch_id,
    reason: `changed weekly window to ${opens_at}–${closes_at} (day ${day_of_week})`,
    payload: {
      kind: 'update_window',
      day_of_week,
      opens_at,
      closes_at,
      was: { opens_at: oldOpen, closes_at: oldClose },
    },
  });

  revalidate(pitch_id);
  return { status: 'success', message: t.windowUpdated };
}

export async function deleteScheduleWindow(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const viewer = await requireVenueAccess();
  const t = words(viewer);
  const ref = ScheduleRowRef.safeParse(Object.fromEntries(formData));
  if (!ref.success) return { status: 'error', message: t.windowGone };
  const { id, pitch_id: pitchId } = ref.data;

  const supabase = await createClient();
  const denied = await assertOwnsPitch(supabase, viewer, pitchId);
  if (denied) return denied;

  const { data: existing, error: loadError } = await supabase
    .from('pitch_schedules')
    .select('day_of_week, opens_at, closes_at')
    .eq('id', id)
    .eq('pitch_id', pitchId)
    .maybeSingle<{ day_of_week: number; opens_at: string; closes_at: string }>();
  if (loadError) return fail('load window', loadError, viewer);
  if (!existing) return { status: 'error', message: t.windowGone };

  const clashes = await bookingsInWeeklyWindow(
    supabase,
    pitchId,
    existing.day_of_week,
    existing.opens_at.slice(0, 5),
    existing.closes_at.slice(0, 5),
  );
  if (!clashes) return saveFailed(viewer.locale);
  if (clashes.length) return collisionError(supabase, clashes, t.thisWindow, t);

  const { data: removed, error } = await supabase
    .from('pitch_schedules')
    .delete()
    .eq('id', id)
    .eq('pitch_id', pitchId)
    .select('id');
  if (error) return fail('delete window', error, viewer);
  if (!removed?.length) return { status: 'error', message: t.windowGone };

  await audit(supabase, viewer, {
    action_type: 'schedule_change',
    target_type: 'pitch',
    target_id: pitchId,
    reason:
      `removed weekly window ${existing.opens_at.slice(0, 5)}–` +
      `${existing.closes_at.slice(0, 5)} (day ${existing.day_of_week})`,
    payload: { kind: 'delete_window', ...existing },
  });

  revalidate(pitchId);
  return { status: 'success', message: t.windowRemoved };
}

// ── Date overrides ───────────────────────────────────────────────────

export async function addOverride(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const viewer = await requireVenueAccess();
  const t = words(viewer);
  const parsed = OverrideCreate.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors, viewer.locale);

  const { pitch_id, override_date, is_closed, reason } = parsed.data;

  // The page only lists exceptions from today on, so one saved for a past
  // date would be accepted and then never seen again. "Today" is Nicosia's,
  // not the server's UTC date — the two disagree for the first two or three
  // hours of every Cyprus day.
  if (override_date < venueToday()) {
    return {
      status: 'error',
      message: getCopy(viewer.locale).actions.checkFields,
      fieldErrors: { override_date: [t.todayOrLater] },
    };
  }

  const supabase = await createClient();
  const denied = await assertOwnsPitch(supabase, viewer, pitch_id);
  if (denied) return denied;

  // A closure strands everything on the date. An open window REPLACES the
  // day's weekly hours, so a booking outside the date's windows is stranded
  // even though the day stays open — but a booking inside another window
  // the date already has is not (split exception days, #41b).
  const stranded = await bookingsStrandedByOverrideChange(supabase, {
    pitchId: pitch_id,
    date: override_date,
    add: {
      isClosed: is_closed,
      opensAt: is_closed ? null : (parsed.data.opens_at ?? null),
      closesAt: is_closed ? null : (parsed.data.closes_at ?? null),
    },
  });
  if (!stranded) return saveFailed(viewer.locale);
  if (stranded.length) {
    return collisionError(
      supabase,
      stranded,
      is_closed ? `${override_date}` : t.dateHoursAfterSave(override_date),
      t,
    );
  }

  // The form sends a slot length with special hours. When it doesn't (a
  // closure — no slots either way), default to what the pitch sells on
  // that weekday rather than a flat 60.
  let slot_duration_minutes = parsed.data.slot_duration_minutes;
  if (slot_duration_minutes === undefined) {
    const { data: weekly, error: weeklyError } = await supabase
      .from('pitch_schedules')
      .select('day_of_week, slot_duration_minutes')
      .eq('pitch_id', pitch_id);
    if (weeklyError) console.error('[schedule] weekly slot lookup failed:', weeklyError);
    slot_duration_minutes = defaultSlotMinutes(weekly ?? [], dayOfWeekOfKey(override_date));
  }

  const { error } = await supabase.from('pitch_schedule_overrides').insert({
    pitch_id,
    override_date,
    is_closed,
    reason,
    opens_at: is_closed ? null : parsed.data.opens_at,
    closes_at: is_closed ? null : parsed.data.closes_at,
    slot_duration_minutes,
  });
  if (error) return fail('add exception', error, viewer, 'exception');

  await audit(supabase, viewer, {
    action_type: 'override_change',
    target_type: 'pitch',
    target_id: pitch_id,
    reason: is_closed
      ? `closed ${override_date}${reason ? ` — ${reason}` : ''}`
      : `special hours ${parsed.data.opens_at}–${parsed.data.closes_at} on ${override_date}`,
    payload: {
      kind: 'add_override',
      override_date,
      is_closed,
      opens_at: is_closed ? null : parsed.data.opens_at,
      closes_at: is_closed ? null : parsed.data.closes_at,
      slot_duration_minutes,
    },
  });

  revalidate(pitch_id);
  return { status: 'success', message: t.exceptionSaved };
}

export async function deleteOverride(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const viewer = await requireVenueAccess();
  const t = words(viewer);
  const ref = ScheduleRowRef.safeParse(Object.fromEntries(formData));
  if (!ref.success) return { status: 'error', message: t.exceptionGone };
  const { id, pitch_id: pitchId } = ref.data;

  const supabase = await createClient();
  const denied = await assertOwnsPitch(supabase, viewer, pitchId);
  if (denied) return denied;

  // Removing an exception does NOT only add hours back. The exception
  // replaced the day, so what comes back is the date's other exception
  // windows or, if this was the last one, the weekly hours — which may be
  // narrower or none at all (a normally-closed Sunday opened specially).
  // A booking taken during the exception would be stranded.
  const { data: target, error: targetError } = await supabase
    .from('pitch_schedule_overrides')
    .select('override_date')
    .eq('id', id)
    .eq('pitch_id', pitchId)
    .maybeSingle<{ override_date: string }>();
  if (targetError) return fail('load exception', targetError, viewer, 'exception');
  if (!target) return { status: 'error', message: t.exceptionGone };

  const stranded = await bookingsStrandedByOverrideChange(supabase, {
    pitchId,
    date: target.override_date,
    removeOverrideId: id,
  });
  if (!stranded) return saveFailed(viewer.locale);
  if (stranded.length) {
    return collisionError(supabase, stranded, t.dateHoursAfterRemove(target.override_date), t);
  }

  const { data: removed, error } = await supabase
    .from('pitch_schedule_overrides')
    .delete()
    .eq('id', id)
    .eq('pitch_id', pitchId)
    .select('override_date');
  if (error) return fail('delete exception', error, viewer, 'exception');
  if (!removed?.length) {
    return { status: 'error', message: t.exceptionGone };
  }

  await audit(supabase, viewer, {
    action_type: 'override_change',
    target_type: 'pitch',
    target_id: pitchId,
    reason: `removed the exception on ${target.override_date}`,
    payload: { kind: 'delete_override', override_date: target.override_date },
  });

  revalidate(pitchId);
  return { status: 'success', message: t.exceptionRemoved };
}
