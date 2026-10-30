// _shared/recording.ts
// Court cameras (ADR-0042): the pieces the recorder, recording and
// recordings-sweep functions share, kept pure so they are tested.

import { z } from 'zod';
import type { ErrorCode } from './errors.ts';

export const BUCKET = 'recordings';
/** A player's link to the whole match lasts an hour. */
export const VIEW_TTL_S = 60 * 60;
/** Staff get a quarter of an hour, and each one is audited. */
export const STAFF_TTL_S = 15 * 60;

export const RecorderInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('sync') }),
  z.object({
    action: z.literal('mark'),
    recording_id: z.string().uuid(),
    state: z.enum(['recording', 'processing', 'ready', 'failed']),
    bytes: z.number().int().nonnegative().optional(),
    duration_s: z.number().int().nonnegative().optional(),
    failure: z.string().max(500).optional(),
  }),
]);
export type RecorderInput = z.infer<typeof RecorderInput>;

export const RecordingInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('url'), booking_id: z.string().uuid() }),
  z.object({
    action: z.literal('staff_url'),
    recording_id: z.string().uuid(),
    reason: z.string().trim().min(3).max(500),
  }),
  z.object({ action: z.literal('delete'), recording_id: z.string().uuid() }),
]);
export type RecordingInput = z.infer<typeof RecordingInput>;

/** The device token is kept only as its SHA-256, hex — as camera_register stores it. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

type RecCode = Extract<ErrorCode, `REC_${string}`>;

const STATUS: Record<RecCode, number> = {
  REC_UNKNOWN_DEVICE: 401,
  REC_NOT_VIEWER: 403,
  REC_NOT_ORGANISER: 403,
  REC_NOT_STAFF: 403,
  REC_REASON_REQUIRED: 400,
  REC_NOT_READY: 409,
  REC_NOT_FINISHED: 409,
  REC_BAD_TRANSITION: 409,
  REC_OUTSIDE_WINDOW: 409,
  REC_NOT_CONSENTED: 409,
};

/** The database raises its reason as the message; map it to a code and status. */
export function recError(message: string | undefined | null): { code: RecCode; status: number } | null {
  const code = (message ?? '').trim() as RecCode;
  return code in STATUS ? { code, status: STATUS[code] } : null;
}

/**
 * Locally the functions reach storage at an internal host (kong:8000) that
 * a phone or the recorder cannot; LUDI_PUBLIC_URL, when set, is the
 * origin they can. Hosted, SUPABASE_URL is already public and nothing moves.
 */
export function publicUrl(url: string, internal: string, publicBase: string | undefined): string {
  if (!publicBase) return url;
  const from = new URL(internal).origin;
  return url.startsWith(from) ? new URL(publicBase).origin + url.slice(from.length) : url;
}
