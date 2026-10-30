#!/usr/bin/env bash
#
# check_phone_otp.sh — prove phone OTP actually works on a hosted project.
#
# Why this exists: every failure mode in this path returns HTTP 500 with a
# provider message buried in the body, and the messages are not obvious.
# "invalid username" means the credentials are wrong, not the phone number.
# "permissions disabled for the destination region" means Twilio never tried.
# Reading them by hand once is fine; reading them at 11pm before a demo is not.
#
# It sends a REAL SMS once Twilio is live, and a real SMS costs real money.
# The number is a required argument for that reason — there is no default.
#
# Usage:
#   scripts/check_phone_otp.sh +35799123456
#   scripts/check_phone_otp.sh +35799123456 --verify 123456
#
# The second form completes the round trip: it exchanges the code for a
# session, which is the only thing that proves sign-in works end to end.
# Sending an SMS proves Twilio accepted the request, nothing more.
#
# Env:
#   LUDI_ENV_FILE   Where to read the project URL + anon key from.
#                   Default: apps/admin/.env.prod.local
#
# Reads only the anon key. Never prints it, and never needs the service role.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${LUDI_ENV_FILE:-$ROOT/apps/admin/.env.prod.local}"

die() { printf '\033[0;31m✗\033[0m %s\n' "$*" >&2; exit 1; }
ok()  { printf '\033[0;32m✓\033[0m %s\n' "$*"; }
info(){ printf '\033[0;34m→\033[0m %s\n' "$*"; }
warn(){ printf '\033[0;33m!\033[0m %s\n' "$*"; }

PHONE="${1:-}"
[ -n "$PHONE" ] || die "usage: $(basename "$0") +35799123456 [--verify 123456]"
case "$PHONE" in
  +*) ;;
  *) die "phone must be E.164 and start with '+' (got '$PHONE')" ;;
esac

CODE=""
if [ "${2:-}" = "--verify" ]; then
  CODE="${3:-}"
  [ -n "$CODE" ] || die "--verify needs the 6-digit code"
fi

[ -f "$ENV_FILE" ] || die "no env file at $ENV_FILE (set LUDI_ENV_FILE)"
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

URL="${NEXT_PUBLIC_SUPABASE_URL:-}"
KEY="${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}"
[ -n "$URL" ] || die "NEXT_PUBLIC_SUPABASE_URL missing from $ENV_FILE"
[ -n "$KEY" ] || die "NEXT_PUBLIC_SUPABASE_ANON_KEY missing from $ENV_FILE"

info "project : $URL"
info "phone   : $PHONE"

# Explain the response rather than dumping it. Each of these has cost someone
# an evening at least once.
explain() {
  local body="$1"
  case "$body" in
    *"invalid username"*|*"20003"*)
      warn "Twilio rejected the CREDENTIALS, not the number."
      echo "     Account SID / Auth Token in Supabase are wrong or still placeholders."
      echo "     Check: Supabase → Authentication → Providers → Phone." ;;
    *"permissions disabled"*|*"21408"*)
      warn "Twilio geo permissions block this destination."
      echo "     Twilio Console → Verify → Settings → Geo permissions → allow Cyprus." ;;
    *"not a valid phone number"*|*"60200"*)
      warn "Twilio considers the number malformed. Check the E.164 country code." ;;
    *"unverified"*|*"21608"*)
      warn "Trial account: it can only send to numbers verified in the console."
      echo "     Upgrade to a paid account, or verify this number first." ;;
    *"no SMS provider"*|*"sms provider"*)
      warn "No SMS provider is enabled on the project at all." ;;
    *"Invalid token"*|*"expired"*|*"60202"*)
      warn "The code was wrong or has expired." ;;
    *"rate"*|*"Too Many"*|*"429"*)
      warn "Rate limited. Supabase caps OTPs per phone per hour." ;;
  esac
}

if [ -n "$CODE" ]; then
  info "verifying code (this completes the round trip)"
  RESP="$(curl -s -m 30 -w $'\n%{http_code}' \
    -X POST "$URL/auth/v1/verify" \
    -H "apikey: $KEY" -H 'Content-Type: application/json' \
    -d "{\"type\":\"sms\",\"phone\":\"$PHONE\",\"token\":\"$CODE\"}" 2>/dev/null)"
  STATUS="$(printf '%s' "$RESP" | tail -1)"
  BODY="$(printf '%s' "$RESP" | sed '$d')"

  if [ "$STATUS" = "200" ] && printf '%s' "$BODY" | grep -q "access_token"; then
    ok "session issued — phone sign-in works end to end"
    printf '%s' "$BODY" | python3 -c "
import json,sys
d=json.load(sys.stdin)
u=d.get('user') or {}
print('     user id   :', u.get('id'))
print('     phone     :', u.get('phone'))
print('     confirmed :', u.get('phone_confirmed_at'))
print('     expires_in:', d.get('expires_in'), 'seconds')
" 2>/dev/null || true
    exit 0
  fi
  printf '\033[0;31m✗\033[0m verify failed (HTTP %s)\n' "$STATUS"
  echo "$BODY" | head -c 400; echo
  explain "$BODY"
  exit 1
fi

info "requesting an OTP — this sends a real SMS if Twilio is live"
RESP="$(curl -s -m 30 -w $'\n%{http_code}' \
  -X POST "$URL/auth/v1/otp" \
  -H "apikey: $KEY" -H 'Content-Type: application/json' \
  -d "{\"phone\":\"$PHONE\"}" 2>/dev/null)"
STATUS="$(printf '%s' "$RESP" | tail -1)"
BODY="$(printf '%s' "$RESP" | sed '$d')"

if [ "$STATUS" = "200" ]; then
  ok "the project accepted the request (HTTP 200)"
  echo
  echo "  Caveat: a number registered under Test Phone Numbers and OTPs"
  echo "  short-circuits before Twilio is called, so a 200 for one of those"
  echo "  says nothing about the provider. Use a number that is NOT"
  echo "  registered as a test number to actually exercise Twilio."
  echo
  echo "  A 200 also does not mean the SMS arrived. Finish the round trip:"
  echo
  echo "      scripts/check_phone_otp.sh $PHONE --verify <code>"
  exit 0
fi

printf '\033[0;31m✗\033[0m OTP request failed (HTTP %s)\n' "$STATUS"
echo "$BODY" | head -c 400; echo
explain "$BODY"
exit 1
