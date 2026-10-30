'use server';

import { revalidatePath } from 'next/cache';

import { requireVenueAccess } from '@/lib/auth';
import { getCopy } from '@/lib/copy';
import { RowId } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';

// A comment on a booking (booking_notes, 20260917000001). The table's policy
// is the gate — the venue's owners and managers, and admins — so this only
// trims, bounds and picks upsert or delete. An empty comment clears it.

export type NoteResult = { ok: true; note: string | null } | { ok: false; message: string };

export async function saveBookingNote(bookingId: string, raw: string): Promise<NoteResult> {
  const { locale } = await requireVenueAccess();
  const t = getCopy(locale).calendar;
  if (!RowId.safeParse(bookingId).success) return { ok: false, message: t.commentFailed };
  const note = raw.trim().slice(0, 280);

  const supabase = await createClient();
  const { error } = note
    ? await supabase
        .from('booking_notes')
        .upsert({ booking_id: bookingId, note }, { onConflict: 'booking_id' })
    : await supabase.from('booking_notes').delete().eq('booking_id', bookingId);
  if (error) {
    console.error('booking note save failed:', error.code, error.message);
    return { ok: false, message: t.commentFailed };
  }

  revalidatePath('/calendar');
  return { ok: true, note: note || null };
}
