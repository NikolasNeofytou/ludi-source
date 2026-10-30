// _tests/anonymize.test.ts
// Pure test for GDPR erasure (ADR-0018). Guards the one place "what counts
// as the person's data" is decided: every quasi-identifying column is
// nulled, the NOT NULL name columns get safe placeholders, the account is
// switched off, the person's own rows are deleted, and neither the patch
// nor the deletes touch what we deliberately keep. No DB, no auth, no
// network.

import { assert, assertEquals } from 'std/assert/mod.ts';
import {
  ANONYMIZED_FIRST_NAME,
  ANONYMIZED_LAST_NAME,
  anonymizedProfilePatch,
  ERASED_ROWS,
  KEPT_TABLES,
  KEPT_USER_COLUMNS,
  UPCOMING_BOOKING_STATES,
  upcomingBookingsFrom,
} from '../_shared/anonymize.ts';

const ISO = '2026-06-12T10:00:00.000Z';

Deno.test('nulls every quasi-identifying profile column', () => {
  const patch = anonymizedProfilePatch(ISO) as unknown as Record<string, unknown>;
  for (const col of ['handle', 'preferred_foot', 'height_cm', 'age_band', 'play_frequency']) {
    assertEquals(patch[col], null, `${col} must be nulled`);
  }
  assertEquals(patch.positions, [], 'positions must be emptied');
});

Deno.test('placeholders the NOT NULL name columns with non-empty, non-identifying text', () => {
  const patch = anonymizedProfilePatch(ISO);
  assertEquals(patch.first_name, ANONYMIZED_FIRST_NAME);
  assertEquals(patch.last_name, ANONYMIZED_LAST_NAME);
  assert(patch.first_name.length > 0 && patch.last_name.length > 0, 'NOT NULL columns need a value');
});

Deno.test('stamps anonymized_at with the supplied timestamp', () => {
  assertEquals(anonymizedProfilePatch(ISO).anonymized_at, ISO);
});

Deno.test('never writes a column we deliberately keep (drift guard)', () => {
  const keys = Object.keys(anonymizedProfilePatch(ISO));
  for (const kept of KEPT_USER_COLUMNS) {
    assert(!keys.includes(kept), `patch must not touch kept column '${kept}'`);
  }
});

// ── audit 2026-10-19 (C17/L11): an erased account stops being addressable ──

Deno.test('switches the account off: no public card, no keeper pool, no notices', () => {
  const patch = anonymizedProfilePatch(ISO);
  assertEquals(patch.public_profile, false, 'the /p/<handle> card goes');
  assertEquals(patch.public_profile_at, null, 'a withdrawn consent carries no date (the CHECK)');
  assertEquals(patch.goes_in_goal, 'no', 'out of the keeper pool');
  assertEquals(patch.notify_games, false);
  assertEquals(patch.notify_asks, false);
});

Deno.test('deletes the rows that are only the person\'s own', () => {
  const tables = ERASED_ROWS.map((r) => r.table);
  for (
    const t of [
      'push_tokens',
      'team_follows',
      'player_notifications',
      'gk_feedback',
      'wallet_pass_tickets',
      'idempotency_keys',
    ]
  ) {
    assert(tables.includes(t), `${t} must be erased`);
  }
  // keeper feedback: only what was said ABOUT them; what they said about
  // another keeper is that keeper's record
  assertEquals(ERASED_ROWS.find((r) => r.table === 'gk_feedback')?.column, 'about_user');
  for (const r of ERASED_ROWS) {
    if (r.table !== 'gk_feedback') assertEquals(r.column, 'user_id', `${r.table} is keyed by user_id`);
  }
});

Deno.test('never deletes from a table erasure keeps (drift guard)', () => {
  const tables = new Set(ERASED_ROWS.map((r) => r.table));
  for (const kept of KEPT_TABLES) {
    assert(!tables.has(kept), `erasure must not delete from kept table '${kept}'`);
  }
  // the financial records and the venue's own are on the kept list
  for (const t of ['bookings', 'payments', 'booking_participants', 'venue_contacts', 'admin_actions']) {
    assert((KEPT_TABLES as readonly string[]).includes(t), `${t} is kept`);
  }
});

Deno.test('upcoming bookings: the live states, flattened with the venue name', () => {
  assertEquals([...UPCOMING_BOOKING_STATES], ['pending', 'collecting', 'paid', 'confirmed']);
  assert(!(UPCOMING_BOOKING_STATES as readonly string[]).includes('cancelled'));
  assertEquals(
    upcomingBookingsFrom([
      {
        id: 'b-1',
        code: 'LAR-2026-0412',
        starts_at: '2026-10-25T17:00:00Z',
        state: 'confirmed',
        pitch: { venue: { name: 'Kamares Futsal' } },
      },
      // PostgREST can hand an embed back as a one-element array
      { id: 'b-2', code: 'LAR-2026-0413', starts_at: '2026-10-26T17:00:00Z', state: 'paid', pitch: [{ venue: [{ name: 'Campeone' }] }] },
      { id: 'b-3', code: 'LAR-2026-0414', starts_at: '2026-10-27T17:00:00Z', state: 'collecting', pitch: null },
    ]),
    [
      { id: 'b-1', code: 'LAR-2026-0412', starts_at: '2026-10-25T17:00:00Z', state: 'confirmed', venue_name: 'Kamares Futsal' },
      { id: 'b-2', code: 'LAR-2026-0413', starts_at: '2026-10-26T17:00:00Z', state: 'paid', venue_name: 'Campeone' },
      { id: 'b-3', code: 'LAR-2026-0414', starts_at: '2026-10-27T17:00:00Z', state: 'collecting', venue_name: null },
    ],
  );
  assertEquals(upcomingBookingsFrom(null), []);
});
