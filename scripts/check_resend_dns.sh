#!/usr/bin/env bash
# Check the DNS a Resend sending subdomain needs, and the one record that
# protects the founder's existing mailbox.
#
# Run it before trusting Resend's own "Verified" badge: the dashboard caches,
# and a record can be right in the panel and wrong on the wire. Exits non-zero
# if anything required is missing, so it can gate a deploy step.
#
# Resend ships two record layouts and which one you get depends on when the
# domain was added, so this checks for either:
#   older  — TXT SPF on the sending subdomain + a feedback MX
#   newer  — two CNAMEs (rsend.send.*, send.send.*) that Resend manages
# Both carry DKIM as a TXT at resend._domainkey.<sub>. Passing on ONE layout
# is a pass; the script only fails when neither is present.
#
# Usage:  bash scripts/check_resend_dns.sh [subdomain] [root]
# See docs/plans/resend-smtp.md.
set -uo pipefail

SUB="${1:-send.ludi.football}"
ROOT="${2:-ludi.football}"
FAIL=0

green() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
red()   { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=1; }
warn()  { printf '  \033[33m!\033[0m %s\n' "$1"; }

printf '\n\033[1mResend sending DNS — %s\033[0m\n\n' "$SUB"

# 1. DKIM. The one record both layouts share, and the one that actually
#    signs the mail.
DKIM="$(dig +short TXT "resend._domainkey.$SUB" | tr -d '"')"
[ -z "$DKIM" ] && DKIM="$(dig +short TXT "resend._domainkey.$ROOT" | tr -d '"')"
if grep -q 'p=' <<<"$DKIM"; then
  green "DKIM key published at resend._domainkey.$SUB"
else
  red "no DKIM TXT at resend._domainkey.$SUB"
fi

# 2. Sending path — either layout counts.
SPF_TXT="$(dig +short TXT "$SUB" | tr -d '"')"
CN_RSEND="$(dig +short CNAME "rsend.$SUB")"
CN_SEND="$(dig +short CNAME "send.$SUB")"

if [ -n "$CN_RSEND" ] && [ -n "$CN_SEND" ]; then
  green "sending CNAMEs present (rsend.$SUB, send.$SUB)"
elif grep -q 'amazonses.com\|resend' <<<"$SPF_TXT"; then
  green "SPF TXT on $SUB present"
  MX="$(dig +short MX "$SUB")"
  grep -qi 'amazonses.com' <<<"$MX" \
    && green "feedback MX set" \
    || warn "no feedback MX — mail still sends, bounces go unreported"
else
  red "no sending records on $SUB (expected two CNAMEs, or an SPF TXT)"
  [ -n "$CN_RSEND" ] && warn "rsend.$SUB is set but send.$SUB is not — half-entered"
  [ -n "$CN_SEND" ]  && warn "send.$SUB is set but rsend.$SUB is not — half-entered"
fi

# 3. DMARC on the root. Optional for sending, real for inbox placement.
DMARC="$(dig +short TXT "_dmarc.$ROOT" | tr -d '"')"
grep -q 'v=DMARC1' <<<"$DMARC" \
  && green "DMARC present: $DMARC" \
  || warn "no DMARC on $ROOT — deliverability suffers; one TXT record fixes it"

# 4. The guard rail. The root SPF belongs to Google Workspace and carries the
#    founder's real mailbox; this script exists partly to notice the day
#    somebody 'helpfully' adds Resend to it.
printf '\n\033[1mRoot domain (must stay Google-only)\033[0m\n\n'
ROOT_SPF="$(dig +short TXT "$ROOT" | tr -d '"' | grep 'v=spf1' || true)"
if [ -z "$ROOT_SPF" ]; then
  red "no SPF on $ROOT at all — Workspace mail is unprotected"
elif grep -q '_spf.google.com' <<<"$ROOT_SPF"; then
  if grep -q 'resend\|amazonses' <<<"$ROOT_SPF"; then
    warn "root SPF now mentions Resend: $ROOT_SPF"
    warn "the subdomain exists so the root does not need this — see the runbook"
  else
    green "root SPF unchanged (Google only)"
  fi
else
  red "root SPF no longer includes Google: $ROOT_SPF"
fi

echo
if [ "$FAIL" -eq 0 ]; then
  printf '\033[32mRequired records present.\033[0m Send a real invite and confirm Resend reports "delivered", not just "sent".\n\n'
else
  printf '\033[31mSomething required is missing.\033[0m See docs/plans/resend-smtp.md.\n\n'
fi
exit "$FAIL"
