#!/usr/bin/env bash
#
# double_book.sh — concurrency test for the bookings EXCLUDE constraint.
#
# Stage 2 exit criterion (docs/roadmap.md, Booking & checkout):
#   "create-booking Edge Function atomic under load: 100 parallel
#    double-book attempts result in exactly one success."
#
# This bypasses the create-booking Edge Function and tests the underlying
# DB invariant directly: the EXCLUDE USING gist constraint on bookings,
# strengthened to cover `pending` (migration ...000007). N independent
# transactions each insert a booking row for the same (pitch, time_range).
# Postgres serializes the conflict check via the GiST index — exactly one
# transaction commits, the rest fail with SQLSTATE 23P01.
#
# Why test the constraint and not the Edge Function:
#   - The Function inherits the property: it issues a single INSERT and
#     translates 23P01 to SLOT_UNAVAILABLE. If the constraint serializes
#     correctly, the Function does too.
#   - Going through the Function would require a Stripe mock + JWTs for
#     N users. The constraint lives one layer down and is the actual
#     invariant — if it ever regresses (someone drops 'pending' from the
#     predicate, an index becomes invalid), the Function silently lets
#     two people pay for the same slot and we eat refunds at settle time.
#
# Usage:
#   PGURL=postgresql://postgres:postgres@localhost:5432/postgres ./double_book.sh
#   NUM_ATTEMPTS=200 ./double_book.sh         # crank up the contention
#
# Exit code: 0 on green; non-zero with diagnostics on regression.

set -euo pipefail

NUM=${NUM_ATTEMPTS:-100}
PGURL="${PGURL:-postgresql://postgres:postgres@localhost:5432/postgres}"

# Seed-fixture pitch (Larnaca Sportsplex Pitch 1, 5-a-side, €40/hr). Its
# fixture id is asserted in the CI sanity-check step, so this test fails
# loudly if the seed shape changes.
PITCH_ID='00000000-0000-4000-8000-000000000101'

# Far-future slot — won't collide with realistic seed data or any other
# test that happens to insert bookings on the same fixture pitch.
SLOT_START='2099-12-31T10:00:00+00:00'
SLOT_END='2099-12-31T11:00:00+00:00'

# Test-fixture user UUID prefix (4dbc = "double-book ci"). The cleanup
# trap deletes everything matching this prefix so a partial run doesn't
# leave rows behind to confuse the next attempt.
USER_PREFIX='00000000-0000-4dbc-8000-'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSERT_SQL="$SCRIPT_DIR/_insert_one.sql"
# One outfile per attempt, then concat. Writing all attempts to a single
# file via xargs > pipe interleaves multi-line psql ERROR output between
# parallel processes (POSIX write atomicity is only guaranteed up to
# PIPE_BUF, not for arbitrary blocks).
RESULTS_DIR=$(mktemp -d -t double_book.XXXXXX)

log()  { printf '\033[0;34m→\033[0m %s\n' "$1"; }
ok()   { printf '  \033[0;32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[0;31m✗\033[0m %s\n' "$1" >&2; exit 1; }

cleanup() {
  psql "$PGURL" -q -X -v ON_ERROR_STOP=0 \
    -c "DELETE FROM public.bookings WHERE pitch_id = '$PITCH_ID' AND starts_at = '$SLOT_START';" \
    -c "DELETE FROM public.users   WHERE id::text LIKE '${USER_PREFIX}%';" \
    -c "DELETE FROM auth.users     WHERE id::text LIKE '${USER_PREFIX}%';" \
    >/dev/null 2>&1 || true
  rm -rf "$RESULTS_DIR"
}
trap cleanup EXIT

# Sanity: the seed fixture must be present, and the EXCLUDE predicate must
# still cover 'pending'. Without these the test would fail with a generic
# FK or success-of-many that masks the real regression.
PITCH_OK=$(psql "$PGURL" -tAc "SELECT count(*) FROM public.pitches WHERE id = '$PITCH_ID';")
[ "$PITCH_OK" = "1" ] || fail "seed pitch $PITCH_ID missing — apply migrations + seed.sql first"

CITY_ID=$(psql "$PGURL" -tAc "SELECT id FROM public.cities WHERE code = 'larnaca' LIMIT 1;")
[ -n "$CITY_ID" ] || fail "Larnaca city not in cities table — seed missing"

PRED=$(psql "$PGURL" -tAc \
  "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'bookings_pitch_id_time_range_excl';")
echo "$PRED" | grep -q "'pending'" \
  || fail "bookings EXCLUDE predicate missing 'pending' state — migration regression"

log "Setup: $NUM users in auth.users + public.users"
# Plain SQL with generate_series — psql -v interpolation works here but
# would NOT work inside a DO $$ ... $$ block (dollar-quoted strings are
# opaque to the psql preprocessor). Stay set-based.
psql "$PGURL" -q -X -v ON_ERROR_STOP=1 \
  -v num="$NUM" -v prefix="$USER_PREFIX" -v city_id="$CITY_ID" <<'SQL'
INSERT INTO auth.users (id)
SELECT (:'prefix' || lpad(g::text, 12, '0'))::uuid
FROM generate_series(1, :'num'::int) g
ON CONFLICT DO NOTHING;

INSERT INTO public.users (id, first_name, last_name, city_id, role)
SELECT
  (:'prefix' || lpad(g::text, 12, '0'))::uuid,
  'load',
  'test' || g,
  :'city_id'::uuid,
  'player'
FROM generate_series(1, :'num'::int) g
ON CONFLICT DO NOTHING;
SQL
ok "$NUM users ready"

# Worker function — exported so xargs subshells can use it. One attempt
# per call; each writes to its own file in RESULTS_DIR so concurrent
# attempts can never interleave each other's output.
export PGURL PITCH_ID SLOT_START SLOT_END USER_PREFIX INSERT_SQL RESULTS_DIR

attempt() {
  local i="$1"
  local user_id
  user_id=$(printf '%s%012d' "$USER_PREFIX" "$i")
  # -X skips ~/.psqlrc. We deliberately do NOT pass -q (quiet) or -t/-A
  # — those suppress the "INSERT 0 1" command tag we tally on.
  psql "$PGURL" -X -v ON_ERROR_STOP=0 \
    -v "i=$i" \
    -v "user_id=$user_id" \
    -v "pitch_id=$PITCH_ID" \
    -v "slot_start=$SLOT_START" \
    -v "slot_end=$SLOT_END" \
    -f "$INSERT_SQL" \
    > "$RESULTS_DIR/$i.out" 2>&1
}
export -f attempt

log "Fire $NUM parallel INSERTs at the same slot"
# `xargs -P $NUM` runs up to N attempt() calls concurrently. Output goes
# to per-attempt files (no interleave), then we tally over all files.
seq 1 "$NUM" | xargs -n 1 -P "$NUM" -I {} bash -c 'attempt "$@"' _ {}

log "Tally"
SUCCESS=$(grep -l 'INSERT 0 1' "$RESULTS_DIR"/*.out 2>/dev/null | wc -l | tr -d ' ')
EXCLUSIONS=$(grep -li 'conflicting key value violates exclusion constraint' \
  "$RESULTS_DIR"/*.out 2>/dev/null | wc -l | tr -d ' ')
TOTAL_FILES=$(ls "$RESULTS_DIR"/*.out 2>/dev/null | wc -l | tr -d ' ')
OTHER=$(( TOTAL_FILES - SUCCESS - EXCLUSIONS ))

ok "successes:       $SUCCESS / $NUM"
ok "exclusion 23P01: $EXCLUSIONS / $NUM"

if [ "$OTHER" -ne "0" ]; then
  echo
  echo '--- attempts that produced neither success nor exclusion: ---'
  for f in "$RESULTS_DIR"/*.out; do
    if ! grep -q 'INSERT 0 1' "$f" \
       && ! grep -qi 'conflicting key value violates exclusion constraint' "$f"; then
      echo "[$(basename "$f")]"
      cat "$f"
      echo
    fi
  done | head -40
  echo '---'
  fail "$OTHER attempts produced neither a success nor an exclusion violation"
fi

[ "$SUCCESS" -eq "1" ] || fail "expected exactly 1 success, got $SUCCESS — EXCLUDE constraint regressed"
[ "$EXCLUSIONS" -eq "$(( NUM - 1 ))" ] || fail "expected $((NUM - 1)) exclusions, got $EXCLUSIONS"

# Verify the surviving row is actually committed (not phantom-cleaned).
COMMITTED=$(psql "$PGURL" -tAc "
  SELECT count(*) FROM public.bookings
   WHERE pitch_id = '$PITCH_ID' AND starts_at = '$SLOT_START';
")
[ "$COMMITTED" = "1" ] || fail "expected 1 committed booking, found $COMMITTED"

ok "EXCLUDE serializes $NUM concurrent inserts to exactly 1 winner"
