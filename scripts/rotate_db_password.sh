#!/usr/bin/env bash
# rotate_db_password.sh — after you reset ludi-prod's database password in
# the Supabase dashboard, put the new one everywhere that needs it:
#
#   1. checks it against prod's session pooler (hidden prompt, retries)
#   2. ~/.zshrc  → LUDI_PROD_DB_URL (old line replaced; backup ~/.zshrc.bak-rotate)
#   3. GitHub    → NikolasNeofytou/ludi-backups secret SUPABASE_PROD_DB_URL
#                  (the weekly backup's only way in; it breaks until this runs)
#   4. offers to run the backup once now, to prove the new secret works
#
# The password is never echoed, logged or put on a command line.
#
#   bash scripts/rotate_db_password.sh
#
# First used 2026-10-29, when nobody had the 2026-10-20 password; the
# backup ran green on the new one within the minute. Runbook: public-launch.md B4.
set -uo pipefail

TEMPLATE='postgresql://postgres.kotigxeeigjytdtwklyu:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres'
REPO_BACKUPS='NikolasNeofytou/ludi-backups'

echo "First, in Supabase (ludi-prod): Project Settings → Database → Reset database password."
echo "Generate one, save it in your Passwords app, copy it. Then come back here."
echo

while :; do
  read -rs -p "New prod database password (hidden): " PW </dev/tty; echo
  [ -z "$PW" ] && { echo "  nothing entered — paste the password"; continue; }
  URL="$(python3 -c 'import sys,urllib.parse; print(sys.argv[1].replace("[YOUR-PASSWORD]", urllib.parse.quote(sys.argv[2], safe="")))' "$TEMPLATE" "$PW")"
  unset PW
  err="$(PGCONNECT_TIMEOUT=10 psql "$URL" -Atc 'select 1' 2>&1 >/dev/null)"
  [ -z "$err" ] && { echo "  ✓ prod accepts the new password"; break; }
  case "$err" in
    *"password authentication failed"*) echo "  ✗ prod rejected it — if you only just reset it, wait 30 seconds and paste it again" ;;
    *) echo "  ✗ could not reach the pooler: $(head -1 <<<"$err" | cut -c1-120)" ;;
  esac
done

q() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
touch "$HOME/.zshrc"
cp "$HOME/.zshrc" "$HOME/.zshrc.bak-rotate"
grep -vE '^export LUDI_PROD_DB_URL=' "$HOME/.zshrc.bak-rotate" >"$HOME/.zshrc"
echo "export LUDI_PROD_DB_URL=$(q "$URL")" >>"$HOME/.zshrc"
echo "  ✓ ~/.zshrc updated (previous copy: ~/.zshrc.bak-rotate)"

if printf '%s' "$URL" | gh secret set SUPABASE_PROD_DB_URL --repo "$REPO_BACKUPS" >/dev/null 2>&1; then
  echo "  ✓ $REPO_BACKUPS → SUPABASE_PROD_DB_URL updated ($(gh secret list --repo "$REPO_BACKUPS" | awk '$1=="SUPABASE_PROD_DB_URL"{print $2}'))"
else
  echo "  ✗ could not update the GitHub secret — run 'gh auth status', then this script again"
  exit 1
fi
unset URL

read -r -p "Run the backup once now to prove the new secret works? [Y/n] " go </dev/tty
case "${go:-y}" in
  [Yy]*)
    gh workflow run backups.yml --repo "$REPO_BACKUPS" && sleep 5
    echo "  started — it takes about a minute:"
    gh run list --repo "$REPO_BACKUPS" --limit 1
    echo "  watch it with:  gh run watch --repo $REPO_BACKUPS"
    ;;
  *) echo "  skipped — the next scheduled backup is Sunday 03:00 UTC" ;;
esac
