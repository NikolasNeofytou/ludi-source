# ADR-0024 — Venue owners sign in by email magic link, and accounts are invited, not self-created

**Status:** Accepted — implementation staged (config now, flow + UI after launch)
**Date:** 2026-08-29
**Deciders:** Solo founder
**Supersedes:** —
**Superseded by:** —

## Context

`apps/admin` became a customer-facing venue-owner product in
[ADR-0019](0019-venue-owners-share-apps-admin.md). Its authentication did
not change with it: it is still the phone-OTP flow built for a founder
signing into an internal tool. Reviewed 2026-08-29, two days before
launch, against prod's live auth settings rather than assumptions.

What the review found, in severity order:

1. **Signup is open on prod** (`disable_signup: false`, read from
   `/auth/v1/settings`). Anyone can create an account. They land on
   `/locked` and read nothing — the authorization side (RLS, the two
   gates) holds. But `signInWithOtp` is an unauthenticated endpoint that
   sends an SMS on demand, so the moment Twilio Verify goes live this is
   an **SMS-pumping / artificially-inflated-traffic** target: an attacker
   pumps messages to premium numbers they control and Ludi pays Twilio
   per send. Open signup also directly contradicts ADR-0019's stated
   posture that owner access is *granted, not requested*.
2. **The live prod credential is a static password.** With Twilio on
   placeholder credentials, owner sign-in bridges through Supabase Test
   Phone Numbers: a fixed six-digit code, shared by voice, that never
   rotates until deleted (auto-expiry 2026-09-30). A 10⁶ keyspace with
   no rotation is not a one-time code.
3. **Email auth is enabled and unused** — a second open door with no
   product behind it.

The forcing constraint is that **Twilio Verify is the last external gate
on the launch**, and external queues cannot be compressed by working
harder (the same lesson the Apple/DPA/Stripe queues taught in
[plans/2026-08.md](../plans/2026-08.md)).

## Decision

**Venue owners sign in with an email magic link, and their account is
created by invitation from the founder rather than by self-signup.**

Three parts, staged:

1. **Now (config):** `disable_signup: true` on prod. Existing accounts
   are unaffected; this closes the SMS-pumping vector and the junk-account
   surface in one setting, and makes the deployed reality match ADR-0019.
2. **Next (flow):** email magic link becomes the primary method, backed by
   a real transactional SMTP sender on the `ludi.football` domain. Phone
   OTP stays in place until magic link is proven working end to end —
   never remove the only working door before the new one opens.
3. **After (surface):** the sign-in screen is rewritten in owner voice
   (see Consequences), and an invite path is added.

Email is chosen over hardened phone OTP primarily because **it takes
Twilio off the launch critical path entirely**, and secondarily because it
is not SIM-swappable and business email usually sits behind its own
second factor. The owner already supplies an email address during
onboarding (the first owner gave the venue's own business address).

## Consequences

### Positive
- **Twilio stops being a launch blocker.** The last uncompressible
  external queue is removed from the critical path.
- **No standing shared secret.** The Test Phone Numbers bridge — a static
  password by any honest description — is retired rather than left to
  expire on 2026-09-30.
- **Deployed posture finally matches ADR-0019.** "Granted, not requested"
  becomes literally true instead of aspirational.
- No SIM-swap exposure; magic links are single-use and time-boxed.

### Negative
- **Closing signup breaks the documented provisioning flow.**
  [plans/piacere-handover.md](../plans/piacere-handover.md) §2 has the
  owner sign in once to *create* their account, then the founder grants
  access. That first step now fails. The first owner is already
  provisioned so nothing is blocked today, but **the second owner needs an
  invite path before they can be onboarded.** The admin app cannot do this
  itself — it deliberately holds no service-role key (ADR-0019) — so it
  needs an `invite-venue-owner` Edge Function wrapping
  `auth.admin.inviteUserByEmail`. This is now a hard dependency, not a
  nice-to-have.
- **One external dependency is swapped for another, not eliminated.**
  Magic links need production SMTP (Resend/Postmark) with SPF/DKIM on
  `ludi.football`; Supabase's built-in mailer is rate-limited and not for
  production use. Domain verification is DNS-speed (minutes to hours)
  rather than Twilio-speed (days), so this is a real win — but it is not
  free, and it should be started before it is needed.
- **Email is a weaker identifier than phone for this audience.** Cypriot
  venue owners transact by phone and WhatsApp; an email address may be
  checked rarely, or be a shared office inbox. Mitigation: phone OTP is
  retained as a second method once Verify clears, so owners are not
  forced onto a channel they do not use.

### Neutral
- Magic-link deliverability becomes an operational concern (spam folders,
  corporate filters) in a way SMS was not. Worth a bounce/complaint
  dashboard once there are more than a handful of owners.
- MFA is still absent on a surface that shows revenue and customer PII.
  Deliberately out of scope here; revisit with passkeys (currently
  `passkeys_enabled: false` on prod) once the owner base justifies the
  enrolment friction.

## Alternatives considered

### Harden phone OTP and keep it as primary
Matches what the audience expects, and the hardening itself (close
signup, Twilio Verify's own fraud controls and geo-permissions, a UI
pass) is genuinely cheap. **Rejected as the primary** only because it
leaves Twilio on the launch critical path — the single constraint this
decision exists to remove. Retained as the secondary method, so nothing
about this alternative is wasted.

### Passwords plus TOTP
Rejected: passwords for non-technical owners mean weak passwords and a
reset flow, which is more attack surface rather than less, plus an
enrolment burden on a five-minute handover call.

### Passkeys / WebAuthn
Strongest option and phishing-resistant, but `passkeys_enabled` is false
on prod and enrolling a non-technical venue owner during a handover call
is a real hurdle. Parked as the eventual target, not the launch move.

### Leave it as it is until after launch
Tempting at launch minus two. Rejected for one reason: the SMS-pumping
vector *activates* on the day Twilio Verify goes live, which is a step
already scheduled. Shipping the open endpoint into that change is the one
outcome worth spending config time to avoid.

## Follow-ups

- `disable_signup: true` on prod (founder, dashboard) — the only part of
  this ADR that is urgent.
- Confirm OTP verify rate limits and expiry in the dashboard; they could
  not be read from outside.
- Provision transactional SMTP + SPF/DKIM on `ludi.football`.
- Build `invite-venue-owner` Edge Function; update
  [plans/piacere-handover.md](../plans/piacere-handover.md) §2, whose
  current instructions stop working the moment signup closes.
- Rewrite the sign-in screen in owner voice: it currently says "Ludi
  Admin" and asks for an "admin phone number", surfaces raw GoTrue error
  strings, has no resend or countdown, hides its whole designed panel
  below 880px (i.e. on the owner's actual device), and still says
  "Larnaca · Cyprus" after the same Larnaca→Cyprus drift was corrected on
  `apps/site` in PR #117.
- Delete the Test Phone Numbers entries once magic link is verified
  working for the founder's own prod sign-in.
