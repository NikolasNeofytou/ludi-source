-- 20260421000001_extensions.sql
-- Enables every Postgres extension we rely on across the app.
-- Run once, at the top of migration history. Safe to re-apply.

-- UUID generation (pgcrypto provides gen_random_bytes() used by uuid7()).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Case-insensitive text (for handles and emails).
CREATE EXTENSION IF NOT EXISTS citext;

-- GiST index ops for B-tree types — required for the EXCLUDE constraint
-- on bookings(pitch_id WITH =, time_range WITH &&), where pitch_id is a uuid.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Spatial types (pitches.coords, cities.bounds). Used in Stage 4 Mapbox
-- integration; adding it now means zero schema surgery later.
CREATE EXTENSION IF NOT EXISTS postgis;
