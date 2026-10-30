import { assertEquals } from 'std/assert/mod.ts';
import { type Armed, plan, splitArgs } from './schedule.ts';

const T = Date.parse('2026-10-15T17:00:00Z');
const game = (over: Partial<Armed> = {}): Armed => ({
  recording_id: 'r1',
  booking_id: 'b1',
  starts_at: '2026-10-15T17:00:00Z',
  ends_at: '2026-10-15T18:00:00Z',
  state: 'scheduled',
  ...over,
});

Deno.test('plan: nothing an hour before kickoff', () => {
  assertEquals(plan(T - 3600_000, [game()], new Set()), []);
});

Deno.test('plan: not a second before kickoff — the minute before is somebody else\'s game', () => {
  assertEquals(plan(T - 1_000, [game()], new Set()), []);
});

Deno.test('plan: starts at kickoff, for the rest of the booking', () => {
  assertEquals(plan(T, [game()], new Set()), [{ kind: 'start', recording_id: 'r1', seconds: 3600 }]);
});

Deno.test('plan: a box that comes up mid-game records what is left', () => {
  assertEquals(plan(T + 600_000, [game()], new Set()), [{ kind: 'start', recording_id: 'r1', seconds: 3000 }]);
});

Deno.test('plan: never twice', () => {
  assertEquals(plan(T, [game()], new Set(['r1'])), []);
});

Deno.test('plan: a recording this box lost is given up, not restarted', () => {
  assertEquals(plan(T + 60_000, [game({ state: 'recording' })], new Set()), [
    { kind: 'abandon', recording_id: 'r1', reason: 'recorder restarted mid-game' },
  ]);
});

Deno.test('plan: too late to bother, then missed', () => {
  assertEquals(plan(Date.parse('2026-10-15T17:59:50Z'), [game()], new Set()), []);
  assertEquals(plan(Date.parse('2026-10-15T18:00:01Z'), [game()], new Set()), [
    { kind: 'abandon', recording_id: 'r1', reason: 'missed: recorder was not running' },
  ]);
});

Deno.test('splitArgs', () => {
  assertEquals(splitArgs(' -rtsp_transport tcp  -i rtsp://10.0.0.5/s1 '), ['-rtsp_transport', 'tcp', '-i', 'rtsp://10.0.0.5/s1']);
});
