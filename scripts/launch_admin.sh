#!/usr/bin/env bash
#
# launch_admin.sh — boot the Ludi admin web app with the local backend.
#
# What it does:
#   1. Ensures local Supabase is up (starts it if not — first run pulls
#      Docker images, ~60s).
#   2. Reads the actual host port of the API gateway. We read it from
#      `docker port` rather than `supabase status` because, when a second
#      Supabase project is running on the machine, the CLI's status
#      command keeps reporting 54321 but Docker has shifted the real port
#      to avoid the collision.
#   3. Writes apps/admin/.env.local with the detected URL + anon key so
#      the SSR + browser Supabase clients both talk to the right project.
#   4. Boots `next dev` on :3001.
#
# Flags:
#   --promote   Flip the dev test user's public.users.role to 'admin'.
#               Run this once after signing in through the UI (which
#               creates the public.users row). Bypasses the
#               tg_users_block_role_change trigger by setting
#               session_replication_role='replica' inside one txn.
#   --status    Print detected URL/key/admin status and exit.
#
# Env:
#   LUDI_ADMIN_PHONE   Test phone in E.164 (default +35799000000 — must
#                      be in [auth.sms.test_otp] in config.toml).
#   LUDI_ADMIN_PORT    Next.js port (default 3001).
#
# Sign-in once Next.js is up:
#   open http://localhost:3001/login
#   phone: +35799000000
#   OTP:   123456   (mapped in packages/supabase/supabase/config.toml)
#
# Stop:
#   Ctrl-C halts Next.js. Backend keeps running — to halt it:
#     supabase stop --workdir packages/supabase

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SUPABASE_DIR="$REPO_ROOT/packages/supabase"
ADMIN_DIR="$REPO_ROOT/apps/admin"
ENV_FILE="$ADMIN_DIR/.env.local"

PHONE="${LUDI_ADMIN_PHONE:-+35799000000}"
PORT="${LUDI_ADMIN_PORT:-3001}"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

say()  { printf "${BLUE}→${NC} %s\n" "$*"; }
ok()   { printf "  ${GREEN}✓${NC} %s\n" "$*"; }
warn() { printf "  ${YELLOW}!${NC} %s\n" "$*"; }
die()  { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }

# ── 0. Sanity ─────────────────────────────────────────────────────────────

command -v supabase >/dev/null || die "supabase CLI not installed. Install: brew install supabase/tap/supabase"
command -v docker   >/dev/null || die "docker not installed."
command -v psql     >/dev/null || warn "psql not installed — --promote will fail without it. Install: brew install libpq && brew link --force libpq"
[[ -f "$SUPABASE_DIR/supabase/config.toml" ]] || die "Expected $SUPABASE_DIR/supabase/config.toml"
[[ -f "$ADMIN_DIR/package.json"            ]] || die "Expected $ADMIN_DIR/package.json"

PROJECT_ID="$(grep -E '^project_id' "$SUPABASE_DIR/supabase/config.toml" | head -1 | sed -E 's/.*= *"([^"]+)".*/\1/')"
[[ -n "$PROJECT_ID" ]] || die "Could not parse project_id from config.toml"
KONG="supabase_kong_$PROJECT_ID"

# ── 1. Bring up Supabase if needed ────────────────────────────────────────

if supabase status --workdir "$SUPABASE_DIR" >/dev/null 2>&1; then
  ok "Supabase already running (project $PROJECT_ID)"
else
  say "Starting Supabase (project $PROJECT_ID) — first run pulls Docker images"
  supabase start --workdir "$SUPABASE_DIR"
fi

# ── 2. Detect actual ports — docker port, not supabase status ─────────────

docker inspect "$KONG" >/dev/null 2>&1 \
  || die "Container $KONG not found. Is supabase healthy? Try: supabase stop --workdir $SUPABASE_DIR && supabase start --workdir $SUPABASE_DIR"

API_PORT="$(docker port "$KONG" 8000/tcp 2>/dev/null | head -1 | awk -F: '{print $NF}')"
[[ -n "$API_PORT" ]] || die "Could not read API host port from $KONG. Try a fresh supabase restart."
API_URL="http://127.0.0.1:$API_PORT"

# Anon (publishable) key + DB URL from `supabase status`. CLI v2.90+
# changed the layout: old `anon key: eyJ...` plain lines were replaced
# with a boxed table whose cell is `│ Publishable │ sb_publishable_... │`.
# Strip box chars, then match either old (eyJ…) or new (sb_…) token on
# the labelled line.
STATUS="$(supabase status --workdir "$SUPABASE_DIR" 2>/dev/null | tr -d '│')"

ANON_KEY="$(printf '%s\n' "$STATUS" | awk '
  tolower($0) ~ /(anon[[:space:]]+key|publishable)/ {
    for (i=1; i<=NF; i++) if ($i ~ /^(sb_|eyJ)/) { print $i; exit }
  }')"
[[ -n "$ANON_KEY" ]] || die "Could not read anon/publishable key from supabase status."

DB_URL="$(printf '%s\n' "$STATUS" | grep -oE 'postgresql://[^[:space:]]+' | head -1)"

ok "API:    $API_URL"
ok "Anon:   ${ANON_KEY:0:18}…${ANON_KEY: -6}"
[[ -n "$DB_URL" ]] && ok "DB URL: $DB_URL"

# ── Optional --status ─────────────────────────────────────────────────────

if [[ "${1:-}" == "--status" ]]; then
  if [[ -n "$DB_URL" ]]; then
    ROLE="$(psql "$DB_URL" -tA -c "
      SELECT u.role
      FROM public.users u
      JOIN auth.users a ON a.id = u.id
      WHERE a.phone = '${PHONE#+}'
      LIMIT 1;" 2>/dev/null || true)"
    if [[ -n "$ROLE" ]]; then
      ok "Test user ($PHONE) role: $ROLE"
    else
      warn "Test user ($PHONE) has no public.users row yet — sign in once via the UI."
    fi
  fi
  exit 0
fi

# ── Optional --promote ────────────────────────────────────────────────────

if [[ "${1:-}" == "--promote" ]]; then
  command -v psql >/dev/null || die "psql required for --promote."
  [[ -n "$DB_URL" ]] || die "DB URL unknown — cannot promote."
  PHONE_DIGITS="${PHONE#+}"
  RESULT="$(psql "$DB_URL" -tA -v ON_ERROR_STOP=1 <<SQL
BEGIN;
SET LOCAL session_replication_role = 'replica';
UPDATE public.users
   SET role = 'admin'
 WHERE id IN (SELECT id FROM auth.users WHERE phone = '${PHONE_DIGITS}')
RETURNING id::text;
COMMIT;
SQL
)" || die "Promotion query failed. Did the user sign in at least once?"
  if [[ -z "$RESULT" ]]; then
    die "No public.users row matched phone $PHONE. Sign in once via /login, then re-run with --promote."
  fi
  ok "Promoted user ($PHONE) → role=admin"
  ok "Refresh /bookings — you should now see the admin list."
  exit 0
fi

# ── 3. Write .env.local for admin ─────────────────────────────────────────

NEW_CONTENT="NEXT_PUBLIC_SUPABASE_URL=$API_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY
"
if [[ ! -f "$ENV_FILE" ]] || [[ "$(cat "$ENV_FILE")" != "$NEW_CONTENT" ]]; then
  printf '%s' "$NEW_CONTENT" > "$ENV_FILE"
  ok "Wrote $ENV_FILE"
else
  ok "$ENV_FILE already current"
fi

# ── 4. Port conflict guard ────────────────────────────────────────────────

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  HOLDER_PID="$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN | head -1)"
  HOLDER_CMD="$(ps -o command= -p "$HOLDER_PID" 2>/dev/null | head -c 200)"
  warn "Port $PORT busy (pid $HOLDER_PID): $HOLDER_CMD"
  die "Stop that process or set LUDI_ADMIN_PORT to a free port."
fi

# ── 5. Hand off to next dev ───────────────────────────────────────────────

echo
say "Next.js admin starting on http://localhost:$PORT"
echo
echo "  Sign in at  http://localhost:$PORT/login"
echo "  Phone:      $PHONE"
echo "  OTP:        123456"
echo
echo "  After your first sign-in (creates your public.users row):"
echo "    ./scripts/launch_admin.sh --promote   # flip your role to admin"
echo
echo "  Check status anytime:"
echo "    ./scripts/launch_admin.sh --status"
echo

cd "$ADMIN_DIR"
exec pnpm dev
