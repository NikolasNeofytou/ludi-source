// tests/e2e/booking_happy_path.ts — M6 #44 (retargeted 2026-08-29).
//
// Drives a real booking through the FULL stack — GoTrue sign-in, PostgREST
// with RLS as the phone sees it, the get_available_slots RPC, and a booking
// write through the Edge Function runtime — asserting the invariants that
// unit layers cannot see. Both 2026-08-10 blockers hid exactly here:
// pgtap couldn't catch the is_admin() recursion because it only appears
// through PostgREST, and no mobile test runner exists to catch the Hermes
// crypto crash. This is the catch-net for the first kind.
//
// The booking write goes through create-walk-in-booking, not create-booking:
// it exercises the same slot-lock, EXCLUDE constraint, idempotency cache,
// and pricing substrate while needing zero Stripe credentials — so the test
// runs anywhere the stack runs. The Stripe leg of create-booking stays
// covered by its Deno unit tests + the manual dress-rehearsal.
//
// Targets whatever SUPABASE_URL points at. Local + CI use the CLI stack
// (fixture venue + test OTP from config.toml). Pointing it at a staging
// project later is an env-var change plus a staging test user — the script
// takes no local-only shortcuts beyond the fixture IDs below.
//
// Usage:
//   deno run --allow-net --allow-env tests/e2e/booking_happy_path.ts
// Env:
//   SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY  (required)
//
// Flow (each step asserts; any failure exits 1 with the step named):
//   1  phone-OTP sign-in round trip (config.toml test_otp) — auth path only
//   2  unprivileged player provisioned via service role and signed in;
//      all player-side assertions use THIS identity, because on a
//      long-lived local DB the test-OTP user is typically an admin
//   3  Discover as the player: enabled cities, pitches-with-venue embed
//   4  get_available_slots for the fixture pitch, tomorrow
//   5  owner provisioned (auth user + venue_owners row) and signed in
//   6  owner records a walk-in on the first free slot            → 200
//   7  same Idempotency-Key replay                               → same booking
//   8  fresh key, same slot                                      → 409 SLOT_UNAVAILABLE
//   9  slot no longer offered by get_available_slots
//  10  player cannot read the walk-in booking through RLS
//  11  owner cancels the walk-in; the slot is offered again

const URL_BASE = required('SUPABASE_URL');
const ANON_KEY = required('SUPABASE_ANON_KEY');
const SERVICE_KEY = required('SUPABASE_SERVICE_ROLE_KEY');

// Local-dev fixture (seed.sql §2) + the config.toml test OTP identity.
const FIXTURE_PITCH_ID = '00000000-0000-4000-8000-000000000101';
const FIXTURE_VENUE_ID = '00000000-0000-4000-8000-000000000100';
const PLAYER_PHONE = '+35799000000';
const PLAYER_OTP = '123456';
const OWNER_EMAIL = 'e2e-owner@ludi.test';
const OWNER_PASSWORD = 'e2e-owner-password-1';
// The player identity for all player-side assertions is provisioned fresh
// rather than reusing the test-OTP user: on a long-lived local DB that
// phone user is typically promoted to admin (see JOURNAL — local-dev admin
// promotion), which would make the RLS-isolation assertions pass or fail
// for the wrong reason. The OTP sign-in stays as its own auth-path check.
const PLAYER_EMAIL = 'e2e-player@ludi.test';
const PLAYER_PASSWORD = 'e2e-player-password-1';
const VENUE_TZ = 'Europe/Nicosia';

function required(name: string): string {
  const v = Deno.env.get(name);
  if (!v) {
    console.error(`Missing required env var ${name}`);
    Deno.exit(1);
  }
  return v;
}

let currentStep = '';
function step(name: string) {
  currentStep = name;
  console.log(`→ ${name}`);
}
function fail(detail: string): never {
  console.error(`✗ FAILED at [${currentStep}]: ${detail}`);
  Deno.exit(1);
}
function assert(cond: unknown, detail: string): asserts cond {
  if (!cond) fail(detail);
}

async function http(
  path: string,
  init: RequestInit & { token?: string; service?: boolean } = {},
): Promise<{ status: number; body: unknown }> {
  const headers = new Headers(init.headers);
  headers.set('apikey', ANON_KEY);
  headers.set('Content-Type', 'application/json');
  if (init.service) headers.set('Authorization', `Bearer ${SERVICE_KEY}`);
  else if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  const res = await fetch(`${URL_BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

function venueDateStr(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VENUE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

interface Slot {
  starts_at: string;
  ends_at: string;
  is_available: boolean;
}

async function fetchSlots(token: string, dateStr: string): Promise<Slot[]> {
  const { status, body } = await http('/rest/v1/rpc/get_available_slots', {
    method: 'POST',
    token,
    body: JSON.stringify({
      p_pitch_id: FIXTURE_PITCH_ID,
      p_start_date: dateStr,
      p_end_date: dateStr,
    }),
  });
  assert(status === 200, `get_available_slots returned ${status}: ${JSON.stringify(body)}`);
  return body as Slot[];
}

// Create-or-reuse an auth user via the service role, then sign it in with
// the password grant. Reused for the player and the owner identities.
async function provisionUser(email: string, password: string): Promise<{ id: string; token: string }> {
  // Create may 4xx if the user survives from a previous local run; the
  // password grant below is the actual gate either way, and its response
  // carries the user id — no admin lookup needed.
  await http('/auth/v1/admin/users', {
    method: 'POST',
    service: true,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const signIn = await http('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  assert(signIn.status === 200, `sign-in for ${email} returned ${signIn.status}: ${JSON.stringify(signIn.body)}`);
  const body = signIn.body as { access_token: string; user: { id: string } };
  return { id: body.user.id, token: body.access_token };
}

// ── 1. Phone-OTP auth path (the app's real sign-in) ──────────────────
step('phone OTP sign-in round trip');
{
  const otp = await http('/auth/v1/otp', {
    method: 'POST',
    body: JSON.stringify({ phone: PLAYER_PHONE }),
  });
  assert(otp.status === 200, `OTP request returned ${otp.status}: ${JSON.stringify(otp.body)}`);
  const { status, body } = await http('/auth/v1/verify', {
    method: 'POST',
    body: JSON.stringify({ type: 'sms', phone: PLAYER_PHONE, token: PLAYER_OTP }),
  });
  assert(status === 200, `OTP verify returned ${status}: ${JSON.stringify(body)}`);
  assert((body as { access_token?: string }).access_token, 'verify response carries no access_token');
}
console.log('  ✓ OTP round trip issues a session');

step('provision unprivileged player');
const player = await provisionUser(PLAYER_EMAIL, PLAYER_PASSWORD);
const playerToken = player.token;
console.log('  ✓ player session established');

// ── 2. Discover through PostgREST, as the phone queries it ───────────
step('Discover: enabled cities');
{
  const { status, body } = await http(
    '/rest/v1/cities?select=id,code,name_en&is_enabled=eq.true&order=display_order',
    { token: playerToken },
  );
  assert(status === 200, `cities returned ${status}`);
  const cities = body as Array<{ code: string }>;
  assert(cities.length >= 1, 'no enabled cities — seed missing?');
  console.log(`  ✓ ${cities.length} enabled cities`);
}

step('Discover: pitches with venue embed (RLS + join path)');
{
  // The exact Discover query shape (venues!inner embed). This is the read
  // that the 2026-08-10 is_admin() recursion killed — through PostgREST
  // only, invisible to pgtap.
  const { status, body } = await http(
    `/rest/v1/pitches?select=id,name,price_per_hour_cents,venues!inner(id,name,city_id)` +
      `&is_verified=eq.true&is_active=eq.true&venues.id=eq.${FIXTURE_VENUE_ID}`,
    { token: playerToken },
  );
  assert(status === 200, `pitches embed returned ${status}: ${JSON.stringify(body)}`);
  const pitches = body as Array<{ id: string }>;
  assert(
    pitches.some((p) => p.id === FIXTURE_PITCH_ID),
    'fixture pitch not visible to a signed-in player',
  );
  console.log(`  ✓ ${pitches.length} bookable pitches at the fixture venue`);
}

// ── 3. Availability for tomorrow ─────────────────────────────────────
step('get_available_slots for tomorrow');
const tomorrow = venueDateStr(new Date(Date.now() + 24 * 60 * 60 * 1000));
const slotsBefore = await fetchSlots(playerToken, tomorrow);
const freeSlot = slotsBefore.find((s) => s.is_available);
assert(freeSlot, `no available slot on ${tomorrow} for the fixture pitch`);
console.log(`  ✓ ${slotsBefore.filter((s) => s.is_available).length} free slots; booking ${freeSlot.starts_at}`);

// ── 4+5. Provision + sign in the owner ───────────────────────────────
step('provision owner + venue_owners grant + sign-in');
const owner = await provisionUser(OWNER_EMAIL, OWNER_PASSWORD);
{
  const grant = await http('/rest/v1/venue_owners?on_conflict=venue_id,user_id', {
    method: 'POST',
    service: true,
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ venue_id: FIXTURE_VENUE_ID, user_id: owner.id, role: 'owner' }),
  });
  assert(
    grant.status === 201 || grant.status === 200,
    `venue_owners grant returned ${grant.status}: ${JSON.stringify(grant.body)}`,
  );
}
const ownerToken = owner.token;
console.log(`  ✓ owner ${owner.id} granted on fixture venue, session established`);

// ── 6. Walk-in booking on the free slot ──────────────────────────────
step('walk-in create through the Edge Function runtime');
const idemKey = crypto.randomUUID();
const walkInPayload = JSON.stringify({
  action: 'create',
  pitch_id: FIXTURE_PITCH_ID,
  starts_at: freeSlot.starts_at,
  ends_at: freeSlot.ends_at,
  customer_name: 'E2E Happy Path',
  addons: [
    { code: 'bibs', quantity: 1 },
    { code: 'ball_rental', quantity: 1 },
  ],
});
const bookingId = await (async () => {
  const { status, body } = await http('/functions/v1/create-walk-in-booking', {
    method: 'POST',
    token: ownerToken,
    headers: { 'Idempotency-Key': idemKey },
    body: walkInPayload,
  });
  assert(status === 200, `walk-in create returned ${status}: ${JSON.stringify(body)}`);
  const booking = (body as { booking: { id: string; state: string; total_cents: number } }).booking;
  assert(booking.state === 'confirmed', `expected confirmed, got ${booking.state}`);
  assert(booking.total_cents > 0, 'booking recorded with zero price');
  return booking.id;
})();
console.log(`  ✓ walk-in ${bookingId} confirmed`);

// ── 7. Idempotent replay ─────────────────────────────────────────────
step('idempotency: same key replays the same booking');
{
  const { status, body } = await http('/functions/v1/create-walk-in-booking', {
    method: 'POST',
    token: ownerToken,
    headers: { 'Idempotency-Key': idemKey },
    body: walkInPayload,
  });
  assert(status === 200, `replay returned ${status}: ${JSON.stringify(body)}`);
  const replayed = (body as { booking: { id: string } }).booking.id;
  assert(replayed === bookingId, `replay created a DIFFERENT booking: ${replayed}`);
}
console.log('  ✓ replay served from the idempotency cache');

// ── 8. Double-book rejected ──────────────────────────────────────────
step('EXCLUDE constraint: fresh key on the same slot is rejected');
{
  const { status, body } = await http('/functions/v1/create-walk-in-booking', {
    method: 'POST',
    token: ownerToken,
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: walkInPayload,
  });
  assert(status === 409, `expected 409, got ${status}: ${JSON.stringify(body)}`);
  const code = (body as { error: string }).error;
  assert(code === 'SLOT_UNAVAILABLE', `expected SLOT_UNAVAILABLE, got ${code}`);
}
console.log('  ✓ second booking on the slot rejected with SLOT_UNAVAILABLE');

// ── 9. Availability reflects the booking ─────────────────────────────
step('slot disappears from get_available_slots');
{
  const slots = await fetchSlots(playerToken, tomorrow);
  const taken = slots.find((s) => s.starts_at === freeSlot.starts_at);
  assert(!taken || !taken.is_available, 'booked slot still offered as available');
}
console.log('  ✓ booked slot no longer offered');

// ── 10. RLS: the player cannot read someone else's booking ───────────
step("RLS: player cannot read the owner's walk-in booking");
{
  const { status, body } = await http(`/rest/v1/bookings?id=eq.${bookingId}&select=id`, {
    token: playerToken,
  });
  assert(status === 200, `bookings read returned ${status}`);
  assert((body as unknown[]).length === 0, 'walk-in booking leaked to an unrelated player');
}
console.log('  ✓ booking invisible to an unrelated player');

// ── 11. Cancel frees the slot ────────────────────────────────────────
step('walk-in cancel frees the slot');
{
  const { status, body } = await http('/functions/v1/create-walk-in-booking', {
    method: 'POST',
    token: ownerToken,
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ action: 'cancel', booking_id: bookingId, reason: 'e2e cleanup' }),
  });
  assert(status === 200, `cancel returned ${status}: ${JSON.stringify(body)}`);
  const slots = await fetchSlots(playerToken, tomorrow);
  const freed = slots.find((s) => s.starts_at === freeSlot.starts_at);
  assert(freed?.is_available, 'cancelled slot not offered again');
}
console.log('  ✓ cancelled; slot available again');

console.log('\n✓ e2e booking happy path passed (11 steps)');
