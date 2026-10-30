// schedule.ts — what the recorder should do on this tick. Pure, so tested.
//
// The database decides what is armed (recorder_sync) and refuses a start
// outside the booking (recorder_mark). This only decides when, on this
// box, to start ffmpeg — and what to give up on.

export interface Armed {
  recording_id: string;
  booking_id: string;
  starts_at: string;
  ends_at: string;
  state: 'scheduled' | 'recording';
}

export type Action =
  | { kind: 'start'; recording_id: string; seconds: number }
  | { kind: 'abandon'; recording_id: string; reason: string };

/**
 * Never before kickoff: on back-to-back bookings the minute before is
 * somebody else's game. `now` is already corrected to the server's clock.
 */
export const LEAD_MS = 0;
/** Not worth starting with less than this left. */
export const MIN_LEFT_MS = 15_000;

export function plan(now: number, armed: Armed[], running: ReadonlySet<string>): Action[] {
  const actions: Action[] = [];
  for (const a of armed) {
    if (running.has(a.recording_id)) continue;
    const start = Date.parse(a.starts_at);
    const end = Date.parse(a.ends_at);
    if (a.state === 'recording') {
      // The database says this box is recording it, and it is not: the
      // box restarted mid-game. The file is gone; say so.
      actions.push({ kind: 'abandon', recording_id: a.recording_id, reason: 'recorder restarted mid-game' });
      continue;
    }
    if (now >= end - MIN_LEFT_MS) {
      if (now >= end) actions.push({ kind: 'abandon', recording_id: a.recording_id, reason: 'missed: recorder was not running' });
      continue;
    }
    if (now >= start - LEAD_MS) {
      actions.push({ kind: 'start', recording_id: a.recording_id, seconds: Math.ceil((end - now) / 1000) });
    }
  }
  return actions;
}

/** "-rtsp_transport tcp -i rtsp://…" → argv. No quoting: keep URLs free of spaces. */
export function splitArgs(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}
