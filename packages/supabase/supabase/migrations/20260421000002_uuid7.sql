-- 20260421000002_uuid7.sql
-- Generates UUID v7 per the IETF draft (draft-ietf-uuidrev-rfc4122bis).
-- Layout: 48-bit Unix ms timestamp | 4-bit version (0x7) | 12 random | 2-bit variant | 62 random.
-- Time-ordered so B-tree indexes stay hot on insert. Opaque to clients.
--
-- Postgres 18+ will ship uuidv7() natively; until then, PL/pgSQL implementation.
-- See https://datatracker.ietf.org/doc/draft-ietf-uuidrev-rfc4122bis/

CREATE OR REPLACE FUNCTION public.uuid7() RETURNS uuid
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  unix_ts_ms bigint;
  uuid_bytes bytea;
BEGIN
  unix_ts_ms := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint;
  uuid_bytes := gen_random_bytes(16);

  -- 48-bit timestamp in the first 6 bytes
  uuid_bytes := set_byte(uuid_bytes, 0, ((unix_ts_ms >> 40) & 255)::int);
  uuid_bytes := set_byte(uuid_bytes, 1, ((unix_ts_ms >> 32) & 255)::int);
  uuid_bytes := set_byte(uuid_bytes, 2, ((unix_ts_ms >> 24) & 255)::int);
  uuid_bytes := set_byte(uuid_bytes, 3, ((unix_ts_ms >> 16) & 255)::int);
  uuid_bytes := set_byte(uuid_bytes, 4, ((unix_ts_ms >>  8) & 255)::int);
  uuid_bytes := set_byte(uuid_bytes, 5, ( unix_ts_ms        & 255)::int);

  -- Version 7 in byte 6, upper nibble
  uuid_bytes := set_byte(uuid_bytes, 6, ((get_byte(uuid_bytes, 6) & 15) | 112));
  -- RFC 4122 variant (10xxxxxx) in byte 8, upper bits
  uuid_bytes := set_byte(uuid_bytes, 8, ((get_byte(uuid_bytes, 8) & 63) | 128));

  RETURN encode(uuid_bytes, 'hex')::uuid;
END;
$$;

COMMENT ON FUNCTION public.uuid7() IS
  'UUID v7 (time-ordered). Use as default for every primary key column.';
