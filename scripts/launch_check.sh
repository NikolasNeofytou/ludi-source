#!/usr/bin/env bash
# launch_check.sh — is every switch the public launch needs actually on?
#
# The companion to docs/runbooks/public-launch.md. That runbook lists the
# switches in order; this prints one line per switch, read from the
# thing itself (GitHub, UptimeRobot, Sentry, EAS, Vercel, the App Store,
# the live site), so a box is green because it is true, not because
# someone remembers ticking it. Read-only throughout: every call is a GET
# or a list. Nothing here changes anything.
#
#   ✓  on, checked just now
#   ✗  off, or checked and wrong — the [step] says which runbook step fixes it
#   !  works, but not the way the runbook recommends
#   –  cannot be checked from here (a key or a login this shell lacks)
#
# Usage:
#   bash scripts/launch_check.sh
#   UPTIMEROBOT_API_KEY=… SENTRY_AUTH_TOKEN=… SENTRY_ORG=… bash scripts/launch_check.sh
#
# Optional environment, each unlocks one more line:
#   UPTIMEROBOT_API_KEY   the account's read-only or main API key (O2)
#   SENTRY_AUTH_TOKEN     a token with project:read, plus SENTRY_ORG (O3)
#   LUDI_PROD_ANON_KEY, LUDI_PROD_DB_URL   the smoke script's two (O5)
#   VERCEL_TOKEN          otherwise the Vercel CLI's own login is tried
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SITE="https://ludi.football"
ASC_APP_ID="6800232498"
VERCEL_TEAM="nikolas-neofytous-projects"
BACKUP_REPO="NikolasNeofytou/ludi-backups"
# Only the app reports to Sentry today: there is no ludi-edge or ludi-admin
# project (checked 2026-10-29) and the functions have no SENTRY_DSN.
SENTRY_PROJECTS=(ludi-mobile)
UPTIME_MONITORS=("Ludi site health" "Ludi auth gateway" "Ludi QR /get" "Ludi admin login")

RED=0
UNKNOWN=0
green() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
red()   { printf '  \033[31m✗\033[0m %s\n' "$1"; RED=$((RED + 1)); }
warn()  { printf '  \033[33m!\033[0m %s\n' "$1"; }
skip()  { printf '  \033[2m–\033[0m %s\n' "$1"; UNKNOWN=$((UNKNOWN + 1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# days_since <ISO-8601 timestamp or YYYY-MM-DD> → whole days, or empty.
days_since() {
  python3 - "$1" <<'PY' 2>/dev/null
import sys, datetime as dt
s = sys.argv[1].strip().replace('Z', '+00:00')
try:
    t = dt.datetime.fromisoformat(s)
except ValueError:
    sys.exit(0)
if t.tzinfo is None:
    t = t.replace(tzinfo=dt.timezone.utc)
print((dt.datetime.now(dt.timezone.utc) - t).days)
PY
}

printf '\n\033[1mLudi launch check — %s\033[0m\n' "$(date '+%Y-%m-%d %H:%M %Z')"

# ── O1. Prod can be put back ────────────────────────────────────────────
head_ "O1 — backups"

# The job moved to the private NikolasNeofytou/ludi-backups (PR #330) because
# a public repo's artifacts are downloadable by anyone; until that repo has
# a green run, this repo's own history still counts.
if command -v gh >/dev/null 2>&1; then
  last_ok=""; where=""
  for repo in "$BACKUP_REPO" "$(cd "$ROOT" && gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)"; do
    [ -n "$repo" ] || continue
    last_ok="$(gh run list --repo "$repo" --workflow backups.yml --status success --limit 1 --json createdAt -q '.[0].createdAt' 2>/dev/null)"
    if [ -n "$last_ok" ]; then where="$repo"; break; fi
  done
  if [ -n "$last_ok" ]; then
    d="$(days_since "$last_ok")"
    if [ "${d:-99}" -le 8 ]; then
      green "last green backup ${last_ok%%T*} (${d} days ago, $where)"
    else
      red "last green backup ${last_ok%%T*} — ${d} days ago, more than a week ($where) [B1]"
    fi
    [ "$where" = "$BACKUP_REPO" ] || warn "backups still run in this repo — move them to $BACKUP_REPO before it goes public (#330) [B1]"
  else
    red "no backup has ever succeeded in $BACKUP_REPO or this repo — its two secrets [B1]"
  fi
else
  skip "gh CLI not installed — cannot read the Backups workflow"
fi

rehearsed="$(grep -m1 -E '^\*\*Last rehearsed:\*\*' "$ROOT/docs/runbooks/restore-from-backup.md" 2>/dev/null | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)"
if [ -n "$rehearsed" ]; then
  d="$(days_since "$rehearsed")"
  if [ "${d:-99}" -le 31 ]; then green "restore rehearsed $rehearsed"; else red "restore last rehearsed $rehearsed — over a month ago [B1]"; fi
else
  red "restore never rehearsed — runbooks/restore-from-backup.md says so [B1]"
fi

# ── O2. Something polls prod ────────────────────────────────────────────
head_ "O2 — uptime monitors"

if [ -n "${UPTIMEROBOT_API_KEY:-}" ]; then
  monitors="$(curl -s --max-time 20 -X POST https://api.uptimerobot.com/v2/getMonitors \
    -d "api_key=${UPTIMEROBOT_API_KEY}&format=json" 2>/dev/null)"
  # A refused call (the free plan's ~10 calls a minute, a bad key) carries
  # no "monitors" at all: say so, rather than report every monitor missing.
  ur_err="$(python3 -c '
import sys, json
try:
    d = json.loads(sys.stdin.read())
except Exception:
    print("no answer"); sys.exit()
if d.get("stat") != "ok":
    e = d.get("error") or {}
    print(e.get("type") or e.get("message") or "refused")
' <<<"$monitors")"
  [ -n "$ur_err" ] && skip "UptimeRobot answered \"$ur_err\" — wait a minute and run again (the free plan allows ~10 calls a minute)"
  for name in "${UPTIME_MONITORS[@]}"; do
    [ -n "$ur_err" ] && break
    st="$(python3 -c '
import sys, json
name = sys.argv[1]
try:
    ms = json.loads(sys.stdin.read()).get("monitors", [])
except Exception:
    ms = []
hit = [m for m in ms if m.get("friendly_name") == name]
print(hit[0]["status"] if hit else "missing")
' "$name" <<<"$monitors")"
    case "$st" in
      2) green "$name — up" ;;
      missing) red "$name — no such monitor [B2]" ;;
      0|1) warn "$name — paused or not checked yet (status $st)" ;;
      *) red "$name — DOWN (status $st)" ;;
    esac
  done
else
  skip "no UPTIMEROBOT_API_KEY — cannot list monitors (the runbook's step B2 creates them)"
fi

# ── O3. Sentry alerts ───────────────────────────────────────────────────
head_ "O3 — Sentry alert rules"

if [ -n "${SENTRY_AUTH_TOKEN:-}" ] && [ -n "${SENTRY_ORG:-}" ]; then
  for p in "${SENTRY_PROJECTS[@]}"; do
    n="$(curl -s --max-time 20 -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" \
      "${SENTRY_URL:-https://sentry.io}/api/0/projects/${SENTRY_ORG}/${p}/rules/" 2>/dev/null \
      | python3 -c 'import sys,json
try:
    d = json.load(sys.stdin); print(len(d) if isinstance(d, list) else "err")
except Exception:
    print("err")')"
    # Since Sentry's October 2026 move to "Monitors & Alerts", alerts made in
    # the UI no longer show up under /rules/ — ludi-mobile's two (the default
    # high-priority one, and "more than 10 events in an hour", 2026-10-29)
    # read as 0 here. So a low count means "look in Monitors → Alerts", not off.
    case "$n" in
      err) skip "$p — the API refused (token scope, org slug, or region)" ;;
      0|1) warn "$p — $n legacy alert rule(s); alerts now live in Sentry → Monitors → Alerts, check there [B3]" ;;
      *) green "$p — $n alert rules" ;;
    esac
  done
else
  skip "no SENTRY_AUTH_TOKEN + SENTRY_ORG — cannot read rules (step B3 is in the Sentry UI)"
fi

# ── O5. The smoke test can run in full ──────────────────────────────────
head_ "O5 — smoke"

if [ -n "${LUDI_PROD_ANON_KEY:-}" ] && [ -n "${LUDI_PROD_DB_URL:-}" ]; then
  green "LUDI_PROD_ANON_KEY and LUDI_PROD_DB_URL are in this shell"
else
  red "smoke secrets missing from this shell — REST and cron tiers will be skipped [B4]"
fi

smoke_out="$(bash "$ROOT/scripts/smoke_prod.sh" 2>&1)"
smoke_rc=$?
smoke_fail="$(grep -c '✗' <<<"$smoke_out" || true)"
smoke_skip="$(grep -c '–' <<<"$smoke_out" || true)"
if [ "$smoke_rc" -eq 0 ]; then
  if [ "$smoke_skip" -eq 0 ]; then green "smoke_prod.sh passed, nothing skipped"; else warn "smoke_prod.sh passed with $smoke_skip tier(s) skipped"; fi
else
  red "smoke_prod.sh FAILED ($smoke_fail red line(s)) — run it on its own to read them"
fi

# ── The floor (O7) ──────────────────────────────────────────────────────
head_ "O7 — the app's minimum-version floor"

config="$(curl -s --max-time 15 "$SITE/.well-known/app-config" 2>/dev/null)"
floors="$(python3 -c 'import sys,json
try:
    d = json.load(sys.stdin); print(d["ios"]["minVersion"], d["android"]["minVersion"])
except Exception:
    print("")' <<<"$config")"
store="$(curl -s --max-time 15 "https://itunes.apple.com/lookup?id=${ASC_APP_ID}&country=cy" 2>/dev/null \
  | python3 -c 'import sys,json
try:
    r = json.load(sys.stdin).get("results", []); print(r[0]["version"] if r else "")
except Exception:
    print("")')"
if [ -n "$floors" ]; then
  ios_floor="${floors%% *}"
  green "/.well-known/app-config → iOS floor $ios_floor, Android floor ${floors##* }"
  if [ -n "$store" ]; then
    # The one way the gate can hurt: a floor above what the store sells
    # sends everyone to an Update that does not exist yet.
    if python3 -c 'import sys
v = lambda s: [int(p) if p.isdigit() else 0 for p in s.split(".")]
sys.exit(0 if v(sys.argv[1]) <= v(sys.argv[2]) else 1)' "$ios_floor" "$store"; then
      green "iOS floor $ios_floor ≤ the store's $store"
    else
      red "iOS floor $ios_floor is ABOVE the store's $store — every iPhone is locked out; lower it now"
    fi
  else
    skip "not in the App Store yet — the floor cannot be compared with a live version"
  fi
else
  red "/.well-known/app-config does not answer with a floor — the gate lets everyone through [merge the floor PR]"
fi

# ── Analytics ───────────────────────────────────────────────────────────
head_ "Analytics — PostHog"

eas_names="$(cd "$ROOT/apps/mobile" && NODE_OPTIONS=--dns-result-order=ipv4first npx --yes eas-cli env:list production --format short 2>/dev/null | sed -E 's/=.*//')"
if [ -z "$eas_names" ]; then
  skip "EAS CLI not logged in — cannot list the production environment"
elif grep -qx 'EXPO_PUBLIC_POSTHOG_API_KEY' <<<"$eas_names"; then
  green "EXPO_PUBLIC_POSTHOG_API_KEY in EAS production (only builds cut after it was added carry it)"
else
  red "no EXPO_PUBLIC_POSTHOG_API_KEY in EAS production — the store build records nothing [A1]"
fi

# ── Hosting ─────────────────────────────────────────────────────────────
head_ "Hosting — Vercel"

vtoken="${VERCEL_TOKEN:-}"
if [ -z "$vtoken" ]; then
  vtoken="$(python3 -c 'import json,os
p = os.path.expanduser("~/Library/Application Support/com.vercel.cli/auth.json")
try:
    print(json.load(open(p)).get("token", ""))
except Exception:
    print("")' 2>/dev/null)"
fi
if [ -n "$vtoken" ]; then
  team="$(curl -s --max-time 15 -H "Authorization: Bearer $vtoken" https://api.vercel.com/v2/teams 2>/dev/null \
    | python3 -c 'import sys,json
try:
    ts = json.load(sys.stdin).get("teams")
except Exception:
    ts = None
if ts is None:
    print("refused"); sys.exit()
t = [t for t in ts if t.get("slug") == sys.argv[1]]
if not t:
    print("missing"); sys.exit()
t = t[0]
print((t.get("billing") or {}).get("plan", "?"), "blocked" if t.get("softBlock") else "ok")' "$VERCEL_TEAM")"
  case "$team" in
    refused) skip "the Vercel token was refused — vercel login, or VERCEL_TOKEN" ;;
    missing) skip "team $VERCEL_TEAM not visible to this token" ;;
    *blocked) red "Vercel team is SOFT-BLOCKED — every Ludi page answers 402 [B5]" ;;
    hobby*) warn "Vercel on Hobby — non-commercial terms, and one fair-use pause takes down site, admin and the TV together [B5]" ;;
    *) green "Vercel plan: ${team% *}" ;;
  esac
else
  skip "no Vercel login on this machine"
fi

# ── The store cutover (after Release) ───────────────────────────────────
head_ "Release — App Store"

if [ -n "$store" ]; then
  green "listed in the App Store, version $store"
  get_body="$(curl -s --max-time 15 "$SITE/get" 2>/dev/null)"
  if grep -q 'apps.apple.com' <<<"$get_body" && ! grep -q 'testflight.apple.com' <<<"$get_body"; then
    green "/get points at the App Store, no TestFlight link left"
  else
    red "/get still carries a TestFlight link — merge #221 and set APP_DOWNLOAD_URL [C2]"
  fi
  if curl -s --max-time 15 "$SITE/.well-known/apple-app-site-association" 2>/dev/null | grep -q '/v/\*'; then
    green "AASA claims /v/* — venue links open the app"
  else
    red "AASA does not claim /v/* yet — merge E7 (release-1-0.md) [C4]"
  fi
else
  skip "not released yet — the cutover lines start once the listing exists"
fi

# ── Verdict ─────────────────────────────────────────────────────────────
printf '\n'
if [ "$RED" -eq 0 ]; then
  printf '\033[32m✓ nothing red\033[0m'
else
  printf '\033[31m✗ %d red\033[0m' "$RED"
fi
[ "$UNKNOWN" -gt 0 ] && printf ', %d not checkable from this shell' "$UNKNOWN"
printf ' — docs/runbooks/public-launch.md has the step for each [code]\n'
[ "$RED" -eq 0 ]
