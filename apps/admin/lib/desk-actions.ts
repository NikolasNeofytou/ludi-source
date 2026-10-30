'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireVenueAccess } from '@/lib/auth';
import { getCopy } from '@/lib/copy';
import type { FormState } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';

// The booking desk (plans/whatsapp-desk.md, ADR-0046). Each write is one of
// the definer functions in 20261013000004, gated as its first statement
// (owner or manager of the venue); these turn a form into a call.

const PasteInput = z.object({
  venue_id: z.string().uuid(),
  sender_name: z.string().max(120),
  sender_phone: z.string().max(30),
  body: z.string().max(2000),
});

export async function pasteRequest(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireVenueAccess();
  const t = getCopy(viewer.locale).desk;
  const parsed = PasteInput.safeParse({
    venue_id: formData.get('venue_id'),
    sender_name: formData.get('sender_name') ?? '',
    sender_phone: formData.get('sender_phone') ?? '',
    body: formData.get('body') ?? '',
  });
  if (!parsed.success) return { status: 'error', message: t.errors.generic };
  if (!parsed.data.body.trim()) return { status: 'error', message: t.errors.empty };

  const supabase = await createClient();
  const { error } = await supabase.rpc('desk_add', {
    p_venue_id: parsed.data.venue_id,
    p_sender_name: parsed.data.sender_name,
    p_sender_phone: parsed.data.sender_phone,
    p_body: parsed.data.body,
  });
  if (error) {
    return { status: 'error', message: error.code === '42501' ? t.errors.notYours : t.errors.generic };
  }
  revalidatePath('/requests');
  return { status: 'success', message: t.pasted };
}

const StatusInput = z.object({
  id: z.string().uuid(),
  status: z.enum(['new', 'booked', 'declined', 'dismissed']),
  code: z.string().max(40).nullable(),
});

export async function setRequestStatus(
  id: string,
  status: 'new' | 'booked' | 'declined' | 'dismissed',
  code: string | null = null,
): Promise<{ ok: boolean }> {
  await requireVenueAccess();
  const parsed = StatusInput.safeParse({ id, status, code });
  if (!parsed.success) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc('desk_set_status', {
    p_id: parsed.data.id,
    p_status: parsed.data.status,
    p_booking_code: parsed.data.code,
  });
  revalidatePath('/requests');
  return { ok: !error };
}

const ReplyInput = z.object({ id: z.string().uuid(), text: z.string().trim().min(1).max(1000) });

// Sends from the venue's connected number through whatsapp-reply, under the
// caller's own session. The function owns the checks (staff, WhatsApp
// source, the 24-hour window, a connected number).
export async function replyOnWhatsApp(
  id: string,
  text: string,
): Promise<{ ok: true } | { ok: false; code: string }> {
  await requireVenueAccess();
  const parsed = ReplyInput.safeParse({ id, text });
  if (!parsed.success) return { ok: false, code: 'VALIDATION_FAILED' };
  const supabase = await createClient();
  const { error } = await supabase.functions.invoke('whatsapp-reply', {
    body: { inbox_id: parsed.data.id, text: parsed.data.text },
  });
  if (!error) return { ok: true };
  let code = 'UNKNOWN';
  try {
    const ctx = (error as { context?: Response }).context;
    const body = ctx ? await ctx.json() : null;
    if (body && typeof body.error === 'string') code = body.error;
  } catch {
    // keep UNKNOWN
  }
  return { ok: false, code };
}

const ConnectInput = z.object({
  venue_id: z.string().uuid(),
  phone_number_id: z.string().regex(/^[0-9]{6,30}$/).or(z.literal('')),
  display_phone: z.string().max(30),
});

// The founder's form on the venue page: connect (or, with an empty id,
// disconnect) the venue's WhatsApp Business number.
export async function connectWhatsAppNumber(formData: FormData): Promise<void> {
  const viewer = await requireVenueAccess();
  if (!viewer.isAdmin) return;
  const parsed = ConnectInput.safeParse({
    venue_id: formData.get('venue_id'),
    phone_number_id: formData.get('phone_number_id') ?? '',
    display_phone: formData.get('display_phone') ?? '',
  });
  if (!parsed.success) throw new Error('connectWhatsAppNumber: invalid input');
  const supabase = await createClient();
  const { error } = await supabase.rpc('desk_connect_number', {
    p_venue_id: parsed.data.venue_id,
    p_phone_number_id: parsed.data.phone_number_id || null,
    p_display_phone: parsed.data.display_phone || '',
  });
  if (error) throw new Error(`connectWhatsAppNumber: ${error.message}`);
  revalidatePath(`/venues/${parsed.data.venue_id}/edit`);
}
