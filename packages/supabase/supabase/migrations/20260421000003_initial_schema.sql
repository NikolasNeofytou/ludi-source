-- 20260421000003_initial_schema.sql
-- MVP booking-loop schema.  See docs/data-model.md for rationale and ERD.
-- Order: cities -> users (depends on cities) -> venues -> venue_owners ->
-- pitches -> pitch_schedules + overrides -> bookings -> booking_addons ->
-- payments -> admin_actions -> shared triggers and helpers.

-- ────────────────────────────────────────────────────────────────────
-- Shared trigger helper: maintain updated_at.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ────────────────────────────────────────────────────────────────────
-- cities
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE public.cities (
  id              uuid PRIMARY KEY DEFAULT public.uuid7(),
  code            text UNIQUE NOT NULL,
  name_en         text NOT NULL,
  name_gr         text NOT NULL,
  is_enabled      boolean NOT NULL DEFAULT FALSE,
  bounds          GEOGRAPHY(POLYGON, 4326),
  display_order   int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cities_enabled_order_idx
  ON public.cities (is_enabled, display_order)
  WHERE is_enabled;

COMMENT ON TABLE  public.cities        IS 'Reference table of launch cities. is_enabled flips on for live cities.';
COMMENT ON COLUMN public.cities.code   IS 'Stable slug used in API and code: nicosia, limassol, larnaca, paphos, ayia_napa.';

-- ────────────────────────────────────────────────────────────────────
-- users — 1:1 with auth.users
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE public.users (
  id                  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name          text NOT NULL,
  last_name           text NOT NULL,
  handle              citext UNIQUE,
  city_id             uuid NOT NULL REFERENCES public.cities(id),
  skill_level         smallint NOT NULL DEFAULT 3 CHECK (skill_level BETWEEN 1 AND 5),
  preferred_locale    text NOT NULL DEFAULT 'en' CHECK (preferred_locale IN ('en','gr')),
  positions           text[] NOT NULL DEFAULT '{}',
  preferred_foot      text CHECK (preferred_foot IN ('left','right','both')),
  role                text NOT NULL DEFAULT 'player' CHECK (role IN ('player','admin')),
  stripe_customer_id  text UNIQUE,
  anonymized_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX users_city_idx ON public.users (city_id);

CREATE TRIGGER tg_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

COMMENT ON TABLE  public.users                IS 'Profile row, 1:1 with auth.users (same id). PII nulled and anonymized_at set on GDPR erasure.';
COMMENT ON COLUMN public.users.role           IS 'Platform role. Players cannot self-promote via UPDATE (RLS column-level policy).';
COMMENT ON COLUMN public.users.anonymized_at  IS 'GDPR soft-delete marker. When set, PII columns are nulled but row remains for FK integrity.';

-- ────────────────────────────────────────────────────────────────────
-- venues
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE public.venues (
  id                      uuid PRIMARY KEY DEFAULT public.uuid7(),
  name                    text NOT NULL,
  address                 text NOT NULL,
  city_id                 uuid NOT NULL REFERENCES public.cities(id),
  coords                  GEOGRAPHY(POINT, 4326) NOT NULL,
  contact_phone           text,
  contact_email           citext,
  stripe_account_id       text UNIQUE,
  stripe_account_status   text NOT NULL DEFAULT 'pending'
                          CHECK (stripe_account_status IN ('pending','active','restricted','disabled')),
  take_rate_bps           smallint NOT NULL DEFAULT 1000 CHECK (take_rate_bps BETWEEN 0 AND 5000),
  cancellation_policy     text NOT NULL DEFAULT 'standard'
                          CHECK (cancellation_policy IN ('standard','strict','flex')),
  is_active               boolean NOT NULL DEFAULT TRUE,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX venues_city_active_idx ON public.venues (city_id, is_active);

CREATE TRIGGER tg_venues_updated_at
  BEFORE UPDATE ON public.venues
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

COMMENT ON COLUMN public.venues.take_rate_bps IS 'Ludi commission in basis points. 1000 = 10%. Per-venue so we can seed early partners at lower rates.';

-- ────────────────────────────────────────────────────────────────────
-- venue_owners — N:M users <-> venues
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE public.venue_owners (
  venue_id    uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.users(id)  ON DELETE RESTRICT,
  role        text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','manager')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (venue_id, user_id)
);

CREATE INDEX venue_owners_user_idx ON public.venue_owners (user_id);

-- ────────────────────────────────────────────────────────────────────
-- pitches
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE public.pitches (
  id                      uuid PRIMARY KEY DEFAULT public.uuid7(),
  venue_id                uuid NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
  name                    text NOT NULL,
  type                    text NOT NULL CHECK (type IN ('5-a-side','7-a-side','11-a-side')),
  surface                 text NOT NULL CHECK (surface IN ('turf','grass','indoor')),
  price_per_hour_cents    int NOT NULL CHECK (price_per_hour_cents > 0),
  amenities               text[] NOT NULL DEFAULT '{}',
  hero_image_url          text,
  is_verified             boolean NOT NULL DEFAULT FALSE,
  is_active               boolean NOT NULL DEFAULT TRUE,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pitches_venue_idx ON public.pitches (venue_id);
CREATE INDEX pitches_bookable_idx ON public.pitches (is_verified, is_active)
  WHERE is_verified AND is_active;

CREATE TRIGGER tg_pitches_updated_at
  BEFORE UPDATE ON public.pitches
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Gate pitch verification on the parent venue's Stripe status.  If the venue
-- is not active in Stripe we force is_verified = false regardless of the
-- caller's intent.  Keeps "verified + active" a reliable bookability signal.
CREATE OR REPLACE FUNCTION public.tg_pitches_verify_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  IF NEW.is_verified THEN
    SELECT stripe_account_status INTO v_status
    FROM public.venues WHERE id = NEW.venue_id;
    IF v_status IS DISTINCT FROM 'active' THEN
      NEW.is_verified := false;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tg_pitches_verify_guard
  BEFORE INSERT OR UPDATE ON public.pitches
  FOR EACH ROW EXECUTE FUNCTION public.tg_pitches_verify_guard();

-- ────────────────────────────────────────────────────────────────────
-- pitch_schedules — weekly recurring template
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE public.pitch_schedules (
  id                      uuid PRIMARY KEY DEFAULT public.uuid7(),
  pitch_id                uuid NOT NULL REFERENCES public.pitches(id) ON DELETE CASCADE,
  day_of_week             smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  opens_at                time NOT NULL,
  closes_at               time NOT NULL CHECK (closes_at > opens_at),
  slot_duration_minutes   smallint NOT NULL DEFAULT 60
                          CHECK (slot_duration_minutes IN (30,60,90,120)),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pitch_schedules_pitch_dow_idx ON public.pitch_schedules (pitch_id, day_of_week);

CREATE TRIGGER tg_pitch_schedules_updated_at
  BEFORE UPDATE ON public.pitch_schedules
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

COMMENT ON TABLE public.pitch_schedules IS
  'Weekly recurring opening hours. Multiple rows allowed per (pitch, day) if a pitch has split windows.';

-- ────────────────────────────────────────────────────────────────────
-- pitch_schedule_overrides — per-date exceptions
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE public.pitch_schedule_overrides (
  id              uuid PRIMARY KEY DEFAULT public.uuid7(),
  pitch_id        uuid NOT NULL REFERENCES public.pitches(id) ON DELETE CASCADE,
  override_date   date NOT NULL,
  is_closed       boolean NOT NULL DEFAULT FALSE,
  opens_at        time,
  closes_at       time,
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pitch_id, override_date),
  CHECK (
    is_closed = TRUE
    OR (opens_at IS NOT NULL AND closes_at IS NOT NULL AND closes_at > opens_at)
  )
);

-- ────────────────────────────────────────────────────────────────────
-- bookings — the core transaction
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE public.bookings (
  id                          uuid PRIMARY KEY DEFAULT public.uuid7(),
  code                        text UNIQUE NOT NULL,
  user_id                     uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  pitch_id                    uuid NOT NULL REFERENCES public.pitches(id) ON DELETE RESTRICT,
  starts_at                   timestamptz NOT NULL,
  ends_at                     timestamptz NOT NULL CHECK (ends_at > starts_at),
  time_range                  tstzrange GENERATED ALWAYS AS
                              (tstzrange(starts_at, ends_at, '[)')) STORED,
  state                       text NOT NULL DEFAULT 'pending'
                              CHECK (state IN (
                                'pending','paid','confirmed','completed',
                                'cancelled','refunded','refunded_by_admin','cancelled_no_refund'
                              )),
  base_price_cents            int NOT NULL CHECK (base_price_cents > 0),
  addons_price_cents          int NOT NULL DEFAULT 0 CHECK (addons_price_cents >= 0),
  total_cents                 int NOT NULL CHECK (total_cents > 0),
  platform_fee_cents          int NOT NULL CHECK (platform_fee_cents >= 0),
  cancellation_policy         text NOT NULL
                              CHECK (cancellation_policy IN ('standard','strict','flex')),
  cancelled_at                timestamptz,
  cancellation_refund_cents   int CHECK (cancellation_refund_cents IS NULL
                                         OR cancellation_refund_cents >= 0),
  notes                       text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  -- The core invariant: no two active bookings overlap on the same pitch.
  -- Cancelled and refunded bookings don't block re-use.
  EXCLUDE USING gist (
    pitch_id WITH =,
    time_range WITH &&
  ) WHERE (state IN ('paid','confirmed','completed'))
);

CREATE INDEX bookings_user_state_idx  ON public.bookings (user_id, state);
CREATE INDEX bookings_pitch_start_idx ON public.bookings (pitch_id, starts_at);
CREATE INDEX bookings_pending_idx     ON public.bookings (state) WHERE state IN ('pending','paid');

CREATE TRIGGER tg_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

COMMENT ON CONSTRAINT bookings_pitch_id_time_range_excl ON public.bookings IS
  'Double-booking prevention: no two active bookings overlap on the same pitch.';

-- ────────────────────────────────────────────────────────────────────
-- booking_addons
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE public.booking_addons (
  booking_id          uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  addon_code          text NOT NULL CHECK (addon_code IN ('bibs','ball_rental')),
  quantity            smallint NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents    int NOT NULL CHECK (unit_price_cents >= 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (booking_id, addon_code)
);

-- ────────────────────────────────────────────────────────────────────
-- payments — 1:N from bookings
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE public.payments (
  id                          uuid PRIMARY KEY DEFAULT public.uuid7(),
  booking_id                  uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  stripe_payment_intent_id    text UNIQUE NOT NULL,
  amount_cents                int NOT NULL CHECK (amount_cents > 0),
  application_fee_cents       int NOT NULL CHECK (application_fee_cents >= 0),
  status                      text NOT NULL CHECK (status IN (
                                'requires_payment_method','requires_confirmation',
                                'processing','succeeded','cancelled','failed',
                                'refunded','partially_refunded'
                              )),
  failure_code                text,
  failure_message             text,
  refunded_amount_cents       int NOT NULL DEFAULT 0 CHECK (refunded_amount_cents >= 0),
  stripe_latest_event_at      timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payments_booking_idx ON public.payments (booking_id);
CREATE INDEX payments_failed_idx  ON public.payments (status) WHERE status = 'failed';

CREATE TRIGGER tg_payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ────────────────────────────────────────────────────────────────────
-- admin_actions — audit log
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE public.admin_actions (
  id              uuid PRIMARY KEY DEFAULT public.uuid7(),
  admin_user_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  action_type     text NOT NULL CHECK (action_type IN (
                    'refund_booking','verify_pitch','deactivate_pitch','activate_pitch',
                    'create_venue','deactivate_venue','anonymize_user','other'
                  )),
  target_type     text NOT NULL CHECK (target_type IN ('booking','pitch','venue','user','payment')),
  target_id       uuid NOT NULL,
  reason          text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX admin_actions_admin_idx ON public.admin_actions (admin_user_id, created_at DESC);
CREATE INDEX admin_actions_target_idx ON public.admin_actions (target_type, target_id);

-- ────────────────────────────────────────────────────────────────────
-- booking_codes_seq — per-city-per-year counter
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE public.booking_codes_seq (
  city_prefix   text NOT NULL,
  year          int  NOT NULL,
  last_seq      int  NOT NULL DEFAULT 0,
  PRIMARY KEY (city_prefix, year)
);

-- generate_booking_code(city_prefix text, year int) RETURNS text
-- Returns the next code in the form PREFIX-YEAR-NNNN using row-level locking.
CREATE OR REPLACE FUNCTION public.generate_booking_code(p_city_prefix text, p_year int)
RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_seq int;
BEGIN
  INSERT INTO public.booking_codes_seq (city_prefix, year, last_seq)
  VALUES (p_city_prefix, p_year, 1)
  ON CONFLICT (city_prefix, year)
  DO UPDATE SET last_seq = public.booking_codes_seq.last_seq + 1
  RETURNING last_seq INTO v_seq;

  RETURN p_city_prefix || '-' || p_year || '-' || lpad(v_seq::text, 4, '0');
END;
$$;

COMMENT ON FUNCTION public.generate_booking_code(text,int) IS
  'Atomic per-(city, year) sequence for public-safe booking codes like LAR-2026-0001.';

-- ────────────────────────────────────────────────────────────────────
-- RLS enablement — policies themselves ship in the next migration (Phase 4).
-- Enable RLS on every user-visible table now so nothing is accidentally
-- world-readable before policies are attached.
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.cities                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venues                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_owners             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pitches                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pitch_schedules          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pitch_schedule_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_addons           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_actions            ENABLE ROW LEVEL SECURITY;
