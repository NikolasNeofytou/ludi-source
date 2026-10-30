#!/usr/bin/env bash
# Deploy apps/admin to Vercel (project: ludi-admin) as a prebuilt artifact.
#
# Why this dance instead of plain `vercel deploy` from apps/admin:
#
#  1. `@ludi/config` is a workspace dep, so the build must run inside the
#     monorepo — we build locally and ship the Build Output API directory.
#  2. Next writes traced file paths RELATIVE TO THE REPO ROOT
#     (outputFileTracingRoot), but `vercel deploy --prebuilt` validates them
#     against the CWD. Deploying from apps/admin fails with a phantom
#     "@opentelemetry/api does not exist"; deploying from the repo root with
#     the output staged there succeeds. See JOURNAL.md.
#  3. Next inlines NEXT_PUBLIC_* into the middleware bundle AT BUILD TIME.
#     If `vercel pull` returned empty values (sensitive env vars pull as
#     ""), the deployed middleware crashes with MIDDLEWARE_INVOCATION_FAILED
#     — so this script refuses to deploy an empty-env build.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ADMIN="$ROOT/apps/admin"
SCOPE="nikolas-neofytous-projects"
PROD_DOMAIN="ludi-admin.vercel.app"

cd "$ADMIN"

echo "→ Pulling production env + project settings"
rm -f .vercel/.env.production.local
npx vercel pull --yes --environment=production --scope "$SCOPE" >/dev/null

# Both public Supabase values get inlined into the middleware at build time;
# either one missing and every request 500s (MIDDLEWARE_INVOCATION_FAILED).
# 2026-09-19 the anon key vanished from the project's env while only the URL
# was guarded here — prod was down ~50 minutes. The length floor also catches
# a placeholder pasted as the value (both real values are far longer).
for VAR in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY; do
  VAL="$(grep -E "^$VAR=" .vercel/.env.production.local | sed -E 's/^[^=]*="?//; s/"$//' || true)"
  if [ "${#VAL}" -lt 20 ]; then
    echo "✗ $VAR pulled missing, empty or too short to be real (${#VAL} chars)."
    echo "  It may be absent from the Production env, or stored as 'sensitive'"
    echo "  (the CLI defaults to that non-interactively) — sensitive values"
    echo "  cannot be pulled. Re-add it with:"
    echo "    npx vercel env add $VAR production --force --yes --no-sensitive --value \"...\""
    exit 1
  fi
done
echo "  ✓ public Supabase URL + anon key pulled"

echo "→ Building"
rm -rf .next .vercel/output
npx vercel build --prod >/dev/null

HOST="$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' .vercel/.env.production.local | sed -E 's|.*https?://([^./"]+).*|\1|')"
if ! grep -q "$HOST" .vercel/output/functions/middleware.func/index.js; then
  echo "✗ Prod Supabase host not inlined into the middleware bundle — refusing to deploy."
  exit 1
fi
echo "  ✓ middleware bundle carries the prod Supabase host"

# What the domain serves now — the rollback target if the new build is bad.
PREV_URL="$(npx vercel inspect "$PROD_DOMAIN" --scope "$SCOPE" 2>&1 | grep -oE 'https://[a-z0-9-]+\.vercel\.app' | grep -v "$PROD_DOMAIN" | head -1 || true)"

echo "→ Staging output at repo root and deploying"
cd "$ROOT"
mkdir -p .vercel
cp "$ADMIN/.vercel/project.json" .vercel/project.json
rm -rf .vercel/output
cp -R "$ADMIN/.vercel/output" .vercel/output
# Newer CLIs end their stdout with a JSON blob, so the last line is "}" —
# take the last deployment URL printed instead of the last line.
DEPLOY_URL="$(npx vercel deploy --prebuilt --prod --scope "$SCOPE" | grep -oE 'https://[a-z0-9-]+\.vercel\.app' | grep -v "$PROD_DOMAIN" | tail -1)"

if [ -z "$DEPLOY_URL" ]; then
  echo "✗ No deployment URL came back — nothing to alias. Check the output above."
  exit 1
fi
echo "  ✓ deployed $DEPLOY_URL"

# 4. Claim the production domain explicitly.
#
#    `--prod` alone does NOT move $PROD_DOMAIN. A `--prebuilt` deploy from a
#    staged .vercel/output carries no Git context, so Vercel treats it as a
#    production deployment but leaves the named domain pointing wherever it
#    already pointed, handing the build an auto-generated alias instead
#    (admin-teal-eta-32.vercel.app and friends). The script then exits 0, the
#    deploy looks clean, and ludi-admin.vercel.app serves the PREVIOUS build —
#    which is exactly what happened on 2026-09-16 with the Greek dashboard:
#    every check said success and the live site was seven hours stale.
#    See JOURNAL.md.
echo "→ Pointing $PROD_DOMAIN at this deployment"
npx vercel alias set "$DEPLOY_URL" "$PROD_DOMAIN" --scope "$SCOPE"

# Read it back rather than trusting the exit code: an alias that silently
# failed to move is the failure mode this whole block exists to catch.
# Inspect the DOMAIN and compare its deployment to ours — inspecting the
# deployment and looking for the domain in its alias list false-failed twice
# (2026-09-17, 2026-09-19) while the alias had in fact moved. Retry briefly:
# the read can lag the write. Capture first: under pipefail `grep -q`
# SIGPIPEs the CLI.
MOVED=""
for _ in 1 2 3 4 5; do
  LIVE="$(npx vercel inspect "$PROD_DOMAIN" --scope "$SCOPE" 2>&1 || true)"
  if grep -q "$DEPLOY_URL" <<<"$LIVE"; then MOVED=1; break; fi
  sleep 3
done
if [ -z "$MOVED" ]; then
  echo "✗ $PROD_DOMAIN did NOT move to this deployment — the site is still on the old build."
  echo "  Fix by hand:"
  echo "    npx vercel alias set $DEPLOY_URL $PROD_DOMAIN --scope $SCOPE"
  exit 1
fi
echo "  ✓ https://$PROD_DOMAIN points at this build"

# Smoke the live site. /login renders without a session, so anything but 200
# means the build is broken for everyone — put the previous build back first,
# diagnose second.
CODE=""
for _ in 1 2 3; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "https://$PROD_DOMAIN/login" || true)"
  [ "$CODE" = "200" ] && break
  sleep 3
done
if [ "$CODE" != "200" ]; then
  echo "✗ https://$PROD_DOMAIN/login answered $CODE on the new build."
  if [ -n "$PREV_URL" ]; then
    echo "  Rolling back to $PREV_URL"
    npx vercel alias set "$PREV_URL" "$PROD_DOMAIN" --scope "$SCOPE"
  else
    echo "  No previous deployment recorded — roll back by hand in the Vercel dashboard."
  fi
  exit 1
fi
echo "  ✓ https://$PROD_DOMAIN/login answers 200"
