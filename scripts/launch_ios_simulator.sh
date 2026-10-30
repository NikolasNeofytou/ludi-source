#!/usr/bin/env bash
#
# launch_ios_simulator.sh — boot an iOS simulator, mock its location to
# Cyprus, ensure local Supabase is up, and run the Ludi mobile app on it.
#
# Why a script: the app needs three things lined up before it's useful in
# the simulator —
#   1. a booted iOS sim with mock location set inside Cyprus (otherwise
#      Discover shows no nearby pitches; the catalogue is CY-only),
#   2. local Supabase running (Discover, availability grid, booking flow
#      all hit Edge Functions + Postgres),
#   3. apps/mobile/.env populated so the Stripe Payment Sheet can
#      initialize (no key → checkout fails on first tap).
#
# Usage:
#   ./scripts/launch_ios_simulator.sh                  # auto: reuse booted sim, else default
#   ./scripts/launch_ios_simulator.sh "iPhone 16 Pro"  # specific device by name or UDID
#   IOS_SIM_DEFAULT="iPhone 16" ./scripts/launch_ios_simulator.sh   # override default
#   LUDI_SIM_LAT=34.9 LUDI_SIM_LON=33.6 ./scripts/launch_ios_simulator.sh  # custom location
#   LUDI_SKIP_SUPABASE=1 ./scripts/launch_ios_simulator.sh   # skip backend boot
#
# Stop:
#   Ctrl-C in this terminal     (stops Metro / expo run)
#   supabase stop --workdir packages/supabase   (halts the backend)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MOBILE_DIR="$REPO_ROOT/apps/mobile"
SUPABASE_DIR="$REPO_ROOT/packages/supabase"

DEFAULT_SIM="${IOS_SIM_DEFAULT:-iPhone 16 Pro}"
REQUESTED="${1:-}"

# Default mock location — central Larnaca. The pitch catalogue and
# Discover query are scoped to Cyprus; a fresh sim sits in Cupertino and
# returns "no nearby pitches" forever. Override with LUDI_SIM_LAT / LUDI_SIM_LON.
SIM_LAT="${LUDI_SIM_LAT:-34.9192}"
SIM_LON="${LUDI_SIM_LON:-33.6354}"

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

[[ "$(uname -s)" == "Darwin" ]] || die "iOS simulators only run on macOS."
command -v xcrun >/dev/null     || die "xcrun not found — install Xcode + Command Line Tools."
[[ -f "$MOBILE_DIR/package.json" ]] || die "Expected $MOBILE_DIR/package.json — wrong repo root?"

# ── 1. Resolve target simulator ───────────────────────────────────────────
# Resolves a query (UDID or device name) to a UDID.
resolve_udid() {
  local query="$1" line
  # UDID match first: line contains "(<UDID>)" anywhere.
  line="$(xcrun simctl list devices available 2>/dev/null | grep -F "($query)" | head -1 || true)"
  if [[ -z "$line" ]]; then
    # Exact name match — escape regex metachars in the name.
    local esc
    esc="$(printf '%s' "$query" | sed -E 's/[][\.^$*+?()|{}]/\\&/g')"
    line="$(xcrun simctl list devices available 2>/dev/null \
      | grep -E "^[[:space:]]+${esc} \(" | head -1 || true)"
  fi
  [[ -z "$line" ]] && return 0
  printf '%s\n' "$line" | sed -E 's/.*\(([0-9A-Fa-f-]{36})\).*/\1/'
}

booted_udid() {
  xcrun simctl list devices booted 2>/dev/null \
    | grep -E "\(Booted\)" | head -1 \
    | sed -E 's/.*\(([0-9A-Fa-f-]{36})\).*/\1/' || true
}

device_state() {
  xcrun simctl list devices 2>/dev/null \
    | grep -F "$1" | head -1 \
    | sed -E 's/.*\(([A-Za-z]+)\) *$/\1/' || true
}

if [[ -n "$REQUESTED" ]]; then
  TARGET_UDID="$(resolve_udid "$REQUESTED")"
  [[ -n "$TARGET_UDID" ]] || {
    warn "No available simulator matched '$REQUESTED'. Available iPhones:"
    xcrun simctl list devices available | grep -i iphone || true
    die "Pass a different name or UDID."
  }
  ok "Resolved '$REQUESTED' → $TARGET_UDID"
else
  TARGET_UDID="$(booted_udid)"
  if [[ -n "$TARGET_UDID" ]]; then
    ok "Reusing already-booted simulator: $TARGET_UDID"
  else
    TARGET_UDID="$(resolve_udid "$DEFAULT_SIM")"
    [[ -n "$TARGET_UDID" ]] || {
      warn "Default sim '$DEFAULT_SIM' not found. Available iPhones:"
      xcrun simctl list devices available | grep -i iphone || true
      die "Set IOS_SIM_DEFAULT or pass a name as \$1."
    }
    say "Booting default '$DEFAULT_SIM' ($TARGET_UDID)"
  fi
fi

# ── 2. Boot + show Simulator.app ──────────────────────────────────────────

SIM_STATE="$(device_state "$TARGET_UDID")"
if [[ "$SIM_STATE" != "Booted" ]]; then
  say "Booting simulator (was: ${SIM_STATE:-unknown})"
  xcrun simctl boot "$TARGET_UDID"
fi

open -a Simulator --args -CurrentDeviceUDID "$TARGET_UDID"

say "Waiting for boot to finish"
xcrun simctl bootstatus "$TARGET_UDID" -b >/dev/null 2>&1 || sleep 5
ok "Simulator ready"

# ── 3. Mock location (Larnaca) ────────────────────────────────────────────
# `simctl location` works on iOS 17+ runtimes; older sims need a manual
# Features → Location → Custom Location step.
if xcrun simctl location "$TARGET_UDID" set "${SIM_LAT},${SIM_LON}" 2>/dev/null; then
  ok "Mock location set: $SIM_LAT, $SIM_LON (Larnaca by default)"
else
  warn "Could not set mock location automatically — Simulator → Features → Location → Custom Location"
fi

# ── 4. Local Supabase ─────────────────────────────────────────────────────

if [[ "${LUDI_SKIP_SUPABASE:-0}" == "1" ]]; then
  warn "LUDI_SKIP_SUPABASE=1 — skipping backend boot"
elif ! command -v supabase >/dev/null; then
  warn "supabase CLI not installed — Discover/booking will fail without it"
  warn "Install: brew install supabase/tap/supabase"
else
  # `supabase status` exits 0 when the local stack is up. The CLI accepts
  # --workdir so we don't need to cd.
  if supabase status --workdir "$SUPABASE_DIR" >/dev/null 2>&1; then
    ok "Supabase already running"
  else
    say "Starting Supabase (first start can take ~1 min while Docker pulls images)"
    supabase start --workdir "$SUPABASE_DIR"
  fi
fi

# ── 5. .env sanity ────────────────────────────────────────────────────────
# We don't auto-fill secrets — the Stripe pub key is account-specific and
# the supabase URL/anon key shift per project. Tell the user what's missing.

ENV_FILE="$MOBILE_DIR/.env"
ENV_EXAMPLE="$MOBILE_DIR/.env.example"
if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$ENV_EXAMPLE" ]]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    warn "Created $ENV_FILE from .env.example — fill in real keys before booking flow works"
  else
    warn "$ENV_FILE is missing and no .env.example to seed from"
  fi
fi

# ── 6. Metro port conflict ────────────────────────────────────────────────
# Expo's default port is 8081. If another worktree (or another RN app) is
# already serving Metro there, `expo run:ios` in non-interactive mode skips
# the dev server entirely and the app launches against nothing. Surface it
# loudly so the user can stop the other instance or close the other worktree.
METRO_PORT="${RCT_METRO_PORT:-8081}"
if lsof -nP -iTCP:"$METRO_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  HOLDER_PID="$(lsof -nP -tiTCP:"$METRO_PORT" -sTCP:LISTEN | head -1)"
  HOLDER_CMD="$(ps -o command= -p "$HOLDER_PID" 2>/dev/null | head -c 200)"
  warn "Port $METRO_PORT is already in use (pid $HOLDER_PID):"
  warn "  $HOLDER_CMD"
  die "Stop that Metro instance (or close the other worktree) and re-run."
fi

# ── 7. CocoaPods locale guard ─────────────────────────────────────────────
# CocoaPods 1.16 + Ruby 4.0 crashes in `String#unicode_normalize` on path
# strings that come in as ASCII-8BIT. The fix CocoaPods itself recommends
# is forcing a UTF-8 locale. Cheap and harmless on machines where it's
# already set.
export LANG="${LANG:-en_US.UTF-8}"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

# ── 8. Hand off to expo run:ios ───────────────────────────────────────────
# `expo run:ios --device <UDID>` prebuilds (first run) + installs + launches.
# Stripe is a native module so Expo Go won't work — we need a custom build.
# Extra args after the device name are forwarded.

cd "$MOBILE_DIR"
say "Launching Ludi on $TARGET_UDID — first build can take 60–120s"
echo
exec pnpm exec expo run:ios --device "$TARGET_UDID" "${@:2}"
