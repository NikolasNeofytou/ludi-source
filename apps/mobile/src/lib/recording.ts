// recording.ts — court cameras in the app (ADR-0042, plans/court-cameras.md).
//
// The recording belongs to the booking: the organiser switches it on before
// kickoff, everyone joining is told, and only the players in on the
// booking can watch it, for thirty days. Every rule lives in the database
// (recording_state, set_recording, recording_for_viewer); this file only
// asks.

import { supabase } from './supabase';

export type RecordingPhase = 'scheduled' | 'recording' | 'processing' | 'ready' | 'failed' | 'deleted';

export interface RecordingState {
  has_camera: boolean;
  consented: boolean;
  can_toggle: boolean;
  blocked_reason: string | null;
  recording_id: string | null;
  state: RecordingPhase | null;
  duration_s: number | null;
  expires_at: string | null;
}

export class RecordingError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export async function fetchRecordingState(bookingId: string): Promise<RecordingState | null> {
  const { data, error } = await supabase.rpc('recording_state', { p_booking_id: bookingId });
  if (error) throw new RecordingError(error.message);
  return ((data as RecordingState[] | null) ?? [])[0] ?? null;
}

/** Checkout asks before the booking exists. */
export async function pitchHasCamera(pitchId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('pitch_has_camera', { p_pitch_id: pitchId });
  if (error) return false;
  return data === true;
}

/** The switch remembers the organiser's last answer. */
export async function myRecordingDefault(): Promise<boolean> {
  const { data, error } = await supabase.rpc('my_recording_default');
  if (error) return false;
  return data === true;
}

export async function setRecording(bookingId: string, on: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_recording', { p_booking_id: bookingId, p_on: on });
  if (error) throw new RecordingError(error.message);
}

/** The invite preview tells a joiner before he takes a spot. */
export async function inviteRecorded(token: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('invite_recorded', { p_invite_token: token });
  if (error) return false;
  return data === true;
}

async function invokeRecording<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('recording', { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let code = 'UNKNOWN';
    if (ctx && typeof ctx.json === 'function') {
      try {
        const parsed = (await ctx.json()) as { error?: string };
        if (typeof parsed?.error === 'string') code = parsed.error;
      } catch {
        // not JSON
      }
    }
    throw new RecordingError(code);
  }
  return data as T;
}

/** A link to the whole match, good for an hour. */
export async function recordingUrl(bookingId: string): Promise<string> {
  const res = await invokeRecording<{ url: string }>({ action: 'url', booking_id: bookingId });
  return res.url;
}

export async function deleteRecording(recordingId: string): Promise<void> {
  await invokeRecording({ action: 'delete', recording_id: recordingId });
}
