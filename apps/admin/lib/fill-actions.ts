'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { requireVenueAccess } from '@/lib/auth';
import { getCopy } from '@/lib/copy';
import { parseEurosToCents } from '@/lib/format';
import type { FormState } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';

// Fill the hour (plans/fill-the-hour.md, ADR-0045). Every write is one of
// the definer functions in 20261013000003, each gated as its first
// statement (the venue's owner, and the venue switched on by Ludi); these
// actions only turn a form into a call and a refusal into a sentence.

const FILL_CODES = [
  'FILL_SLOT_TAKEN',
  'FILL_COURT_CLOSED',
  'FILL_BAD_WINDOW',
  'FILL_BAD_PRICE',
  'FILL_NOT_ENABLED',
] as const;

const OpenInput = z.object({
  pitch_id: z.string().uuid(),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }),
  price: z.string().max(12),
});

export async function openFillOffer(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireVenueAccess();
  const t = getCopy(viewer.locale).fill;

  const parsed = OpenInput.safeParse({
    pitch_id: formData.get('pitch_id'),
    starts_at: formData.get('starts_at'),
    ends_at: formData.get('ends_at'),
    price: formData.get('price') ?? '',
  });
  if (!parsed.success) return { status: 'error', message: t.errors.FILL_BAD_WINDOW };
  const input = parsed.data;

  let priceCents: number | null = null;
  if (input.price.trim() !== '') {
    priceCents = parseEurosToCents(input.price);
    if (priceCents === null) return { status: 'error', message: t.errors.FILL_BAD_PRICE };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('fill_hour_open', {
    p_pitch_id: input.pitch_id,
    p_starts_at: input.starts_at,
    p_ends_at: input.ends_at,
    p_price_cents: priceCents,
  });
  if (error) {
    if (error.code === '42501') return { status: 'error', message: t.notOwner };
    const code = FILL_CODES.find((c) => error.message === c);
    return { status: 'error', message: code ? t.errors[code] : t.errors.generic };
  }
  redirect(`/fill/${data as string}`);
}

const SentInput = z.object({ offer_id: z.string().uuid(), contact_id: z.string().uuid() });

// Recorded when the owner taps "Send on WhatsApp" — the link itself opens
// his own WhatsApp; this only remembers that he asked.
export async function markFillSent(offerId: string, contactId: string): Promise<{ ok: boolean }> {
  await requireVenueAccess();
  const parsed = SentInput.safeParse({ offer_id: offerId, contact_id: contactId });
  if (!parsed.success) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc('fill_hour_mark_sent', {
    p_offer_id: parsed.data.offer_id,
    p_contact_id: parsed.data.contact_id,
  });
  revalidatePath(`/fill/${parsed.data.offer_id}`);
  return { ok: !error };
}

const OptInput = z.object({ contact_id: z.string().uuid(), opt_out: z.boolean(), offer_id: z.string().uuid() });

export async function setContactOffers(contactId: string, optOut: boolean, offerId: string): Promise<{ ok: boolean }> {
  await requireVenueAccess();
  const parsed = OptInput.safeParse({ contact_id: contactId, opt_out: optOut, offer_id: offerId });
  if (!parsed.success) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.rpc('venue_contact_set_offers', {
    p_contact_id: parsed.data.contact_id,
    p_opt_out: parsed.data.opt_out,
  });
  revalidatePath(`/fill/${parsed.data.offer_id}`);
  return { ok: !error };
}

const SwitchInput = z.object({ venue_id: z.string().uuid(), on: z.enum(['on', 'off']) });

// The founder's switch, on the venue page. The function refuses anyone but
// an admin; the page only shows it to one.
export async function setFillEnabled(formData: FormData): Promise<void> {
  const viewer = await requireVenueAccess();
  if (!viewer.isAdmin) return;
  const parsed = SwitchInput.safeParse({ venue_id: formData.get('venue_id'), on: formData.get('on') });
  if (!parsed.success) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_fill_offers_enabled', {
    p_venue_id: parsed.data.venue_id,
    p_on: parsed.data.on === 'on',
  });
  if (error) throw new Error(`setFillEnabled: ${error.message}`);
  revalidatePath(`/venues/${parsed.data.venue_id}/edit`);
}
