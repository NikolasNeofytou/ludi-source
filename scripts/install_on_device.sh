#!/usr/bin/env bash
#
# scripts/install_on_device.sh — build + install on the attached iPhone, then exit.
#
# Companion to scripts/launch_ios_simulator.sh (which boots a sim) and
# scripts/launch_admin.sh (which serves the admin web app). This one
# deploys the mobile app to a physical iPhone so you can walk away and
# test in the wild — Cyprus pitch fixtures, real-device touch latency,
# Stripe Payment Sheet on a real Apple Pay enrolment, the full thing.
#
# By default builds in RELEASE mode and installs without keeping Metro
# attached. The installed app keeps running fine when this terminal
# closes, so you can plug out, walk to the pitch, and use it.
#
# For day-to-day code iteration with hot reload, drop --release (or pass
# --debug explicitly) — Metro stays attached and you'll see the JS
# bundle live-update on save. That's the dev-loop mode.
#
# Flags:
#   --debug            Debug build (Metro attached, hot reload, ~30s build).
#                      Default is release (~3–5 min first build, ~30s cached).
#   --release          Explicit release mode (the default).
#   --with-typecheck   Run pnpm --filter @ludi/mobile typecheck preflight (~5s).
#   --clean            Wipe apps/mobile/ios + apps/mobile/.expo + Metro cache
#                      before building. Use when the build picks up stale
#                      native config (after editing app.json plugins).
#   --skip-supabase    Don't check or boot local Supabase. Use when the
#                      app is pointed at staging/prod (EXPO_PUBLIC_SUPABASE_URL
#                      is not 127.0.0.1).
#   --device <name>    Pick a specific iPhone by substring match against
#                      `xcrun xctrace list devices`. Default: first iPhone.
#
# Typical workflows:
#   ./scripts/install_on_device.sh                          # release, walk-away
#   ./scripts/install_on_device.sh --debug                  # hot-reload dev loop
#   ./scripts/install_on_device.sh --clean --with-typecheck # pre-mom-test
#   ./scripts/install_on_device.sh --device "Nikolas"       # disambiguate
#
# Prereqs (one-time):
#   - Apple Developer account configured in Xcode (Xcode → Settings → Accounts)
#   - iPhone paired to this Mac, "Trust This Computer" accepted, USB plugged in
#   - Developer Mode enabled on iPhone (Settings → Privacy & Security → Developer Mode)
#   - Stripe + Supabase env vars set in apps/mobile/.env
#
# Stop:
#   - Release mode: app keeps running on phone; nothing to stop.
#   - Debug mode: Ctrl-C this terminal to stop Metro.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MOBILE_DIR="$REPO_ROOT/apps/mobile"
SUPABASE_DIR="$REPO_ROOT/packages/supabase"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

say()  { printf "${BLUE}→${NC} %s\n" "$*"; }
ok()   { printf "  ${GREEN}✓${NC} %s\n" "$*"; }
warn() { printf "  ${YELLOW}!${NC} %s\n" "$*"; }
die()  { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }

# ── Arg parsing ───────────────────────────────────────────────────────────

mode="release"
do_typecheck=false
do_clean=false
skip_supabase=false
device_query=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --debug) mode="debug"; shift ;;
    --release) mode="release"; shift ;;
    --with-typecheck) do_typecheck=true; shift ;;
    --clean) do_clean=true; shift ;;
    --skip-supabase) skip_supabase=true; shift ;;
    --device)
      [[ $# -ge 2 ]] || die "--device needs an argument"
      device_query="$2"
      shift 2
      ;;
    -h|--help)
      # Print the script header comment, stripping leading # / space.
      sed -n '2,50p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      die "Unknown argument: $1 (try --help)"
      ;;
  esac
done

# ── Sanity ────────────────────────────────────────────────────────────────

[[ "$(uname -s)" == "Darwin" ]] || die "Physical iPhone deploys only work from macOS."
command -v xcrun >/dev/null || die "xcrun not found — install Xcode + Command Line Tools."
[[ -f "$MOBILE_DIR/package.json" ]] || die "Expected $MOBILE_DIR/package.json — wrong repo root?"

# ── Detect physical iPhone ────────────────────────────────────────────────
# xctrace's output has three sections separated by blank-prefixed headers:
#   == Devices ==          ← physical, online
#   == Devices Offline ==  ← physical, paired but not connected
#   == Simulators ==
# We parse only the first section. Mac shows up there too, so we restrict
# to iPhone lines.
#
# Format of each device line:
#   "<Name> (<UDID>)"             — Mac
#   "<Name> (<OS version>) (<UDID>)" — iPhone
# UDID is either 36-char UUID (Mac) or 25-char modern UDID (8-hex + hyphen + 16-hex).

say "Looking for a connected iPhone"
device_block=$(xcrun xctrace list devices 2>/dev/null | awk '
  /^== Devices ==/        { sec="online"; next }
  /^== Devices Offline ==/ { sec="offline"; next }
  /^== Simulators ==/     { sec="sims"; next }
  sec=="online" && /iPhone/ { print }
')

if [[ -z "$device_block" ]]; then
  warn "No iPhone in the online list. Offline (paired but not connected):"
  xcrun xctrace list devices 2>/dev/null | awk '
    /^== Devices Offline ==/ { p=1; next }
    /^== Simulators ==/      { p=0 }
    p && /iPhone/            { print "  " $0 }
  '
  die "Plug in your iPhone via USB, unlock it, accept 'Trust This Computer', and try again."
fi

# Narrow by --device substring if provided.
if [[ -n "$device_query" ]]; then
  filtered=$(printf '%s\n' "$device_block" | grep -F "$device_query" || true)
  [[ -n "$filtered" ]] || die "No connected iPhone matched '$device_query'. Available:
$device_block"
  device_block="$filtered"
fi

device_line=$(printf '%s\n' "$device_block" | head -1)
device_count=$(printf '%s\n' "$device_block" | wc -l | tr -d ' ')
if [[ "$device_count" -gt 1 ]]; then
  warn "Multiple iPhones connected — using the first. Pass --device <name> to pick:"
  printf '%s\n' "$device_block" | sed 's/^/    /'
fi

# Extract the last (...) group, which is the UDID. Modern iPhone UDIDs
# are 25 chars (8 hex + hyphen + 16 hex). Older are 40 chars (all hex).
device_udid=$(printf '%s' "$device_line" | sed -E 's/.*\(([0-9A-Fa-f-]{25}|[0-9A-Fa-f]{40})\)[[:space:]]*$/\1/')
[[ -n "$device_udid" && "$device_udid" != "$device_line" ]] || die "Could not parse UDID from: $device_line"

device_name=$(printf '%s' "$device_line" | sed -E 's/^[[:space:]]*//; s/[[:space:]]*\([^)]*\)[[:space:]]*\([0-9A-Fa-f-]+\)[[:space:]]*$//')

ok "Device: $device_name"
ok "UDID:   $device_udid"
ok "Mode:   $mode"

# ── Optional preflight ────────────────────────────────────────────────────

if $do_typecheck; then
  say "Typecheck (preflight)"
  pnpm --filter @ludi/mobile typecheck
  ok "Typecheck passed"
fi

if $do_clean; then
  say "Cleaning native + Expo caches"
  rm -rf "$MOBILE_DIR/ios" "$MOBILE_DIR/.expo"
  ok "Removed $MOBILE_DIR/ios and $MOBILE_DIR/.expo"
fi

# ── Local Supabase (release-mode builds against whatever's in .env) ──────

if $skip_supabase; then
  warn "--skip-supabase — not checking the local stack"
elif ! command -v supabase >/dev/null; then
  warn "supabase CLI not installed — Discover/booking will fail if .env points at localhost"
  warn "Install: brew install supabase/tap/supabase"
else
  if supabase status --workdir "$SUPABASE_DIR" >/dev/null 2>&1; then
    ok "Supabase already running"
  else
    say "Starting Supabase (first start can take ~1 min while Docker pulls images)"
    supabase start --workdir "$SUPABASE_DIR"
  fi
fi

# ── .env sanity ───────────────────────────────────────────────────────────
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

# A real-device build against localhost Supabase won't work — the phone
# can't reach 127.0.0.1. Flag it loudly so the user catches it before
# spending 4 min on a release build with broken networking.
if grep -qE "EXPO_PUBLIC_SUPABASE_URL=.*127\.0\.0\.1|EXPO_PUBLIC_SUPABASE_URL=.*localhost" "$ENV_FILE" 2>/dev/null; then
  warn "EXPO_PUBLIC_SUPABASE_URL points at localhost — the phone can't reach it."
  warn "Options:"
  warn "  - point .env at your Mac's LAN IP (run: ipconfig getifaddr en0)"
  warn "  - or at the staging Supabase project"
  warn "  - or pass --skip-supabase to suppress this warning if intentional"
fi

# ── Metro port (only matters in debug mode) ───────────────────────────────

if [[ "$mode" == "debug" ]]; then
  METRO_PORT="${RCT_METRO_PORT:-8081}"
  if lsof -nP -iTCP:"$METRO_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    HOLDER_PID="$(lsof -nP -tiTCP:"$METRO_PORT" -sTCP:LISTEN | head -1)"
    HOLDER_CMD="$(ps -o command= -p "$HOLDER_PID" 2>/dev/null | head -c 200)"
    warn "Port $METRO_PORT is already in use (pid $HOLDER_PID):"
    warn "  $HOLDER_CMD"
    die "Stop that Metro instance (or close the other worktree) and re-run."
  fi
fi

# ── CocoaPods locale guard (see launch_ios_simulator.sh §7) ───────────────
export LANG="${LANG:-en_US.UTF-8}"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

# ── Hand off to expo run:ios ──────────────────────────────────────────────

cd "$MOBILE_DIR"

if [[ "$mode" == "release" ]]; then
  say "Building release IPA and installing on $device_name"
  say "This is the slow path (~3–5 min first build, ~30s cached). Walk away when prompted."
  echo
  # --configuration Release skips Metro; the app is fully AOT.
  exec pnpm exec expo run:ios --device "$device_udid" --configuration Release
else
  say "Building debug bundle, installing, attaching Metro on $device_name"
  echo
  exec pnpm exec expo run:ios --device "$device_udid"
fi
