#!/usr/bin/env bash
# smoke_prod.sh — the post-deploy smoke test for production, in one command.
#
# Everything the 2026-09-05 launch-readiness audit checked by hand with
# curl, codified so it runs the same way every time and exits non-zero
# when something a stranger would hit is broken. Read-only: every probe
# is a GET/HEAD against a public URL or an unauthenticated POST that must
# be *rejected*. Nothing here writes to prod.
#
# Three tiers, so the script is useful with zero setup and more useful
# with some:
#
#   always   — site, admin, /get redirect, domain redirects, Supabase
#              Auth + Functions gateways. Needs only curl.
#   anon key — REST probe through RLS (cities, the public table).
#              Needs LUDI_PROD_ANON_KEY in the environment, or an
#              apps/mobile/.env whose URL points at the prod project.
#   db url   — pg_cron jobs present + ran in the last 24h, migration
#              head. Needs LUDI_PROD_DB_URL (the pooler URL from
#              Supabase → Connect; read-only queries only).
#
# Usage:
#   bash scripts/smoke_prod.sh
#   LUDI_PROD_DB_URL='postgresql://…' bash scripts/smoke_prod.sh
#
# See docs/plans/ops-readiness.md (gate O5) and docs/infra.md §Monitoring.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SITE="https://ludi.football"
ADMIN="https://ludi-admin.vercel.app"
PROJECT_REF="kotigxeeigjytdtwklyu"
SUPA="https://${PROJECT_REF}.supabase.co"

# The five pg_cron jobs migrations register. Keep in sync with
# tests/pg_cron_schedules.sql and the migrations that call cron.schedule.
CRON_JOBS=(
  ludi-cleanup-stale-pending-bookings
  ludi-cleanup-expired-idempotency-keys
  ludi-cleanup-old-stripe-events
  ludi-expire-collecting
  ludi-complete-played-bookings
)

FAIL=0
SKIP=0
green() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
red()   { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=1; }
warn()  { printf '  \033[33m!\033[0m %s\n' "$1"; }
skip()  { printf '  \033[2m–\033[0m %s\n' "$1"; SKIP=1; }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# status <url> [method]  → HTTP status code, 000 on connection failure.
status() {
  curl -s -o /dev/null -w '%{http_code}' -X "${2:-GET}" --max-time 15 "$1" 2>/dev/null || echo 000
}
# location <url> → the Location header of the first response, untrimmed.
location() {
  curl -s -o /dev/null -w '%{redirect_url}' --max-time 15 "$1" 2>/dev/null
}

printf '\n\033[1mLudi production smoke — %s\033[0m\n' "$(date '+%Y-%m-%d %H:%M %Z')"

# ── 1. Site ─────────────────────────────────────────────────────────────
head_ "Site — $SITE"

for path in / /privacy /terms; do
  code="$(status "$SITE$path")"
  [ "$code" = 200 ] && green "$path → 200" || red "$path → $code (expected 200)"
done

body="$(curl -s --max-time 15 "$SITE/.well-known/health" 2>/dev/null)"
if grep -q '"status":"ok"' <<<"$body"; then
  green "/.well-known/health → {status: ok}"
else
  red "/.well-known/health → ${body:-no body} (expected {\"status\":\"ok\"})"
fi

# /get is the printed QR. It's a branded page now (not a redirect), so the
# check is a 200 whose body actually links to TestFlight or the App Store —
# the same "QR lands on nothing useful" defect the 09-05 audit found, now
# caught by content instead of a Location header.
code="$(status "$SITE/get")"
body="$(curl -s --max-time 15 "$SITE/get" 2>/dev/null)"
if [ "$code" = 200 ] && grep -qE 'https://(testflight\.apple\.com|apps\.apple\.com)' <<<"$body"; then
  green "/get → 200, links to TestFlight/App Store"
elif [ "$code" = 200 ]; then
  red "/get → 200 but no TestFlight/App Store link in the body (check APP_DOWNLOAD_URL on Vercel)"
else
  red "/get → $code (expected 200)"
fi

# Only the apex serves pages; the other hosts 308 to it with the path kept.
for host in www.ludi.football ludiltd.com www.ludiltd.com; do
  code="$(status "https://$host/privacy")"
  loc="$(location "https://$host/privacy")"
  if [ "$code" = 308 ] && [ "$loc" = "$SITE/privacy" ]; then
    green "$host → 308 → apex, path preserved"
  else
    red "$host → $code → ${loc:-no Location} (expected 308 → $SITE/privacy)"
  fi
done

# ── 2. Admin ────────────────────────────────────────────────────────────
head_ "Admin — $ADMIN"
code="$(status "$ADMIN/")"
loc="$(location "$ADMIN/")"
if [ "$code" = 307 ] && [[ "$loc" == */login* ]]; then
  green "/ → 307 → /login (middleware alive)"
elif [ "$code" = 500 ]; then
  red "/ → 500 — MIDDLEWARE_INVOCATION_FAILED? see scripts/deploy_admin.sh header"
else
  red "/ → $code → ${loc:-no Location} (expected 307 → /login)"
fi

# ── 3. Supabase gateways ────────────────────────────────────────────────
head_ "Supabase — $SUPA"

# Auth health: 200 with an API key; without one the gateway answers 401,
# which still proves Kong + GoTrue are up (404/5xx/000 would not).
ANON="${LUDI_PROD_ANON_KEY:-}"
if [ -z "$ANON" ] && [ -f "$ROOT/apps/mobile/.env" ]; then
  env_url="$(grep -E '^EXPO_PUBLIC_SUPABASE_URL=' "$ROOT/apps/mobile/.env" | cut -d= -f2- | tr -d '"' | tr -d "'")"
  if [[ "$env_url" == "$SUPA"* ]]; then
    ANON="$(grep -E '^EXPO_PUBLIC_SUPABASE_ANON_KEY=' "$ROOT/apps/mobile/.env" | cut -d= -f2- | tr -d '"' | tr -d "'")"
  fi
fi
if [ -n "$ANON" ]; then
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -H "apikey: $ANON" "$SUPA/auth/v1/health" 2>/dev/null || echo 000)"
  [ "$code" = 200 ] && green "auth/v1/health → 200" || red "auth/v1/health → $code with apikey (expected 200)"
else
  code="$(status "$SUPA/auth/v1/health")"
  case "$code" in
    200|401) green "auth/v1/health → $code (gateway up; 200 needs an apikey)" ;;
    *)       red   "auth/v1/health → $code (expected 200/401)" ;;
  esac
fi

# An unauthenticated POST to a JWT-verified function must be REJECTED by
# the gateway (401), which proves the function exists and the gateway is
# up. 404 = not deployed, 5xx = gateway or cold-start failure, 000 = down.
for fn in create-booking cancel-booking claim-share; do
  code="$(status "$SUPA/functions/v1/$fn" POST)"
  case "$code" in
    401|403) green "functions/$fn → $code (deployed, rejects anonymous)" ;;
    404)     red   "functions/$fn → 404 (not deployed)" ;;
    5*|000)  red   "functions/$fn → $code (gateway or function failure)" ;;
    *)       warn  "functions/$fn → $code (unexpected; verify_jwt off?)" ;;
  esac
done

# stripe-webhook has verify_jwt off by design; an unsigned POST must be
# rejected by the handler itself (400/401), never accepted or 5xx.
code="$(status "$SUPA/functions/v1/stripe-webhook" POST)"
case "$code" in
  400|401|403) green "functions/stripe-webhook → $code (rejects unsigned body)" ;;
  2*)          red   "functions/stripe-webhook → $code ACCEPTED an unsigned POST" ;;
  *)           red   "functions/stripe-webhook → $code (expected 400/401)" ;;
esac

# ── 4. REST through RLS (needs the anon key) ────────────────────────────
head_ "REST through RLS"

if [ -z "$ANON" ]; then
  skip "no anon key — export LUDI_PROD_ANON_KEY (Supabase → Settings → API → anon/publishable) to probe REST"
else
  resp="$(curl -s --max-time 15 -w '\n%{http_code}' \
    -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
    "$SUPA/rest/v1/cities?select=id&limit=1" 2>/dev/null)"
  code="${resp##*$'\n'}"
  body="${resp%$'\n'*}"
  if [ "$code" = 200 ] && [[ "$body" == \[\{* ]]; then
    green "rest/v1/cities → 200, one row (RLS public read works)"
  elif [ "$code" = 200 ]; then
    red "rest/v1/cities → 200 but empty — seed missing or RLS closed"
  else
    red "rest/v1/cities → $code ${body:0:120}"
  fi

  # The booking read path a stranger hits on Discover: active venues.
  resp="$(curl -s --max-time 15 -w '\n%{http_code}' \
    -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
    "$SUPA/rest/v1/venues?select=id&is_active=eq.true&limit=1" 2>/dev/null)"
  code="${resp##*$'\n'}"
  body="${resp%$'\n'*}"
  if [ "$code" = 200 ] && [[ "$body" == \[\{* ]]; then
    green "rest/v1/venues (active, Connect active) → at least one bookable venue"
  elif [ "$code" = 200 ]; then
    warn "rest/v1/venues → 200 but no active venue visible to anon (Discover is empty for strangers)"
  else
    red "rest/v1/venues → $code ${body:0:120}"
  fi
fi

# ── 5. Database — cron + migration head (needs a DB URL) ────────────────
head_ "Database — pg_cron + migrations"

DB="${LUDI_PROD_DB_URL:-}"
if [ -z "$DB" ]; then
  skip "no LUDI_PROD_DB_URL — export the pooler URL (Supabase → Connect) to check cron jobs and migration head"
elif ! command -v psql >/dev/null 2>&1; then
  skip "psql not installed — brew install libpq to check cron jobs and migration head"
else
  q() { psql "$DB" -X -q -t -A -v ON_ERROR_STOP=1 -c "$1" 2>&1; }

  ext="$(q "SELECT count(*) FROM pg_extension WHERE extname='pg_cron';")"
  if [ "$ext" != 1 ]; then
    red "pg_cron extension NOT installed — every ludi-* job is silently absent (Dashboard → Database → Extensions)"
  else
    green "pg_cron installed"
    names="$(printf "'%s'," "${CRON_JOBS[@]}")"; names="${names%,}"
    present="$(q "SELECT jobname FROM cron.job WHERE jobname IN ($names) ORDER BY 1;")"
    for job in "${CRON_JOBS[@]}"; do
      if grep -qx "$job" <<<"$present"; then
        last="$(q "SELECT coalesce(max(status)||' '||to_char(max(end_time),'YYYY-MM-DD HH24:MI'),'never') \
                   FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid \
                   WHERE j.jobname='$job' AND d.end_time > now()-interval '24 hours';")"
        fails="$(q "SELECT count(*) FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid \
                    WHERE j.jobname='$job' AND d.status='failed' AND d.end_time > now()-interval '24 hours';")"
        if [ "$last" = never ]; then
          # Hourly-or-faster jobs must have run; daily ones may legitimately not have.
          warn "$job scheduled, no run in the last 24h"
        elif [ "$fails" != 0 ]; then
          red "$job — $fails failed run(s) in the last 24h (last: $last)"
        else
          green "$job — last run $last"
        fi
      else
        red "$job MISSING from cron.job"
      fi
    done
  fi

  # Migration head: prod must be at (or ahead of) the newest file on this
  # checkout's main. Behind = a merged migration was never pushed.
  remote_head="$(q "SELECT max(version) FROM supabase_migrations.schema_migrations;")"
  local_head="$(ls "$ROOT/packages/supabase/supabase/migrations" | grep -E '^[0-9]{14}_' | sort | tail -1 | cut -d_ -f1)"
  if [ -z "$remote_head" ]; then
    red "could not read schema_migrations: $remote_head"
  elif [ "$remote_head" = "$local_head" ]; then
    green "migration head $remote_head matches this checkout"
  elif [[ "$remote_head" < "$local_head" ]]; then
    red "prod migration head $remote_head is BEHIND checkout $local_head — a merged migration was not pushed"
  else
    warn "prod migration head $remote_head is ahead of this checkout ($local_head) — pull main"
  fi
fi

# ── 6. Edge Functions inventory (needs a logged-in supabase CLI) ────────
head_ "Edge Functions inventory"
if ! command -v supabase >/dev/null 2>&1; then
  skip "supabase CLI not installed — skipping functions list"
else
  # JSON on purpose: CLI 2.121 prints one JSON line where older versions
  # printed a table, and counting table lines then read "1 ACTIVE".
  out="$(cd "$ROOT/packages/supabase" && supabase functions list --project-ref "$PROJECT_REF" --output json 2>&1)"
  if grep -q 'ACTIVE' <<<"$out"; then
    repo="$(find "$ROOT/packages/supabase/supabase/functions" -mindepth 1 -maxdepth 1 -type d ! -name '_*' -exec basename {} \; | sort)"
    read -r active missing < <(python3 -c '
import sys, json
raw = sys.stdin.read()
starts = [i for i in (raw.find("{"), raw.find("[")) if i >= 0]  # skip any CLI notice above the JSON
try:
    # raw_decode stops at the end of the JSON: the CLI prints its "a new
    # version is available" notice on stderr *after* it, which json.loads refused.
    d, _ = json.JSONDecoder().raw_decode(raw[min(starts):])
except Exception:
    print("? ?"); sys.exit()
fns = d.get("functions", d) if isinstance(d, dict) else d
live = {f.get("slug") for f in fns if f.get("status") == "ACTIVE"}
want = [n for n in sys.argv[1].split() if n]
gone = [n for n in want if n not in live]
print(len(live), ",".join(gone) or "-")
' "$repo" <<<"$out")
    expected="$(wc -w <<<"$repo" | tr -d ' ')"
    if [ "$active" = "?" ]; then
      warn "functions list did not parse — run supabase functions list by hand"
    elif [ "$missing" = "-" ]; then
      green "$active ACTIVE functions, every one of the repo's $expected among them"
    else
      red "repo functions not ACTIVE on prod: ${missing//,/, }"
    fi
  else
    skip "supabase CLI not logged in or no access ($(head -1 <<<"$out")) — run supabase login to include the inventory"
  fi
fi

# ── Verdict ─────────────────────────────────────────────────────────────
echo
if [ "$FAIL" = 1 ]; then
  printf '\033[31m✗ smoke FAILED\033[0m — fix before telling anyone the deploy is done\n\n'
  exit 1
elif [ "$SKIP" = 1 ]; then
  printf '\033[32m✓ smoke passed\033[0m (some tiers skipped — see – lines)\n\n'
else
  printf '\033[32m✓ smoke passed, all tiers\033[0m\n\n'
fi
