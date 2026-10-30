'use server';

import { revalidatePath } from 'next/cache';

import { requireVenueAccess, type Viewer } from '@/lib/auth';
import { getCopy } from '@/lib/copy';
import { invalid, toFormError } from '@/lib/form-errors';
import { ContactRef, ContactSave, ContactsDeleteAll, type FormState } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';

// Slice B of plans/owner-contacts.md — the owner's page onto his regulars.
//
// Every write goes through one of the definer functions from
// 20260918000002, each with its own gate as its first statement; these
// actions only turn what the form sent into a call and the answer into a
// sentence. The owner check here is not the boundary — create and update
// would admit a manager too, by design (ADR-0041: adding a regular is the
// day) — it is the page's rule: this page is the owner's, and so is
// everything done from it. A manager adds regulars from the booking form.

function ownsVenue(viewer: Viewer, venueId: string): boolean {
  return viewer.venues.some((v) => v.id === venueId && v.role === 'owner');
}

export async function saveContact(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireVenueAccess();
  const t = getCopy(viewer.locale).contacts;

  const parsed = ContactSave.safeParse({
    venue_id: formData.get('venue_id'),
    contact_id: formData.get('contact_id'),
    display_name: formData.get('display_name') ?? '',
    phone: formData.get('phone') ?? '',
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors, viewer.locale);
  const c = parsed.data;
  if (!ownsVenue(viewer, c.venue_id)) return { status: 'error', message: t.ownerOnly };

  const supabase = await createClient();
  const { error } = c.contact_id
    ? await supabase.rpc('venue_contact_update', {
        p_contact_id: c.contact_id,
        p_display_name: c.display_name,
        p_phone: c.phone,
        p_note: c.note,
      })
    : await supabase.rpc('venue_contact_create', {
        p_venue_id: c.venue_id,
        p_display_name: c.display_name,
        p_phone: c.phone,
        p_note: c.note,
      });
  if (error) {
    // Two contacts cannot share a number — the phone is the identity.
    // Refused rather than merged, so the owner decides which one is right.
    if (error.code === '23505') return { status: 'error', message: t.duplicate };
    if (error.code === '42501') return { status: 'error', message: t.ownerOnly };
    return toFormError(error, viewer.locale);
  }

  revalidatePath('/contacts');
  return { status: 'success', message: c.contact_id ? t.saved : t.added };
}

export async function deleteContact(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireVenueAccess();
  const t = getCopy(viewer.locale).contacts;

  const parsed = ContactRef.safeParse({
    venue_id: formData.get('venue_id'),
    contact_id: formData.get('contact_id'),
  });
  if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors, viewer.locale);
  if (!ownsVenue(viewer, parsed.data.venue_id)) return { status: 'error', message: t.ownerOnly };

  const supabase = await createClient();
  const { error } = await supabase.rpc('venue_contact_delete', {
    p_contact_id: parsed.data.contact_id,
  });
  if (error) {
    if (error.code === '42501') return { status: 'error', message: t.ownerOnly };
    return toFormError(error, viewer.locale);
  }

  revalidatePath('/contacts');
  return { status: 'success', message: t.deleted };
}

export async function deleteAllContacts(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await requireVenueAccess();
  const t = getCopy(viewer.locale).contacts;

  const parsed = ContactsDeleteAll.safeParse({ venue_id: formData.get('venue_id') });
  if (!parsed.success) return invalid(parsed.error.flatten().fieldErrors, viewer.locale);
  if (!ownsVenue(viewer, parsed.data.venue_id)) return { status: 'error', message: t.ownerOnly };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('venue_contacts_delete_all', {
    p_venue_id: parsed.data.venue_id,
  });
  if (error) {
    if (error.code === '42501') return { status: 'error', message: t.ownerOnly };
    return toFormError(error, viewer.locale);
  }

  revalidatePath('/contacts');
  return { status: 'success', message: t.deletedAll(Number(data ?? 0)) };
}
