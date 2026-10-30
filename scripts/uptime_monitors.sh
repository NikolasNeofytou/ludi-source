#!/usr/bin/env bash
# uptime_monitors.sh — O2 of docs/plans/ops-readiness.md. Creates (or
# reports) the four UptimeRobot monitors that watch prod every five
# minutes. Idempotent: a monitor whose friendly name already exists is
# left alone — except that it gets the alert contacts passed here, and a
# monitor of the wrong type (the old HTTP auth-gateway one) is replaced.
#
#   usage: UPTIMEROBOT_API_KEY=u…-… LUDI_PROD_ANON_KEY=… scripts/uptime_monitors.sh [--alert-contacts "id1_0_0-id2_0_0"]
#
# The API key is the account's *Main API key* (UptimeRobot → Integrations
# → API → Main API key). Read-only keys cannot create monitors. Alert
# contacts (email, and SMS where the plan has it) are created in the
# UptimeRobot UI and passed here by id, each as `<id>_0_0` (threshold and
# recurrence 0), joined by `-`; run with no flag first, it prints the ids.
# scripts/launch_watch.sh does all of this with hidden prompts.
#
# The free plan allows about ten API calls a minute, so calls are spaced
# seven seconds apart; a run takes about a minute.
#
# What each monitor asserts, and why it is shaped that way:
#   1. site health     keyword monitor on /.well-known/health; the body
#                      must contain "status":"ok".
#   2. auth gateway    keyword monitor on /auth/v1/health?apikey=<anon>;
#                      the body must contain "GoTrue". Not an HTTP monitor:
#                      the free plan's HTTP monitors send HEAD, the gateway
#                      answers HEAD with 405, and choosing GET is a paid
#                      feature. Keyword monitors send GET, and the gateway
#                      takes the key as a query parameter (checked
#                      2026-10-29: GET 200 with GoTrue in the body, HEAD
#                      405, no key 401). The anon key is already public in
#                      the app bundle, so a URL carrying it is fine.
#   3. QR redirect     HTTP monitor on /get. UptimeRobot follows the 3xx,
#                      so "up" means the redirect target answered. It
#                      cannot assert *where* it went — scripts/smoke_prod.sh
#                      does that after every deploy.
#   4. admin login     HTTP monitor on ludi-admin.vercel.app/login → 200.
set -euo pipefail

: "${UPTIMEROBOT_API_KEY:?set UPTIMEROBOT_API_KEY (Main API key)}"
API="https://api.uptimerobot.com/v2"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ALERT_CONTACTS=""
if [ "${1:-}" = "--alert-contacts" ]; then ALERT_CONTACTS="${2:?contact ids}"; fi

SITE="https://ludi.football"
ADMIN="https://ludi-admin.vercel.app"
SUPA="https://kotigxeeigjytdtwklyu.supabase.co"
# The prod anon key: the smoke script's LUDI_PROD_ANON_KEY, or apps/mobile/.env
# only when that file points at prod — on a dev Mac it points at the local
# stack, and a monitor sending the local key would answer 401 forever.
ANON="${SUPABASE_ANON_KEY:-${LUDI_PROD_ANON_KEY:-}}"
if [ -z "$ANON" ] && grep -q "^EXPO_PUBLIC_SUPABASE_URL=.*kotigxeeigjytdtwklyu" "$ROOT/apps/mobile/.env" 2>/dev/null; then
  ANON="$(grep -E '^EXPO_PUBLIC_SUPABASE_ANON_KEY=' "$ROOT/apps/mobile/.env" | cut -d= -f2- | tr -d "\"'")"
fi

api() { # api <endpoint> <urlencoded-body>
  sleep 7
  curl -s -X POST "$API/$1" -H 'Content-Type: application/x-www-form-urlencoded' \
    --data "api_key=$UPTIMEROBOT_API_KEY&format=json&$2"
}
enc() { python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$1"; }

echo "→ alert contacts on the account"
api getAlertContacts "" | python3 -c '
import sys, json
d = json.load(sys.stdin)
cs = d.get("alert_contacts", [])
for c in cs:
    print("  id=%s type=%s value=%s status=%s" % (c["id"], c["type"], c["value"], c["status"]))
if not cs:
    print("  none - add email (and SMS) contacts in the UptimeRobot UI, then re-run with --alert-contacts")
'

echo "→ existing monitors"
# One line per monitor: name<TAB>id<TAB>type<TAB>contact ids (sorted, comma-joined).
existing="$(api getMonitors "alert_contacts=1" | python3 -c '
import sys, json
for m in json.load(sys.stdin).get("monitors", []):
    ids = ",".join(sorted(str(c["id"]) for c in m.get("alert_contacts", [])))
    print("%s\t%s\t%s\t%s" % (m["friendly_name"], m["id"], m["type"], ids))
')"
printf '%s\n' "$existing" | cut -f1 | sed 's/^/  /'

want_ids="$(printf '%s' "$ALERT_CONTACTS" | tr '-' '\n' | cut -d_ -f1 | sort | paste -sd, -)"

ensure() { # ensure <name> <type> <url> [extra urlencoded params]
  local name="$1" type="$2" url="$3" extra="${4:-}" row id have_type have_ids res
  row="$(printf '%s\n' "$existing" | awk -F'\t' -v n="$name" '$1 == n' | head -1)"
  if [ -n "$row" ]; then
    id="$(cut -f2 <<<"$row")"; have_type="$(cut -f3 <<<"$row")"; have_ids="$(cut -f4 <<<"$row")"
    if [ "$have_type" != "$type" ]; then
      res="$(api deleteMonitor "id=$id")"
      if echo "$res" | grep -q '"stat":"ok"'; then echo "  − $name (type $have_type, replacing)"; else echo "  ! $name → $res" >&2; return; fi
    else
      if [ -n "$ALERT_CONTACTS" ] && [ "$have_ids" != "$want_ids" ]; then
        res="$(api editMonitor "id=$id&alert_contacts=$(enc "$ALERT_CONTACTS")")"
        if echo "$res" | grep -q '"stat":"ok"'; then echo "  ~ $name (contacts attached)"; else echo "  ! $name → $res" >&2; fi
      else
        echo "  = $name (exists)"
      fi
      return
    fi
  fi
  local body="friendly_name=$(enc "$name")&url=$(enc "$url")&type=$type&interval=300&timeout=30$extra"
  [ -n "$ALERT_CONTACTS" ] && body="$body&alert_contacts=$(enc "$ALERT_CONTACTS")"
  res="$(api newMonitor "$body")"
  if echo "$res" | grep -q '"stat":"ok"'; then echo "  + $name"; else echo "  ! $name → $res" >&2; fi
}

echo "→ creating what is missing"
ensure "Ludi site health"   2 "$SITE/.well-known/health" "&keyword_type=2&keyword_case_type=0&keyword_value=$(enc '"status":"ok"')"
if [ -n "$ANON" ]; then
  ensure "Ludi auth gateway" 2 "$SUPA/auth/v1/health?apikey=$ANON" "&keyword_type=2&keyword_case_type=0&keyword_value=GoTrue"
else
  echo "  ! skipping auth gateway monitor: no prod anon key (set LUDI_PROD_ANON_KEY)" >&2
fi
ensure "Ludi QR /get"       1 "$SITE/get"
ensure "Ludi admin login"   1 "$ADMIN/login"

echo "→ result"
api getMonitors "" | python3 -c '
import sys, json
st = {0: "paused", 1: "not checked yet", 2: "UP", 8: "seems down", 9: "DOWN"}
for m in json.load(sys.stdin).get("monitors", []):
    if m["friendly_name"].startswith("Ludi"):
        print("  %15s  %s" % (st.get(m["status"], m["status"]), m["friendly_name"]))
'
