# Android beta — direct-APK sharing, operational checklist

_Companion to [apple-testflight.md](apple-testflight.md). That doc's
"Android owner?" answer used to be "log them as a lead". This doc replaces
it: Android owners get an install link the same day. Same ticking rule as
the [ledger](stage-2-commit-plan.md) — a box goes green when the thing is
demonstrably true._

**Status: 🟨 first APK cut 2026-08-28 (versionCode 5, after 3 burnt on
the landmines below) — first-install verification on a real device still
pending.** Install page:
<https://expo.dev/accounts/neofytounikolas/projects/ludi/builds/5f65c564-0fba-4bec-8b11-65954fe334c5>

---

## Decision made up front

**Ship the beta as a direct APK via EAS internal distribution, not
through Google Play.** Consequences, accepted:

- No Play Console account needed today (US$25, one-time) and — the real
  cost — no Play review and no closed-testing gauntlet. Personal Play
  Console accounts created after Nov 2023 must run a closed test with
  **12 testers for 14 continuous days** before production access is even
  unlockable. That clock cannot finish before the Aug-31 launch, so Play
  is a post-launch track, started when it stops being on the critical
  path.
- Customers install from a link and must allow "install unknown apps"
  once. That is one extra tap wrapped in scary Android wording — the
  message templates below pre-empt it.
- **No auto-update.** Unlike TestFlight, an APK never updates itself.
  Every new build means re-sending a fresh link. Keep the shared list of
  who has which versionCode (see below).

## What already exists (verified 2026-08-28)

- `beta-android` profile in [`eas.json`](../apps/mobile/eas.json):
  extends `beta` (hosted-project env from EAS "production" environment,
  Sentry env `beta`, auth methods `phone,magic_link`), adds
  `distribution: internal` + `buildType: apk`.
- **Android upload/signing keystore generated and stored on EAS servers**
  (first build, 2026-08-28). It signs every Android build from now on,
  including the eventual Play upload. It lives only in the EAS account
  (`neofytounikolas`) — back it up with
  `eas credentials -p android` → download, and treat it like the Apple
  distribution cert.
- Remote `versionCode` initialised at 2 (`appVersionSource: remote`,
  auto-increment on).
- Package id `com.nikolasneofytou.ludi` — same as the iOS bundle id.

## Cutting a build

```bash
cd ~/dev/Ludi/apps/mobile
npx eas-cli build --platform android --profile beta-android
```

~15–20 min in the cloud queue. The build page
(`expo.dev/accounts/neofytounikolas/projects/ludi/builds/<id>`) doubles
as the **install page** — internal-distribution builds get a public
install URL + QR code, no Expo login needed on the customer's side.

If the cloud queue is exhausted (free-tier quota), build locally — same
command with `--local`, plus `SENTRY_DISABLE_AUTO_UPLOAD=true` in the
env, per the EAS-local-builds note in memory. Failed attempts still burn
version codes; that is cosmetic, ignore it.

**Known failure, now defused:** `EAS_BUILD_UNKNOWN_GRADLE_ERROR` where
the log's "Run gradlew" phase ends in
`Could not resolve com.stripe:stripe-android` / `jitpack.io … Read timed
out`. The Stripe RN SDK defaults to the dynamic version `20.52.+`, and a
dynamic version makes Gradle list versions on **every** repository —
including jitpack.io — so a JitPack outage fails the build even though
the artifact lives on Maven Central. Killed the first two builds on
2026-08-28 (versionCodes 2–3 burnt; JitPack was down ~10+ min, so
"retry" alone was not a fix).
[`plugins/withStripeVersionPin.js`](../apps/mobile/plugins/withStripeVersionPin.js)
pins the exact version via `rootProject.ext.stripeVersion`, which
resolves straight from Maven Central and never consults JitPack. When
bumping `@stripe/stripe-react-native`, update the pin to match the new
default in the package's `android/gradle.properties`.

**Second landmine, also cleared 2026-08-28:**
`@stripe/stripe-react-native@0.41.0` does not compile on Android against
Expo SDK 54's React Native (`Unresolved reference 'currentActivity'` in
`StripeSdkModule.kt`) — iOS never noticed, which is why TestFlight
builds sailed through. Bumped to the SDK-54-expected **0.50.3** via
`npx expo install @stripe/stripe-react-native` (versionCode 4 burnt
finding this; typecheck green after the bump). Note this rides into the
next iOS build too — give checkout a glance on both platforms.

## What the beta proves / does not prove

Same contract as [beta.md](plans/beta.md): the end-to-end path on a
phone this Mac has never met — install, sign in, discover, book, see the
confirmation. Money stays test-mode. Android adds two caveats of its own:

- **Sign-in is magic link only, in practice.** The build advertises
  `phone,magic_link`, but Twilio is placeholders (correction in #128), so
  phone OTP dies on hosted — and Apple sign-in does not exist on
  Android. Tell testers to use email. If phone-first sign-in matters for
  a given customer demo, that is the Twilio queue, not an Android bug.
- **Google Pay is off** (`enableGooglePay: false` in the Stripe plugin) —
  checkout is manual card entry with a test card. Fine for beta; flip it
  alongside the money-mode Go/No-Go, not before.

## First-install verification (do once per build, before sharing)

- [ ] Open the install link on a real Android phone (not an emulator),
      install past the unknown-sources prompt.
- [ ] Sign in with a magic link end-to-end (the `ludi://` scheme must
      bring the email link back into the app).
- [ ] Discover shows hosted venues; complete a test-mode booking.
- [ ] The Sentry `beta` environment received the session.

## Sharing with a customer

**Message template (owner variant):**

> EN: "Great meeting you today! Here's early access to **Ludi** — the
> app filling your quiet pitch hours. Open this link on your Android
> phone and tap **Install**. Your phone will ask you to allow installs
> from the browser — that's normal for early-access apps, tap Allow
> once: `<install link>` — I'll call you this week to hear what you
> think."
>
> ΕΛ: "Χάρηκα για τη σημερινή γνωριμία! Ορίστε πρόωρη πρόσβαση στο
> **Ludi** — την εφαρμογή που γεμίζει τις κενές ώρες του γηπέδου σου.
> Άνοιξε αυτό το link στο Android κινητό σου και πάτα **Install**. Το
> κινητό θα ζητήσει άδεια για εγκατάσταση από τον browser — είναι
> φυσιολογικό για εφαρμογές πρώιμης πρόσβασης, πάτα Allow μία φορά:
> `<install link>` — θα σε πάρω μέσα στη βδομάδα να μου πεις
> εντυπώσεις."

**Who has what** — append a row every time a link goes out; this is the
re-send list when the next build cuts:

| Date | Who | versionCode | Link sent |
|---|---|---|---|
| | | | |

## The Play track — now the preferred sharing channel

_Revised 2026-08-28, same day: the direct APK hit real-world Android
security walls (Samsung Auto Blocker / Play Protect "not installed for
security reasons") at the first customer attempt, and the Play Console
account now exists. The 12-tester/14-day gauntlet only gates
**production**; the **Internal testing** track has no wait — up to 100
testers by email, live minutes after upload, installs from the Play
Store itself (no security prompts) and **auto-updates**, which retires
the who-has-what table for Play-installed testers._

- [x] Play Console account acquired (2026-08-28).
- [x] AAB cut: `eas build -p android --profile beta` (store distribution
      is the profile default) — versionCode 6, 2026-08-28.
- [ ] Create the app in Play Console (`com.nikolasneofytou.ludi`), accept
      Play App Signing on first upload — the EAS keystore becomes the
      upload key (backed up at `~/dev/ludi-android-keystore-backup/`).
- [ ] Internal testing → upload AAB → tester email list → share the
      opt-in link (testers need a Google account).
- [ ] Wire `eas submit -p android` with a service-account key so later
      uploads are one command.
- [ ] Data-safety form + privacy-policy URL before graduating to closed
      testing/production (the DPA/DNS work in [beta.md](plans/beta.md)
      covers the URL).

The direct-APK flow above stays as the fallback for testers without a
Google account or when a build must reach a phone in minutes.
