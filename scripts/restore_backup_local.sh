#!/usr/bin/env bash
# restore_backup_local.sh — rehearse a restore of a backups.yml artifact
# (made in the private repo NikolasNeofytou/ludi-backups) into
# a throwaway local Postgres, and compare row counts with the manifest that
# was written at dump time. Runbook: docs/runbooks/restore-from-backup.md
#
#   usage: scripts/restore_backup_local.sh <artifact-dir-or-.enc-file>
#
# Needs: docker, pg_restore/psql >= 17 on PATH (brew install postgresql@17),
# and BACKUP_PASSPHRASE in the environment (the same one the workflow used).
#
# The scratch database runs the image production runs (supabase/postgres,
# the tag CI's dry-run pins in .github/workflows/ci.yml): it carries the
# Supabase roles, vault, pg_net, pg_cron and PostGIS. A plain postgres:17
# lacked PostGIS and btree_gist, so venues, cities and the booking overlap
# guards never came back (first rehearsal, 2026-10-22). The image's
# baseline `auth` schema is dropped first so the dump rebuilds it as prod
# has it, and the extensions go into the schemas prod keeps them in.
# What this rehearsal proves is that the file decrypts, the archive is
# whole, and the tables and their rows all come back.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
tag="$(sed -n 's/^ *TAG: *//p' "$repo/.github/workflows/ci.yml" | head -1)"
image="${RESTORE_IMAGE:-public.ecr.aws/supabase/postgres:${tag:?no TAG in ci.yml}}"

src="${1:?path to the downloaded artifact directory or the .enc file}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"

if [ -d "$src" ]; then
  enc="$(ls "$src"/*.enc | head -1)"
  manifest="$src/manifest.txt"
else
  enc="$src"
  manifest="$(dirname "$src")/manifest.txt"
fi
[ -f "$enc" ] || { echo "no .enc file at $src" >&2; exit 1; }

work="$(mktemp -d)"
dump="$work/restore.dump"
container="ludi-restore-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT

start=$(date +%s)
echo "→ decrypting $(basename "$enc")"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in "$enc" -out "$dump" -pass env:BACKUP_PASSPHRASE
entries="$(pg_restore --list "$dump" | wc -l | tr -d ' ')"
echo "  archive entries: $entries"

echo "→ starting scratch $image ($container)"
# Docker picks a free port, on loopback only: a fixed port clashes with other
# projects' containers, and the restored rows are prod's.
docker run -d --rm --name "$container" -e POSTGRES_PASSWORD=restore -p 127.0.0.1::5432 "$image" >/dev/null
port="$(docker port "$container" 5432/tcp | head -1 | sed 's/.*://')"
echo "  listening on 127.0.0.1:$port"
# supabase_admin is the superuser on this image; postgres is not.
url="postgresql://supabase_admin:restore@127.0.0.1:$port/postgres"
# The image runs its first-boot scripts on a socket-only server, then
# restarts on TCP; wait for the second one.
ready=0
for _ in $(seq 1 90); do
  if psql -w "$url" -Atc 'select 1' >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ "$ready" = 1 ] || { echo "scratch database never came up" >&2; docker logs "$container" 2>&1 | tail -20 >&2; exit 1; }

echo "→ preparing the schemas as prod has them"
psql -w "$url" -X -v ON_ERROR_STOP=1 -q <<'SQL'
set client_min_messages = warning;
-- The image's auth schema is GoTrue's five-table baseline; the dump
-- carries prod's (23 tables), so it rebuilds the schema itself.
drop schema auth cascade;
create extension if not exists btree_gist with schema public;
create extension if not exists citext with schema public;
create extension if not exists pg_trgm with schema public;
create extension if not exists postgis with schema public;
create extension if not exists pg_net with schema extensions;
SQL

echo "→ pg_restore"
set +e
pg_restore --dbname="$url" --no-owner --no-privileges --jobs=2 "$dump" 2> "$work/restore.err"
rc=$?
set -e
# `schema "public" already exists` is the one error every restore of a
# --schema=public dump makes; anything else is worth reading.
grep 'ERROR' "$work/restore.err" | grep -v 'schema "public" already exists' > "$work/unexpected.err" || true
err_count="$(wc -l < "$work/unexpected.err" | tr -d ' ')"
echo "  pg_restore exit $rc, $err_count unexpected errors"
sed -E 's/^pg_restore: error: could not execute query: //' "$work/unexpected.err" | sort | uniq -c | sort -rn | sed 's/^/    /' | head -30

echo "→ row counts: restored vs manifest"
printf '%-16s %10s %10s\n' table restored manifest
ok=1
for t in bookings users venues auth.users; do
  case "$t" in auth.users) q="select count(*) from auth.users" ;; *) q="select count(*) from public.$t" ;; esac
  got="$(psql -w "$url" -Atc "$q" 2>/dev/null || echo missing)"
  want="$(grep "^$t|" "$manifest" 2>/dev/null | cut -d'|' -f2)"
  mark=" "
  if [ "$got" = missing ] || { [ -n "$want" ] && [ "$got" != "$want" ]; }; then mark="✗"; ok=0; fi
  printf '%-16s %10s %10s %s\n' "$t" "$got" "${want:-?}" "$mark"
done
[ "$err_count" = 0 ] || ok=0

echo "→ done in $(( $(date +%s) - start ))s"
if [ "$ok" = 1 ]; then
  echo "RESTORE OK — counts match the manifest. Record the date in docs/runbooks/restore-from-backup.md."
else
  echo "RESTORE MISMATCH — investigate before trusting this backup." >&2
  exit 1
fi
