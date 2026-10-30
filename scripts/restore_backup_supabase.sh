#!/usr/bin/env bash
# restore_backup_supabase.sh — the real restore path (runbook §2, steps 2–5):
# a backups.yml dump from the private repo NikolasNeofytou/ludi-backups,
# restored into a NEW Supabase project; then every table's rows are
# compared with the dump, and the four headline counts with the manifest
# written at dump time. Runbook: docs/runbooks/restore-from-backup.md
#
#   usage: scripts/restore_backup_supabase.sh <new project's ref or name> <artifact-dir | .enc file | latest>
#
# `latest` downloads the newest green Backups artifact with gh. The new
# project's database password and BACKUP_PASSPHRASE are read at hidden
# prompts (an exported BACKUP_PASSPHRASE is used as is), so neither lands
# in the shell history. Needs: the supabase CLI (logged in), gh, jq, and
# pg_restore/psql >= 17 on PATH (brew install postgresql@17).
#
# It refuses prod's ref, and any target that already holds bookings or
# users: a data-only restore into a live database would mix two histories.
# Migrations come from origin/main whatever branch this checkout is on,
# because prod is deployed from main. The project is linked from a
# temporary copy, so no checkout's `supabase link` changes.
#
# Why the restore is shaped the way it is (found 2026-10-22, on prod's
# image): `postgres` is not a superuser on Supabase, so pg_restore's
# --disable-triggers fails ("RI_ConstraintTrigger… is a system trigger",
# "must be owner of table users"). The signup trigger on auth.users then
# fires, foreign keys reject rows loaded out of order, and nothing comes
# back. `session_replication_role = replica` is the switch Supabase lets
# `postgres` use instead; it turns user triggers and foreign-key checks
# off for the session. The whole load is one transaction, so a failure
# leaves the new project empty and the script can simply be run again.
# auth.schema_migrations is skipped: the new project's auth server wrote
# its own, and `postgres` may not insert there.
#
# To rehearse the script itself against a local supabase/postgres
# container, set RESTORE_TARGET_DB_URL to that database's URL: the link
# step is skipped and the migrations are pushed to the URL.
set -euo pipefail

prod_ref=kotigxeeigjytdtwklyu
backups_repo=NikolasNeofytou/ludi-backups
repo="$(cd "$(dirname "$0")/.." && pwd)"

target="${1:?ref or name of the new project}"
src="${2:?artifact directory, .enc file, or latest}"
for tool in supabase gh jq psql pg_restore openssl; do
  command -v "$tool" >/dev/null || { echo "missing $tool on PATH" >&2; exit 1; }
done
for tool in psql pg_restore; do
  major="$("$tool" --version | sed -E 's/.* ([0-9]+)\..*/\1/')"
  [ "$major" -ge 17 ] || { echo "$tool is $major; Postgres 17 or newer is needed (brew install postgresql@17)" >&2; exit 1; }
done

if [ -n "${RESTORE_TARGET_DB_URL:-}" ]; then
  ref="$target"
  name="$target (RESTORE_TARGET_DB_URL)"
else
  # A name is resolved to its ref; it has to name exactly one project.
  projects="$(supabase projects list -o json 2>/dev/null | jq -c 'if type == "array" then . else .projects end')"
  matches="$(jq -r --arg t "$target" '.[] | select(.ref == $t or .name == $t) | .ref' <<< "$projects")"
  [ "$(grep -c . <<< "$matches")" = 1 ] || { echo "\"$target\" names $(grep -c . <<< "$matches") projects on this Supabase account; give its ref" >&2; exit 1; }
  ref="$matches"
  name="$(jq -r --arg r "$ref" '.[] | select(.ref == $r) | .name + " — " + .ref + ", " + .region + ", " + .status' <<< "$projects")"
fi
if [ "$ref" = "$prod_ref" ]; then
  echo "refusing: $ref is ludi-prod. This script restores into a NEW project." >&2
  exit 1
fi

work="$(mktemp -d)"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT

logdir="$HOME/Library/Logs/ludi"
mkdir -p "$logdir"
log="$logdir/restore-$ref-$(date +%Y%m%d-%H%M%S).log"
# The log holds steps, timings and counts only: no secrets, no row data.
exec > >(tee -a "$log") 2>&1

timings=""
total_s=0
step() { step_name="$1"; step_t0=$(date +%s); printf '\n→ %s\n' "$1"; }
done_step() {
  local s=$(( $(date +%s) - step_t0 ))
  timings="${timings}${timings:+ · }${step_name} ${s}s"
  total_s=$((total_s + s))
  echo "  ${step_name}: ${s}s"
}

# Runs a command with its output in a file (and stdin closed, so a prompt
# fails instead of waiting unseen); shows the last lines, or the last 40 if
# it fails.
run_logged() {
  local label="$1"; shift
  if "$@" < /dev/null > "$work/$label.out" 2>&1; then
    { grep -v -E '^(Applying migration| *•|\{)' "$work/$label.out" || true; } | tail -3 | sed 's/^/  /'
  else
    sed 's/^/  /' "$work/$label.out" | tail -40 >&2
    echo "$label failed" >&2
    exit 1
  fi
}

echo "restore into $ref, $(date -u +%FT%TZ)"

# ── 0. The dump, before any prompt ─────────────────────────────────────
step "artifact"
run_note=""
if [ "$src" = latest ]; then
  run_id="$(gh run list -R "$backups_repo" -w Backups --status success -L 1 --json databaseId -q '.[0].databaseId')"
  [ -n "$run_id" ] || { echo "no green Backups run in $backups_repo" >&2; exit 1; }
  gh run download "$run_id" -R "$backups_repo" -D "$work/artifact"
  # gh unpacks the artifact into a folder named after it, and the
  # artifact is named after the file: match files only.
  enc="$(find "$work/artifact" -type f -name '*.dump.enc' | head -1)"
  run_note=", run $run_id"
elif [ -d "$src" ]; then
  enc="$(find "$src" -maxdepth 2 -type f -name '*.dump.enc' | head -1)"
else
  enc="$src"
fi
[ -n "$enc" ] && [ -f "$enc" ] || { echo "no .dump.enc at $src" >&2; exit 1; }
manifest="$(dirname "$enc")/manifest.txt"
[ -f "$manifest" ] || { echo "no manifest.txt next to $enc" >&2; exit 1; }
echo "  $(basename "$enc"), $(wc -c < "$enc" | tr -d ' ') bytes${run_note}"
done_step

# ── 2. Schema from main's migrations ───────────────────────────────────
step "main's migrations"
git -C "$repo" fetch -q origin main
mkdir -p "$work/project"
# The whole supabase/ folder: config.toml points at the email templates
# and the functions' import map, and the CLI checks they exist.
git -C "$repo" archive origin/main packages/supabase/supabase \
  | tar -x -C "$work/project" --strip-components=2
echo "  $(ls "$work/project/supabase/migrations" | wc -l | tr -d ' ') migrations at origin/main $(git -C "$repo" rev-parse --short origin/main)"
done_step

# ── The target, confirmed by name ──────────────────────────────────────
if [ -n "${RESTORE_TARGET_DB_URL:-}" ]; then
  echo
  echo "  rehearsal mode: target is RESTORE_TARGET_DB_URL, no link"
else
  echo
  echo "  target project: $name"
  project_name="${name%% — *}"
  read -rp "  Type its name ($project_name) to restore into it: " confirm
  [ "$confirm" = "$project_name" ] || { echo "not confirmed; nothing done" >&2; exit 1; }
fi

# ── 3. Decrypt: the passphrase is asked for alone and tried at once ────
# One secret at a time, each checked before the next is asked for: both
# come off the same clipboard, and the first drill pasted one twice.
dump="$work/restore.dump"
decrypted=0
for attempt in 1 2 3; do
  if [ "$attempt" -gt 1 ] || [ -z "${BACKUP_PASSPHRASE:-}" ]; then
    read -rsp "  BACKUP_PASSPHRASE: " BACKUP_PASSPHRASE
    echo
  fi
  export BACKUP_PASSPHRASE
  step "decrypt"
  if openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
      -in "$enc" -out "$dump" -pass env:BACKUP_PASSPHRASE 2> "$work/decrypt.err"; then
    decrypted=1
    break
  fi
  echo "  that passphrase does not open $(basename "$enc") (try $attempt of 3)"
done
[ "$decrypted" = 1 ] || { echo "could not decrypt: wrong BACKUP_PASSPHRASE, or a damaged file" >&2; exit 1; }
echo "  archive entries: $(pg_restore --list "$dump" | wc -l | tr -d ' ')"
done_step

# A new project has no auth users. One that has them is live: stop
# before a single migration touches it.
refuse_if_live() {
  local users
  users="$(psql -w "$target_url" -XAtc 'select count(*) from auth.users')"
  if [ "$users" != 0 ]; then
    echo "refusing: $ref already has $users auth users. Restore only into a new, empty project." >&2
    exit 1
  fi
}

if [ -n "${RESTORE_TARGET_DB_URL:-}" ]; then
  target_url="$RESTORE_TARGET_DB_URL"
  refuse_if_live
  step "db push"
  run_logged push supabase db push --workdir "$work/project" --db-url "$target_url" --yes
  done_step
else
  # ── The database password, checked by linking and connecting ─────────
  linked=0
  for attempt in 1 2 3; do
    read -rsp "  Database password of $ref: " db_password
    echo
    export SUPABASE_DB_PASSWORD="$db_password" PGPASSWORD="$db_password"
    step "link"
    pooler_file="$work/project/supabase/.temp/pooler-url"
    if supabase link --project-ref "$ref" --workdir "$work/project" < /dev/null > "$work/link.out" 2>&1 \
        && [ -s "$pooler_file" ] \
        && psql -w "$(cat "$pooler_file")" -XAtc 'select 1' > /dev/null 2> "$work/connect.err"; then
      linked=1
      break
    fi
    # Neither file holds the password.
    tail -3 "$work/link.out" "$work/connect.err" 2>/dev/null | grep -v -E '^(==>|$)' | sed 's/^/  /'
    echo "  could not link and connect with that password (try $attempt of 3)"
  done
  [ "$linked" = 1 ] || { echo "could not link $ref and connect to it" >&2; exit 1; }
  # The session pooler: IPv4, and it keeps one server session per client,
  # so the SET below holds for the whole load.
  target_url="$(cat "$pooler_file")"
  echo "  restore target: ${target_url#*@}"
  done_step
  refuse_if_live
  step "db push"
  run_logged push supabase db push --workdir "$work/project" --yes
  done_step
fi

applied="$(psql -w "$target_url" -XAtc 'select count(*) from supabase_migrations.schema_migrations')"
echo "  migrations recorded on the target: $applied"
held="$(psql -w "$target_url" -XAtc 'select (select count(*) from public.bookings) + (select count(*) from public.users) + (select count(*) from auth.users)')"
if [ "$held" != 0 ]; then
  echo "refusing: the target already holds $held bookings/users rows. Restore only into a new, empty project." >&2
  exit 1
fi

# ── 4. Data only, one transaction ──────────────────────────────────────
step "restore"
pg_restore --list "$dump" | grep -v ' TABLE DATA auth schema_migrations ' > "$work/restore.list"
set +e
{
  echo 'SET session_replication_role = replica;'
  pg_restore --data-only --no-owner --no-privileges --schema=public --schema=auth \
    -L "$work/restore.list" -f - "$dump"
} | psql -w "$target_url" -X -q --single-transaction -v ON_ERROR_STOP=1 >/dev/null 2> "$work/restore.err"
rc=$?
set -e
if [ "$rc" != 0 ]; then
  # DETAIL and CONTEXT lines carry row values; keep them out of the log.
  grep -v -E '^(DETAIL|CONTEXT):' "$work/restore.err" | head -20 >&2
  echo "RESTORE FAILED (psql exit $rc). The transaction rolled back; the project is still empty." >&2
  exit 1
fi
done_step

# ── 5. Compare ─────────────────────────────────────────────────────────
step "verify"
ok=1
echo "  headline counts: restored vs manifest"
printf '    %-16s %10s %10s\n' table restored manifest
for t in bookings users venues auth.users; do
  case "$t" in auth.users) q="select count(*) from auth.users" ;; *) q="select count(*) from public.$t" ;; esac
  got="$(psql -w "$target_url" -XAtc "$q")"
  want="$(grep "^$t|" "$manifest" | cut -d'|' -f2)"
  mark=" "
  if [ "$got" != "$want" ]; then mark="✗"; ok=0; fi
  printf '    %-16s %10s %10s %s\n' "$t" "$got" "${want:-?}" "$mark"
done
echo "  manifest server_version: $(grep '^server_version|' "$manifest" | cut -d'|' -f2), target: $(psql -w "$target_url" -XAtc 'show server_version')"

# Every table: the rows in the dump's COPY blocks against count(*).
pg_restore --data-only -f - "$dump" | awk '
  /^COPY [^ ]+ / { t = $2; n = 0; inblk = 1; next }
  inblk && /^\\\.$/ { print t "|" n; inblk = 0; next }
  inblk { n++ }' | sort > "$work/dump_counts.txt"
query="$(awk -F'|' '{ printf "%sselect %s, count(*) from %s", (NR > 1 ? " union all " : ""), "'\''" $1 "'\''", $1 }' "$work/dump_counts.txt")"
psql -w "$target_url" -XAt -c "$query" | sort > "$work/restored_counts.txt"
tables="$(wc -l < "$work/dump_counts.txt" | tr -d ' ')"
rows="$(awk -F'|' '{ s += $2 } END { print s }' "$work/dump_counts.txt")"
mismatch=0
while IFS='|' read -r t want; do
  got="$(grep "^$t|" "$work/restored_counts.txt" | cut -d'|' -f2)"
  [ "$got" = "$want" ] && continue
  case "$t" in
    auth.schema_migrations) echo "    $t: dump $want, target $got (expected: the new project's auth server keeps its own)" ;;
    public.spatial_ref_sys) echo "    $t: dump $want, target $got (expected: PostGIS fills it)" ;;
    *) echo "    $t: dump $want, target ${got:-missing} ✗"; mismatch=$((mismatch + 1)) ;;
  esac
done < "$work/dump_counts.txt"
echo "  every table: $tables tables, $rows rows in the dump, $mismatch mismatched"
[ "$mismatch" = 0 ] || ok=0
done_step

echo
echo "timings: $timings · total ${total_s}s (prompts not counted)"
echo "log: $log"
if [ "$ok" = 1 ]; then
  echo "RESTORE OK — every table matches the dump, the headline counts match the manifest."
  echo "A drill? Delete the scratch project now (Project Settings → General → Delete project)."
  echo "A real restore? Carry on with runbook §2 step 6: re-point everything at $ref."
else
  echo "RESTORE MISMATCH — investigate before trusting this restore." >&2
  exit 1
fi
