#!/usr/bin/env bash
# launch_watch.sh — public-launch runbook steps B4 (smoke secrets) and B2
# (UptimeRobot) in one run, every secret typed at a hidden prompt. Nothing
# is echoed, logged or passed on a command line.
#
#   bash scripts/launch_watch.sh
#
#   B4  the prod anon key comes from EAS production (it is public: it ships
#       in the app) and the database URL from ~/.zshrc when it still works;
#       otherwise it asks for the database password alone and builds the
#       session-pooler URL itself. Both go to ~/.zshrc (old lines replaced,
#       the previous file kept as ~/.zshrc.bak-launch).
#   B2  asks for the UptimeRobot Main API key (Return skips) and runs
#       scripts/uptime_monitors.sh with every alert contact on the account.
#       The key is not saved.
#   then the smoke test with both keys, and the launch board.
#
# The helper scripts come from origin/main, not from this checkout, which
# is often on an older branch. First run 2026-10-29: all four monitors up,
# smoke green on every tier. A forgotten database password is reset with
# scripts/rotate_db_password.sh first; this script then finds it.
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SUPA="https://kotigxeeigjytdtwklyu.supabase.co"
UR="https://api.uptimerobot.com/v2"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

git -C "$REPO" fetch -q origin main || { echo "could not fetch origin/main in $REPO"; exit 1; }
git -C "$REPO" archive origin/main scripts docs/runbooks packages/supabase/supabase/migrations packages/supabase/supabase/functions \
  | tar -x -C "$TMP"
ln -sfn "$REPO/apps" "$TMP/apps"

ask() { # ask <prompt> → the value on stdout, typed hidden
  local v; read -rs -p "$1: " v </dev/tty; echo >&2; printf '%s' "$v"
}

echo "── B4 · smoke secrets"
ANON="$(cd "$REPO/apps/mobile" 2>/dev/null && NODE_OPTIONS=--dns-result-order=ipv4first npx --yes eas-cli env:list production --format short 2>/dev/null \
  | grep '^EXPO_PUBLIC_SUPABASE_ANON_KEY=' | cut -d= -f2- | tr -d "\"'")"
while :; do
  code="$(curl -s -4 -o /dev/null -w '%{http_code}' -H "apikey: $ANON" "$SUPA/auth/v1/health")"
  [ -n "$ANON" ] && [ "$code" = 200 ] && { echo "  ✓ anon key accepted by prod"; break; }
  ANON="$(ask 'Prod anon key (Supabase → Connect → Publishable key)')"
done

# Prod's session pooler: the only pooler host that knows this project
# (probed 2026-10-29). Only the password is asked for, and it is
# percent-encoded before it goes into the URL. Return on its own skips.
TEMPLATE='postgresql://postgres.kotigxeeigjytdtwklyu:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres'
DBURL=""
existing="${LUDI_PROD_DB_URL:-$(bash -c 'eval "$(grep -E "^export LUDI_PROD_DB_URL=" "$HOME/.zshrc" 2>/dev/null | tail -1)"; printf %s "${LUDI_PROD_DB_URL:-}"')}"
if [ -n "$existing" ] && [ -z "$(PGCONNECT_TIMEOUT=10 psql "$existing" -Atc 'select 1' 2>&1 >/dev/null)" ]; then
  DBURL="$existing"; echo "  ✓ database URL from ~/.zshrc works"
fi
while [ -z "$DBURL" ]; do
  PW="$(ask 'Prod database password (hidden; press Return on its own to skip)')"
  [ -z "$PW" ] && { echo "  – skipped: smoke will leave out the cron and migration checks"; break; }
  DBURL="$(python3 -c 'import sys,urllib.parse; print(sys.argv[1].replace("[YOUR-PASSWORD]", urllib.parse.quote(sys.argv[2], safe="")))' "$TEMPLATE" "$PW")"
  unset PW
  err="$(PGCONNECT_TIMEOUT=10 psql "$DBURL" -Atc 'select 1' 2>&1 >/dev/null)"
  [ -z "$err" ] && { echo "  ✓ database password works"; break; }
  DBURL=""
  case "$err" in
    *"password authentication failed"*) echo "  ✗ prod rejected that password — try the next one (several misses in a row can get your IP banned: Database → Settings → Network Bans)" ;;
    *) echo "  ✗ could not reach the pooler: $(head -1 <<<"$err" | cut -c1-120)" ;;
  esac
done

q() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
touch "$HOME/.zshrc"
cp "$HOME/.zshrc" "$HOME/.zshrc.bak-launch"
if [ -n "$DBURL" ]; then drop='^export LUDI_PROD_(ANON_KEY|DB_URL)='; else drop='^export LUDI_PROD_ANON_KEY='; fi
grep -vE "$drop" "$HOME/.zshrc.bak-launch" >"$HOME/.zshrc"
echo "export LUDI_PROD_ANON_KEY=$(q "$ANON")" >>"$HOME/.zshrc"
[ -n "$DBURL" ] && echo "export LUDI_PROD_DB_URL=$(q "$DBURL")" >>"$HOME/.zshrc"
echo "  ✓ written to ~/.zshrc (previous copy: ~/.zshrc.bak-launch); new terminals pick them up"
export LUDI_PROD_ANON_KEY="$ANON"
[ -n "$DBURL" ] && export LUDI_PROD_DB_URL="$DBURL"

echo
echo "── B2 · UptimeRobot"
URKEY=""
while :; do
  URKEY="$(ask 'UptimeRobot Main API key (Integrations → API → Main API key; Return skips)')"
  [ -z "$URKEY" ] && { echo "  – skipped"; break; }
  stat="$(curl -s -X POST "$UR/getAccountDetails" -d "api_key=$URKEY&format=json" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("stat"))' 2>/dev/null)"
  [ "$stat" = ok ] && { echo "  ✓ key accepted"; break; }
  echo "  ✗ UptimeRobot refused that key — use the Main key, not the read-only one"
done
if [ -n "$URKEY" ]; then
  sleep 7
  contacts="$(curl -s -X POST "$UR/getAlertContacts" -d "api_key=$URKEY&format=json" \
    | python3 -c 'import sys,json;print("-".join("%s_0_0" % c["id"] for c in json.load(sys.stdin).get("alert_contacts",[])))')"
  if [ -z "$contacts" ]; then
    echo "  ! no alert contacts on the account: the monitors get made, but nothing will tell you when one goes down."
    echo "    Add your email (and SMS) in UptimeRobot, then run this again."
    UPTIMEROBOT_API_KEY="$URKEY" bash "$TMP/scripts/uptime_monitors.sh"
  else
    UPTIMEROBOT_API_KEY="$URKEY" bash "$TMP/scripts/uptime_monitors.sh" --alert-contacts "$contacts"
  fi
fi

echo
echo "── smoke, with both keys"
bash "$TMP/scripts/smoke_prod.sh"

echo
echo "── the launch board"
if [ -n "$URKEY" ]; then
  echo "  (waiting a minute: UptimeRobot's free plan allows ~10 calls a minute)"
  sleep 60
fi
UPTIMEROBOT_API_KEY="$URKEY" bash "$TMP/scripts/launch_check.sh"
unset URKEY
