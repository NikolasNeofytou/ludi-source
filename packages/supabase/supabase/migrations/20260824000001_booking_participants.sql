-- 20260824000001_booking_participants.sql
-- A booking stops being a receipt and becomes a fixture with a roster.
--
-- Plan:   docs/plans/shared-fixture.md (REQUIREMENTS + DATA_MODEL + ARCHITECTURE)
-- ADRs:   0021 — the invite capability is a rotatable token, not the booking code
--         0022 — joining is a SECURITY DEFINER RPC, not an Edge Function
--         0013 — the shape this file's views reuse (dedicated definer view,
--                PII excluded by construction), with one difference: a card is
--                meant to be public and a roster is not, so both views here
--                carry a caller predicate.
--
-- Work unit W2 of the DEVELOPMENT_PLAN. Nothing in this file moves money and
-- nothing in it changes how a booking is created, priced, paid or cancelled.
--
-- Contents, in dependency order:
--   1. squad_slots_for()      — how many heads a pitch type needs
--   2. bookings               — gk_slots, outfield_slots, invite_token
--   3. booking_participants   — the roster
--   4. helpers                — is_participant_of_booking, is_booking_organiser
--   5. capacity + column guards
--   6. RLS
--   7. v_fixture, v_fixture_roster
--   8. fixture_preview(), join_fixture()
--   9. backfill

-- ════════════════════════════════════════════════════════════════════
-- 0. Make uuid7() survive a pinned search_path
-- ════════════════════════════════════════════════════════════════════
-- Found the hard way while building this file. `join_fixture()` is SECURITY
-- DEFINER, and the house style pins `search_path = public, pg_temp`. Its
-- INSERT fires the id column's DEFAULT — public.uuid7() — whose body calls
-- `gen_random_bytes`, and on Supabase pgcrypto lives in the `extensions`
-- schema, not `public`. uuid7() has no search_path of its own, so it inherits
-- the pinned one, cannot see pgcrypto, and the insert dies with
-- "function gen_random_bytes(integer) does not exist".
--
-- Every existing SECURITY DEFINER function in this repo pins the same way and
-- none of them insert a row, which is why this has never fired before. It
-- would have fired for the next one regardless of this version, so it is
-- fixed at the root: uuid7() carries its own search_path and stops depending
-- on its caller's.
--
-- Listing `extensions` is safe where it does not exist (the CI Postgres
-- container installs pgcrypto into public): Postgres silently skips missing
-- schemas in search_path rather than erroring.
-- Wrapped in EXECUTE because sqlfluff 4.1.0 cannot parse a multi-schema
-- `ALTER FUNCTION … SET search_path` and CI lints this directory. Same
-- workaround the pg_cron migration uses for COMMENT ON EXTENSION.
DO $$
BEGIN
  EXECUTE 'ALTER FUNCTION public.uuid7() SET search_path = public, extensions, pg_temp';
END;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 1. Squad shape
-- ════════════════════════════════════════════════════════════════════
-- Two keepers in every format: a match has two goals. What changes with the
-- format is the outfield count. 5-a-side is 2 + 8, not 2 + 10, because the
-- "5" already counts the keeper.
CREATE OR REPLACE FUNCTION public.squad_slots_for(
  p_pitch_type          text,
  OUT gk_slots          smallint,
  OUT outfield_slots    smallint
)
LANGUAGE sql IMMUTABLE
AS $$
  SELECT 2::smallint,
         (CASE p_pitch_type
            WHEN '5-a-side'  THEN 8
            WHEN '7-a-side'  THEN 12
            WHEN '11-a-side' THEN 20
          END)::smallint;
$$;

COMMENT ON FUNCTION public.squad_slots_for(text) IS
  'Roster shape for a pitch type: always 2 keepers, outfield varies. Returns '
  'NULL outfield for an unknown type so a bad value fails loudly at the '
  'NOT NULL rather than silently seating a squad of two.';

-- ════════════════════════════════════════════════════════════════════
-- 2. bookings: the fixture's shape and its invite capability
-- ════════════════════════════════════════════════════════════════════
-- The squad size is STORED, not derived on read, for the same reason
-- base_price_cents is stored: a venue owner editing the pitch must not
-- reshape a fixture people have already joined. M6 #41e gave owners a pitch
-- editor, so this is a live hazard rather than a hypothetical one.
ALTER TABLE public.bookings
  ADD COLUMN gk_slots       smallint,
  ADD COLUMN outfield_slots smallint,
  ADD COLUMN invite_token   text;

-- The capability. NOT bookings.code — that is CITY-YEAR-NNNN off a per-city
-- sequence, so one shared invite would be a key to every fixture in Larnaca
-- (ADR-0021). 12 random bytes = 96 bits, base64url, no padding. Not a uuid7:
-- v7 is time-ordered and therefore partially guessable, and this column
-- exists precisely to be unguessable.
--
-- Same pgcrypto-in-`extensions` hazard as uuid7() above, in both tenses:
-- hosted Postgres validates this body at CREATE time under the session's
-- `public` search_path (where gen_random_bytes does not exist), and the
-- backfill below calls it in that same session. So validation is skipped
-- for this one statement, and the function carries its own search_path —
-- EXECUTE-wrapped for the same sqlfluff reason as the uuid7 block.
SET LOCAL check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.new_invite_token()
RETURNS text
LANGUAGE sql VOLATILE
AS $$
  SELECT translate(encode(gen_random_bytes(12), 'base64'), '+/=', '-_');
$$;

SET LOCAL check_function_bodies = on;

DO $$
BEGIN
  EXECUTE 'ALTER FUNCTION public.new_invite_token() SET search_path = public, extensions, pg_temp';
END;
$$;

COMMENT ON FUNCTION public.new_invite_token() IS
  'Unguessable bearer capability for a fixture invite (96 bits, base64url). '
  'Rotate by UPDATE to revoke every link already shared — see ADR-0021.';

-- ════════════════════════════════════════════════════════════════════
-- 3. booking_participants — the roster
-- ════════════════════════════════════════════════════════════════════
-- A participant is a Ludi ACCOUNT. No guest rows, no typed names: a slot is
-- empty until a real person opens the invite link and signs in.
CREATE TABLE public.booking_participants (
  id           uuid PRIMARY KEY DEFAULT public.uuid7(),
  booking_id   uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.users(id)    ON DELETE RESTRICT,
  slot_kind    text NOT NULL CHECK (slot_kind IN ('gk','outfield')),
  status       text NOT NULL DEFAULT 'in' CHECK (status IN ('in','out')),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  left_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- One person, one slot. Rejoining flips this row back to 'in' rather than
  -- inserting a second — the final state is what matters, and a per-event
  -- history is an events table this version does not need.
  UNIQUE (booking_id, user_id),

  -- Status and its timestamp must agree. Same shape as
  -- users_public_profile_at_matches_flag, and for the same reason: "when did
  -- they drop out" is a question that gets asked later.
  CONSTRAINT booking_participants_left_at_matches_status
    CHECK ((status = 'out' AND left_at IS NOT NULL)
        OR (status = 'in'  AND left_at IS NULL))
);

-- The roster read is always "this booking, the ones who are in".
CREATE INDEX booking_participants_booking_idx
  ON public.booking_participants (booking_id, status);
-- "my fixtures" — every booking a user is on, not just the ones they paid for.
CREATE INDEX booking_participants_user_idx
  ON public.booking_participants (user_id, status);

CREATE TRIGGER tg_booking_participants_updated_at
  BEFORE UPDATE ON public.booking_participants
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

COMMENT ON TABLE public.booking_participants IS
  'Who is playing in a fixture. Leaving is an UPDATE to status=''out'', never '
  'a DELETE — the goalkeeper trial needs "dropped out on Tuesday" to differ '
  'from "said yes and never showed".';
COMMENT ON COLUMN public.booking_participants.slot_kind IS
  'gk | outfield. Not an index: two keepers are interchangeable, so which of '
  'the two you hold is not information the product uses.';

-- ════════════════════════════════════════════════════════════════════
-- 4. Fill the fixture's shape and seat the organiser
-- ════════════════════════════════════════════════════════════════════
-- BEFORE INSERT rather than a DEFAULT because the shape comes from the pitch,
-- which a column default cannot reach.
CREATE OR REPLACE FUNCTION public.tg_bookings_set_squad_and_token()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_type text;
BEGIN
  IF NEW.gk_slots IS NULL OR NEW.outfield_slots IS NULL THEN
    SELECT p.type INTO v_type FROM public.pitches p WHERE p.id = NEW.pitch_id;
    SELECT s.gk_slots, s.outfield_slots
      INTO NEW.gk_slots, NEW.outfield_slots
      FROM public.squad_slots_for(v_type) s;
  END IF;

  IF NEW.invite_token IS NULL THEN
    NEW.invite_token := public.new_invite_token();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_bookings_set_squad_and_token
  BEFORE INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_bookings_set_squad_and_token();

-- The organiser plays. Seating them here rather than in `create-booking`
-- makes it an invariant of the table instead of a property of one write
-- path — every booking has its organiser on the roster, however it was made
-- (Edge Function, admin, seed, psql).
--
-- Outfield by default. They can move themselves to a keeper slot afterwards;
-- somebody volunteering to go in goal is the commonest way a keeper gap gets
-- solved, so the column guard below deliberately permits it.
CREATE OR REPLACE FUNCTION public.tg_bookings_seat_organiser()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.booking_participants (booking_id, user_id, slot_kind)
  VALUES (NEW.id, NEW.user_id, 'outfield')
  ON CONFLICT (booking_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_bookings_seat_organiser
  AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_bookings_seat_organiser();

-- ════════════════════════════════════════════════════════════════════
-- 5. Policy helpers — both SECURITY DEFINER, and that is load-bearing
-- ════════════════════════════════════════════════════════════════════
-- A SELECT policy on booking_participants that asks "is the caller also a
-- participant?" queries booking_participants, which re-enters the same
-- policy. Postgres will NOT catch this: its recursion guard only fires when
-- a policy references its own table directly, and here the reference is
-- laundered through a function — so the query dies on max_stack_depth
-- instead. That is the #36 is_admin() bug exactly, on a new table, and it is
-- predictable enough to prevent rather than rediscover.
--
-- search_path is pinned per CVE-2018-1058: a SECURITY DEFINER function with
-- a mutable search_path can be hijacked by a same-named object in a schema
-- the caller controls.
-- Read access, not roster membership. Deliberately NOT filtered to
-- status='in' — found while building W6 (leave/rejoin): the fixture screen
-- has to keep showing "you're out, want back in?" to the person who just
-- left, which means their own read has to survive their own departure. A
-- stranger who was never on this roster still has no row at all and is
-- correctly excluded; only an EXISTS with no status filter distinguishes
-- "never was here" from "was here, then left" — the whole point of leaving
-- being an UPDATE rather than a DELETE. The narrower "am I an ACTIVE
-- participant right now" question belongs to callers that need it (the
-- capacity trigger already answers it directly with its own status='in'
-- count, and the invite-preview screen answers it from the roster row it
-- already has), not to the read gate.
CREATE OR REPLACE FUNCTION public.is_participant_of_booking(p_booking_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.booking_participants
    WHERE booking_id = p_booking_id
      AND user_id    = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.is_participant_of_booking(uuid) IS
  'True if the caller has ever had a roster row on this fixture — current or '
  'departed. DEFINER so the lookup does not re-enter the policy that calls '
  'it (cf. #36). Self-filters on auth.uid(), takes one argument, no dynamic '
  'SQL. NOT status-filtered: read access must survive leaving.';

-- Same reasoning: bookings'' own SELECT policy is self-or-owner-or-admin, so
-- a participant asking "who organised this?" would be filtered to zero rows
-- and every roster would look organiser-less.
CREATE OR REPLACE FUNCTION public.is_booking_organiser(p_booking_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bookings
    WHERE id = p_booking_id AND user_id = auth.uid()
  );
$$;

-- ════════════════════════════════════════════════════════════════════
-- 6. Capacity — a trigger, because it cannot be a constraint
-- ════════════════════════════════════════════════════════════════════
-- "No more than gk_slots participants with status='in'" is a count, and a
-- CHECK cannot see other rows. The booking row is locked FOR UPDATE before
-- the count: two people opening the same invite link at the same moment is
-- the EXPECTED case (that is what sending a link to a group chat does), and
-- without the lock both count 9 and both insert. Same shape as the slot hold
-- in 20260421000007.
CREATE OR REPLACE FUNCTION public.tg_booking_participants_capacity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_limit smallint;
  v_taken int;
BEGIN
  -- Only an arrival can overfill: leaving, and edits that keep both the slot
  -- kind and the status, cannot.
  IF TG_OP = 'UPDATE'
     AND NEW.status = OLD.status
     AND NEW.slot_kind = OLD.slot_kind THEN
    RETURN NEW;
  END IF;
  IF NEW.status <> 'in' THEN
    RETURN NEW;
  END IF;

  SELECT CASE WHEN NEW.slot_kind = 'gk' THEN b.gk_slots ELSE b.outfield_slots END
    INTO v_limit
    FROM public.bookings b
   WHERE b.id = NEW.booking_id
     FOR UPDATE;

  SELECT count(*)
    INTO v_taken
    FROM public.booking_participants p
   WHERE p.booking_id = NEW.booking_id
     AND p.slot_kind  = NEW.slot_kind
     AND p.status     = 'in'
     AND p.id IS DISTINCT FROM NEW.id;

  IF v_taken >= v_limit THEN
    RAISE EXCEPTION 'FIXTURE_FULL'
      USING ERRCODE = 'P0001',
            DETAIL  = format('%s slots are all taken', NEW.slot_kind);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_booking_participants_capacity
  BEFORE INSERT OR UPDATE ON public.booking_participants
  FOR EACH ROW EXECUTE FUNCTION public.tg_booking_participants_capacity();

-- ════════════════════════════════════════════════════════════════════
-- 7. Column guard — RLS is row-level; this is the column-level half
-- ════════════════════════════════════════════════════════════════════
-- A participant may change their own status (leave, rejoin) and their own
-- slot_kind (volunteer to go in goal — capacity is still enforced above).
-- They may not rewrite whose row it is, which fixture it belongs to, or when
-- they joined, because those are the record and not the state.
CREATE OR REPLACE FUNCTION public.tg_booking_participants_block_identity_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF public.is_privileged_writer() THEN
    RETURN NEW;
  END IF;

  IF NEW.booking_id IS DISTINCT FROM OLD.booking_id
  OR NEW.user_id    IS DISTINCT FROM OLD.user_id
  OR NEW.joined_at  IS DISTINCT FROM OLD.joined_at
  OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'a participant may change their own status and slot, not whose row it is'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_booking_participants_block_identity_columns
  BEFORE UPDATE ON public.booking_participants
  FOR EACH ROW EXECUTE FUNCTION public.tg_booking_participants_block_identity_columns();

-- The status/left_at pair has a CHECK constraint but nothing yet keeps the
-- timestamp honest on the way through. Set it here so a client cannot leave
-- without dating it, or rejoin while keeping a departure date.
CREATE OR REPLACE FUNCTION public.tg_booking_participants_stamp_left_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'out' AND OLD.status = 'in' THEN
    NEW.left_at := now();
  ELSIF NEW.status = 'in' THEN
    NEW.left_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_booking_participants_stamp_left_at
  BEFORE UPDATE ON public.booking_participants
  FOR EACH ROW EXECUTE FUNCTION public.tg_booking_participants_stamp_left_at();

-- ════════════════════════════════════════════════════════════════════
-- 8. RLS
-- ════════════════════════════════════════════════════════════════════
ALTER TABLE public.booking_participants ENABLE ROW LEVEL SECURITY;

-- Read: yourself, anyone on the same roster, the organiser, an admin.
-- Venue owners are deliberately absent — the owner-facing booking roster is
-- gap 2 of plans/venue-owner-admin.md, which correctly calls it a privacy
-- decision against ADR-0012 rather than a query fix. It stays with 41g.
CREATE POLICY booking_participants_select_roster ON public.booking_participants
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_participant_of_booking(booking_id)
    OR public.is_booking_organiser(booking_id)
    OR public.is_admin()
  );

-- Write: your own row only, and only to change your own state. There is NO
-- INSERT policy — join_fixture() is the only thing that creates a row
-- (ADR-0022), so the security boundary the bookings policies describe is
-- preserved rather than breached.
CREATE POLICY booking_participants_update_self ON public.booking_participants
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- No DELETE policy at all: leaving is an UPDATE. The row is the record.

-- ════════════════════════════════════════════════════════════════════
-- 9. The read path
-- ════════════════════════════════════════════════════════════════════
-- ADR-0013's shape — a dedicated view, PII excluded by construction, definer
-- rights so it can read across rows while the base tables stay locked down —
-- with the one difference DATA_MODEL recorded: a card is meant to be public
-- and a roster is not, so each view carries its own caller predicate.
--
-- Why a view at all, rather than adding `OR is_participant_of_booking(id)`
-- to bookings' SELECT policy: that one-liner would hand every teammate
-- platform_fee_cents — Ludi's cut of their friend's booking — plus notes,
-- and every column added to bookings thereafter. Same failure mode ADR-0013
-- rejected for users.
CREATE VIEW public.v_fixture
WITH (security_invoker = off) AS
  SELECT
    b.id                        AS booking_id,
    b.code,
    b.starts_at,
    b.ends_at,
    b.state,
    b.cancelled_at,
    b.cancellation_policy,
    b.cancellation_refund_cents,
    b.total_cents,
    b.gk_slots,
    b.outfield_slots,
    -- Fill counts, added for W7 (the bookings tab reusing this view as "my
    -- fixtures" — see below). "A fixture that is short should say so from
    -- the list", not only once you have opened it.
    (SELECT count(*) FROM public.booking_participants x
      WHERE x.booking_id = b.id AND x.status = 'in' AND x.slot_kind = 'gk')::int
                                AS gk_filled,
    (SELECT count(*) FROM public.booking_participants x
      WHERE x.booking_id = b.id AND x.status = 'in' AND x.slot_kind = 'outfield')::int
                                AS outfield_filled,
    -- The invite link, for the people entitled to pass it on. Everyone this
    -- view returns either created the fixture or joined it with this token,
    -- so exposing it here grants nothing they do not already hold — and the
    -- organiser cannot share a link the app refuses to show them.
    b.invite_token,
    p.id                        AS pitch_id,
    p.name                      AS pitch_name,
    p.type                      AS pitch_type,
    v.name                      AS venue_name,
    c.name_en                   AS city_name_en,
    c.name_gr                   AS city_name_gr,
    (b.user_id = auth.uid())    AS viewer_is_organiser,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'addon_code',       a.addon_code,
                'quantity',         a.quantity,
                'unit_price_cents', a.unit_price_cents)
              ORDER BY a.addon_code)
         FROM public.booking_addons a
        WHERE a.booking_id = b.id),
      '[]'::jsonb)              AS addons
  FROM public.bookings b
  JOIN public.pitches  p ON p.id = b.pitch_id
  JOIN public.venues   v ON v.id = p.venue_id
  JOIN public.cities   c ON c.id = v.city_id
 WHERE b.user_id = auth.uid()
    OR public.is_participant_of_booking(b.id)
    OR public.is_admin();

COMMENT ON VIEW public.v_fixture IS
  'A fixture as the people playing in it may see it. Never exposes '
  'platform_fee_cents, base_price_cents, notes or user_id. Doubles as "my '
  'fixtures" when queried with no booking_id filter — the WHERE clause '
  'already scopes to organiser-or-participant-or-admin, which is exactly '
  '"every fixture I am in". Carries the addon '
  'breakdown so a participant needs one read, not two — booking_addons has '
  'the same owner-only policy as bookings. ADR-0013 shape + caller predicate.';

-- The roster. First name and handle only: enough to recognise a teammate,
-- and nothing that is a way to contact them. Phone lives in auth, email and
-- stripe_customer_id and role are not here by construction.
--
-- Anonymised players (ADR-0018) are NOT filtered out. They played; the
-- fixture is a record of who played. Their name column is already anonymised
-- at the source, so the row shows what it should.
CREATE VIEW public.v_fixture_roster
WITH (security_invoker = off) AS
  SELECT
    bp.id                       AS participant_id,
    bp.booking_id,
    bp.user_id,
    bp.slot_kind,
    bp.status,
    bp.joined_at,
    bp.left_at,
    u.first_name,
    u.handle,
    (bp.user_id = b.user_id)    AS is_organiser,
    (bp.user_id = auth.uid())   AS is_you
  FROM public.booking_participants bp
  JOIN public.bookings b ON b.id = bp.booking_id
  JOIN public.users    u ON u.id = bp.user_id
 WHERE b.user_id = auth.uid()
    OR public.is_participant_of_booking(bp.booking_id)
    OR public.is_admin();

COMMENT ON VIEW public.v_fixture_roster IS
  'Who is on a fixture, readable by the people on it. first_name + handle '
  'only — no phone, email, stripe id or role, excluded by construction. The '
  'caller predicate is what makes this different from ADR-0013''s card view: '
  'a card is meant to be public, a roster is not.';

REVOKE ALL ON public.v_fixture         FROM anon;
REVOKE ALL ON public.v_fixture_roster  FROM anon;
GRANT SELECT ON public.v_fixture        TO authenticated;
GRANT SELECT ON public.v_fixture_roster TO authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 10. What a link buys you before you join
-- ════════════════════════════════════════════════════════════════════
-- Deliberately narrow: when, where, format, how many spots, whether a keeper
-- is needed. NOT names, not the roster, not the organiser. A link forwarded
-- into a second group chat must not publish who is playing to whoever it
-- reaches next (ADR-0012 minimisation, ADR-0021).
--
-- Callable by anon: the whole point is that someone without the app can see
-- what they are being invited to before installing it.
CREATE OR REPLACE FUNCTION public.fixture_preview(p_invite_token text)
RETURNS TABLE (
  -- Not PII, not the roster — the booking's own primary key. Safe to return
  -- pre-join because RLS still gates every read of v_fixture/v_fixture_roster
  -- by it; it only lets the client route to /booking/<id> after joining
  -- rather than needing a second round trip to resolve one.
  booking_id       uuid,
  starts_at        timestamptz,
  ends_at          timestamptz,
  pitch_type       text,
  pitch_name       text,
  venue_name       text,
  city_name_en     text,
  city_name_gr     text,
  gk_open          int,
  outfield_open    int,
  joinable         boolean
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT
    b.id,
    b.starts_at,
    b.ends_at,
    p.type,
    p.name,
    v.name,
    c.name_en,
    c.name_gr,
    b.gk_slots       - (SELECT count(*) FROM public.booking_participants x
                         WHERE x.booking_id = b.id AND x.status = 'in'
                           AND x.slot_kind = 'gk')::int,
    b.outfield_slots - (SELECT count(*) FROM public.booking_participants x
                         WHERE x.booking_id = b.id AND x.status = 'in'
                           AND x.slot_kind = 'outfield')::int,
    (b.state IN ('pending','paid','confirmed') AND b.starts_at > now())
  FROM public.bookings b
  JOIN public.pitches  p ON p.id = b.pitch_id
  JOIN public.venues   v ON v.id = p.venue_id
  JOIN public.cities   c ON c.id = v.city_id
 WHERE b.invite_token = p_invite_token;
$$;

COMMENT ON FUNCTION public.fixture_preview(text) IS
  'What an invite link shows before you are on the roster: when, where, '
  'format, spots open, whether it can still be joined, and the booking id '
  'to route to after joining. No names — see ADR-0021.';

-- ════════════════════════════════════════════════════════════════════
-- 11. Joining
-- ════════════════════════════════════════════════════════════════════
-- The only thing that creates a participant row. DEFINER rather than an Edge
-- Function (ADR-0022): no money moves, the capacity check must be atomic with
-- the write, and the capability is a token that RLS cannot see.
--
-- Errors carry a stable SCREAMING_SNAKE message so the mobile client switches
-- on error codes exactly as it does for cancel-booking, rather than learning
-- a second dialect.
CREATE OR REPLACE FUNCTION public.join_fixture(
  p_invite_token text,
  p_slot_kind    text DEFAULT 'outfield'
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_id      uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN' USING ERRCODE = 'P0001';
  END IF;

  IF p_slot_kind NOT IN ('gk','outfield') THEN
    RAISE EXCEPTION 'INVALID_SLOT_KIND' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_booking
    FROM public.bookings
   WHERE invite_token = p_invite_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_INVITE' USING ERRCODE = 'P0001';
  END IF;

  IF v_booking.state NOT IN ('pending','paid','confirmed') THEN
    RAISE EXCEPTION 'FIXTURE_CANCELLED' USING ERRCODE = 'P0001';
  END IF;

  IF v_booking.starts_at <= now() THEN
    RAISE EXCEPTION 'FIXTURE_STARTED' USING ERRCODE = 'P0001';
  END IF;

  -- Rejoining is the same row coming back, not a second one. Capacity is
  -- re-checked by the trigger on the way through, so someone who left a full
  -- fixture does not get their slot back automatically.
  UPDATE public.booking_participants
     SET status = 'in', slot_kind = p_slot_kind
   WHERE booking_id = v_booking.id
     AND user_id    = auth.uid()
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.booking_participants (booking_id, user_id, slot_kind)
  VALUES (v_booking.id, auth.uid(), p_slot_kind)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.join_fixture(text, text) IS
  'Take a slot on a fixture using its invite token. The only writer of '
  'booking_participants — the table has no INSERT policy. Raises '
  'INVALID_INVITE / FIXTURE_CANCELLED / FIXTURE_STARTED / FIXTURE_FULL / '
  'INVALID_SLOT_KIND / NOT_SIGNED_IN. See ADR-0022.';

REVOKE ALL ON FUNCTION public.join_fixture(text, text)    FROM public;
REVOKE ALL ON FUNCTION public.fixture_preview(text)       FROM public;
GRANT EXECUTE ON FUNCTION public.join_fixture(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fixture_preview(text)    TO anon, authenticated;

-- ════════════════════════════════════════════════════════════════════
-- 12. Backfill
-- ════════════════════════════════════════════════════════════════════
-- Existing bookings predate all of the above: give them a shape, a token,
-- and their organiser's seat. Ordered so the NOT NULLs below hold.
UPDATE public.bookings b
   SET gk_slots       = s.gk_slots,
       outfield_slots = s.outfield_slots,
       invite_token   = COALESCE(b.invite_token, public.new_invite_token())
  FROM public.pitches p,
       LATERAL public.squad_slots_for(p.type) s
 WHERE p.id = b.pitch_id
   AND (b.gk_slots IS NULL OR b.outfield_slots IS NULL OR b.invite_token IS NULL);

INSERT INTO public.booking_participants (booking_id, user_id, slot_kind)
SELECT b.id, b.user_id, 'outfield'
  FROM public.bookings b
 ON CONFLICT (booking_id, user_id) DO NOTHING;

ALTER TABLE public.bookings
  ALTER COLUMN gk_slots       SET NOT NULL,
  ALTER COLUMN outfield_slots SET NOT NULL,
  ALTER COLUMN invite_token   SET NOT NULL,
  ADD CONSTRAINT bookings_invite_token_key UNIQUE (invite_token),
  ADD CONSTRAINT bookings_gk_slots_positive       CHECK (gk_slots > 0),
  ADD CONSTRAINT bookings_outfield_slots_positive CHECK (outfield_slots > 0);

COMMENT ON COLUMN public.bookings.invite_token IS
  'Bearer capability for joining this fixture. NOT the booking code, which '
  'is sequential and therefore enumerable (ADR-0021). Rotate to revoke every '
  'link already shared. Never rendered as text in the UI.';
COMMENT ON COLUMN public.bookings.gk_slots IS
  'Keeper slots, frozen at booking time from the pitch type. Stored rather '
  'than derived so an owner editing the pitch cannot reshape a fixture people '
  'have already joined — same reasoning as base_price_cents.';
