'use server';

// Court cameras (ADR-0042): the founder puts a camera on a court and takes
// it down. The device token is shown once, here, and only its hash is kept;
// it goes into the recorder at the venue (tools/court-recorder).

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireVenueAccess } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export type RegisterCameraState =
  | { status: 'idle' }
  | { status: 'done'; token: string; pitchName: string }
  | { status: 'error'; message: string };

const RegisterInput = z.object({
  venue_id: z.string().uuid(),
  pitch_id: z.string().uuid(),
  device_ref: z.string().trim().max(120),
});

export async function registerCamera(_prev: RegisterCameraState, formData: FormData): Promise<RegisterCameraState> {
  const viewer = await requireVenueAccess();
  if (!viewer.isAdmin) return { status: 'error', message: 'Admin only.' };
  const parsed = RegisterInput.safeParse({
    venue_id: formData.get('venue_id'),
    pitch_id: formData.get('pitch_id'),
    device_ref: formData.get('device_ref') ?? '',
  });
  if (!parsed.success) return { status: 'error', message: 'Pick a court.' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('camera_register', {
    p_pitch_id: parsed.data.pitch_id,
    p_vendor: 'rtsp',
    p_device_ref: parsed.data.device_ref || null,
  });
  if (error) {
    return {
      status: 'error',
      message: error.message === 'REC_CAMERA_EXISTS' ? 'That court already has a camera. Retire it first.' : error.message,
    };
  }
  const row = (data as Array<{ camera_id: string; device_token: string }> | null)?.[0];
  if (!row) return { status: 'error', message: 'The camera was not registered.' };
  const { data: pitch } = await supabase.from('pitches').select('name').eq('id', parsed.data.pitch_id).maybeSingle();
  revalidatePath(`/venues/${parsed.data.venue_id}/edit`);
  return { status: 'done', token: row.device_token, pitchName: (pitch?.name as string) ?? '' };
}

const RetireInput = z.object({ venue_id: z.string().uuid(), camera_id: z.string().uuid() });

export async function retireCamera(formData: FormData): Promise<void> {
  const viewer = await requireVenueAccess();
  if (!viewer.isAdmin) return;
  const parsed = RetireInput.safeParse({ venue_id: formData.get('venue_id'), camera_id: formData.get('camera_id') });
  if (!parsed.success) throw new Error('retireCamera: invalid input');
  const supabase = await createClient();
  const { error } = await supabase.rpc('camera_retire', { p_camera_id: parsed.data.camera_id });
  if (error) throw new Error(`retireCamera: ${error.message}`);
  revalidatePath(`/venues/${parsed.data.venue_id}/edit`);
}
