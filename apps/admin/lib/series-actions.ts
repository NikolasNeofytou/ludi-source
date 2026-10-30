'use server';

import { revalidatePath } from 'next/cache';

import { requireVenueAccess } from '@/lib/auth';
import { getCopy, type AdminCopy } from '@/lib/copy';
import { invalid } from '@/lib/form-errors';
import { SeriesCreate, SeriesEnd, type FormState } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';

// Standing bookings (plans/standing-bookings.md, ADR-0033). Both writes are
// definer RPCs gated on venue ownership inside the database — owners cannot
// insert bookings directly — and they write their own audit rows. These
// actions only validate the form, call, and turn the codes into sentences.

function rpcError(
  error: { code?: string; message: string },
  what: 'book' | 'end',
  t: AdminCopy['actions']['series'],
): FormState {
  if (error.code === '42501') {
    return { status: 'error', message: what === 'book' ? t.notYoursBook : t.notYoursEnd };
  }
  if (error.code === '23514') {
    return {
      status: 'error',
      message: error.message.includes('SERIES_PITCH_VENUE_MISMATCH')
        ? t.pickCourtsHere
        : t.outOfRange,
    };
  }
  console.error(`series ${what} failed:`, error.code, error.message);
  return { status: 'error', message: t.saveFailed };
}

export async function createSeries(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireVenueAccess();
  const { locale } = viewer;
  const t = getCopy(locale).actions.series;

  const parsed = SeriesCreate.safeParse({
    venue_id: formData.get('venue_id'),
    name: formData.get('name'),
    phone: formData.get('phone'),
    pitch_ids: formData.getAll('pitch_ids'),
    weekdays: formData.getAll('weekdays'),
    starts_time: formData.get('starts_time'),
    duration_minutes: formData.get('duration_minutes'),
    starts_on: formData.get('starts_on'),
    ends_on: formData.get('ends_on'),
    contact_id: formData.get('contact_id'),
  });
  if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors, locale);
  const s = parsed.data;
  if (!viewer.isAdmin && !viewer.venues.some((v) => v.id === s.venue_id)) {
    return { status: 'error', message: t.notYoursBook };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_booking_series', {
    p_venue_id: s.venue_id,
    p_name: s.name,
    p_phone: s.phone,
    p_pitch_ids: s.pitch_ids,
    p_weekdays: s.weekdays,
    p_starts_time: s.starts_time,
    p_duration_minutes: s.duration_minutes,
    p_starts_on: s.starts_on,
    p_ends_on: s.ends_on,
    p_contact_id: s.contact_id,
  });
  if (error) return rpcError(error, 'book', t);

  revalidatePath('/standing');
  revalidatePath('/calendar');
  revalidatePath('/');
  return { status: 'success', message: t.created(s.name, String(data).slice(0, 8)) };
}

export async function endSeries(_prev: FormState, formData: FormData): Promise<FormState> {
  const { locale } = await requireVenueAccess();
  const t = getCopy(locale).actions.series;

  const parsed = SeriesEnd.safeParse({
    series_id: formData.get('series_id'),
    ends_on: formData.get('ends_on'),
  });
  if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors, locale);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('end_booking_series', {
    p_series_id: parsed.data.series_id,
    p_ends_on: parsed.data.ends_on,
  });
  if (error) return rpcError(error, 'end', t);

  revalidatePath('/standing');
  revalidatePath('/calendar');
  revalidatePath('/');
  const n = Number(data ?? 0);
  return { status: 'success', message: n === 0 ? t.endedNone : t.endedReleased(n) };
}
