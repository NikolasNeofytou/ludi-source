# Apple Developer enrolment + TestFlight — operational checklist

_The single most time-sensitive M6 task ([2026-08 plan](plans/2026-08.md)):
nothing puts Ludi on a real player's phone without it, and the wait times
are Apple's, not ours. Tick boxes as they complete — same rule as the
[ledger](stage-2-commit-plan.md). Unblocks M6 #42 (`eas.json` + first
TestFlight build)._

**Status: 🟩 account active · started 2026-08-11 · account active 2026-08-11**

---

## Decision made up front

**Enrol as an Individual, not an Organisation.** An organisation needs a
D-U-N-S number and can take weeks; individual usually activates in hours
to ~2 days. Consequences, accepted:

- TestFlight and the App Store will show the seller as **"Nikolas
  Neofytou"**, not "Ludi". Fine for beta; revisit before public launch.
- Apple supports converting Individual → Organisation later without
  losing the app, its bundle ID, or its testers (done via Apple support
  once a D-U-N-S exists).

If a company entity is formed before launch, migrate then — do **not**
wait for the company to enrol.

---

## Phase 0 — have ready before starting (~10 min)

- [x] An **Apple ID that is yours personally** with **two-factor
      authentication enabled** — enrolment refuses accounts without 2FA.
      Use the one signed into your iPhone; identity verification is
      smoothest there.
- [x] Apple ID name matches your **government ID** (passport or CY ID
      card) — Apple may ask for a photo of it during verification.
- [x] A **payment card** for the fee: **US$99/year** (~€92), charged
      immediately.
- [x] 20 quiet minutes with your iPhone at hand.

## Phase 1 — enrol (you, personally — ~20 min + Apple's wait)

- [x] Preferred path: install the **Apple Developer app on your iPhone**
      (App Store → "Apple Developer") and enrol from inside it — the
      in-app flow does ID scanning + face verification and typically
      activates fastest. Alternative: <https://developer.apple.com/enroll>
      in a browser.
- [x] Sign in with the Apple ID, choose **entity type: Individual**.
- [x] Complete identity verification (ID scan if asked).
- [x] Pay the US$99 and note the order confirmation.
- [x] **Wait for the "Welcome to the Apple Developer Program" email.**
      Typical: minutes–48h for individuals. If nothing after 48h,
      contact Apple Developer Support (they respond fast on phone
      callbacks) — do not re-enrol with a second Apple ID.

> While waiting, everything in Phase 3's "repo side" can proceed — the
> wait costs nothing if the venue work continues in parallel.

## Phase 2 — first hour after activation (~45 min)

All in <https://appstoreconnect.apple.com> and
<https://developer.apple.com/account>:

- [ ] Developer portal → Identifiers → register the App ID
      **`com.nikolasneofytou.ludi`** (explicit, capabilities: Sign in
      with Apple, Apple Pay later). This must match `app.json` — it
      already does; don't invent a new one.
- [ ] App Store Connect → My Apps → **New App**: platform iOS, name
      **"Ludi"** (if taken, fall back to **"Ludi — Football Pitches"**;
      the display name under the icon stays "Ludi" either way), primary
      language **English (or Greek — either is fine, both ship)**,
      bundle ID from the dropdown, SKU `ludi-ios`.
- [ ] App Store Connect → Users and Access → **invite the sales friend**
      (see tester path below) — do this now so his invite isn't waiting
      on you later.
- [ ] Tell the repo the account exists: tick this file's status line and
      ping the session — the `eas.json` + first build commit (M6 #42)
      starts the moment the account is active.

> **Beta scope decided 2026-08-21** — internal testers only, Stripe test
> mode, one hosted Supabase project. The blockers that sit *between* this
> checklist and an actual build are tracked in
> [plans/beta.md](plans/beta.md); Phase 3 below is the last step of that
> plan, not the first.

## Phase 3 — first TestFlight build (M6 #42, repo side)

Blocked only on Phase 1. When the account is active:

- [ ] `npx eas-cli login` + `npx eas-cli init` in `apps/mobile` (creates
      the EAS project id), commit `eas.json` with `preview` +
      `production` profiles.
- [ ] `eas build --platform ios --profile production` → `eas submit`
      (EAS can create the ASC app record itself if Phase 2 skipped it).
- [ ] Build appears in App Store Connect → TestFlight, "processing"
      ~15 min.
- [ ] Export compliance: **already answered in code** —
      `ITSAppUsesNonExemptEncryption=false` is set in `app.json` (Ludi
      uses only HTTPS, which is exempt), so no per-build questionnaire.
- [ ] Assign the build to the internal group → testers get a push from
      the TestFlight app immediately.

---

## Getting the friend on as a tester

Two routes; **use Internal for the sales friend** — he's effectively
team, and internal skips Apple's beta review entirely.

### Route A — Internal tester (recommended: instant, no review)

1. Get his **Apple ID email** (the one on his iPhone — Settings → tap
   his name at the top; it's the account email shown there).
2. App Store Connect → Users and Access → **+** → role **Marketing**
   (least privilege that works; he never needs to log in to ASC for
   TestFlight to function) → he accepts the email invite.
3. TestFlight tab → Internal Testing → create group **"Team"** → add
   him. Every build assigned to the group reaches him instantly,
   **no Apple review**, up to 100 internal testers.
4. He installs the **TestFlight app** from the App Store, opens the
   invite email on the phone, taps Accept → Install. Updates arrive as
   TestFlight push notifications from then on.

### Route B — External testers (for venue owners + first players, later)

- TestFlight → External Testing → create group **"Larnaca beta"** → add
  emails *or* enable the **public link** (shareable in WhatsApp — this
  is the QR-code-at-the-venue path).
- **The first external build needs Beta App Review** (~1 day, much
  lighter than App Store review) and the group needs Test Information
  filled in: beta description, feedback email, and a **privacy policy
  URL** — which is M4 #28 / the `ludi.app` registration. Internal
  testing has no such requirement, which is exactly why the friend goes
  internal now and external waits for the privacy page.
- Up to 10,000 external testers; builds after the first are usually
  auto-approved.

### Route B in the field — the on-the-spot venue flow

The insight that makes this seamless: **the public link IS the invite.**
Once the external group is approved, nobody needs to be added to
anything in App Store Connect per-tester. Anyone who opens the link
installs the beta. So "give us your email and we'll send the invite"
collapses to "we send you a message containing the link" — which you can
do from your own phone, standing at the venue, in ten seconds.

**One-time setup (this is G1 in the
[launch plan](plans/launch-2026-08-31.md) — do it today):**

1. App Store Connect → TestFlight → External Testing → new group
   **"Venues"**.
2. Fill Test Information: beta description, feedback email, privacy URL
   **`https://ludi.football/privacy`** (live as of 2026-08-26).
3. Enable the **public link** on the group.
4. Add the current build → **Submit for Beta App Review** (~24–48 h,
   first build only).

**At the venue, two ways, use both:**

- **Primary — QR code.** Owner scans it with the iPhone camera →
  TestFlight opens → Install. ~30 seconds, no typing, they're looking
  at the app while you're still talking. Keep the QR as a photo on your
  phone (show your screen, they scan it) and as a printed card.
- **Backup — take their number/email anyway.** It's your sales lead,
  and it covers the owner who says "later". Send the templated message
  below (WhatsApp beats email in Cyprus) with the same public link.
  Nothing to do in App Store Connect.

**Generating the QR** once the public link exists (it looks like
`https://testflight.apple.com/join/XXXXXXXX`):

```bash
brew install qrencode
```

```bash
cd ~/Desktop
qrencode -s 12 -m 2 -o ludi-beta-qr.png "https://testflight.apple.com/join/XXXXXXXX"
```

**Message template for the link (owner variant):**

> EN: "Great meeting you today! Here's early access to **Ludi** — the
> app filling your quiet pitch hours. Open this on your iPhone, tap
> Install (it uses Apple's free TestFlight app):
> https://testflight.apple.com/join/XXXXXXXX — I'll call you this week
> to hear what you think."
>
> ΕΛ: "Χάρηκα για τη σημερινή γνωριμία! Ορίστε πρόωρη πρόσβαση στο
> **Ludi** — την εφαρμογή που γεμίζει τις κενές ώρες του γηπέδου σου.
> Άνοιξέ το στο iPhone και πάτα Install (χρησιμοποιεί τη δωρεάν
> εφαρμογή TestFlight της Apple):
> https://testflight.apple.com/join/XXXXXXXX — θα σε πάρω μέσα στη
> βδομάδα να μου πεις εντυπώσεις."

**Android owner?** The TestFlight link is iOS-only, but Android is no
longer a gap: send the direct-APK install link instead — process and
message templates in [android-beta.md](android-beta.md).

### Message to send him now (so his side is ready before the build is)

> EN: "You're getting early access to Ludi through Apple's TestFlight.
> Two things: (1) install the free **TestFlight** app from the App
> Store, (2) send me the **email of your Apple ID** (Settings → your
> name at the top). You'll get an invite email — open it on your phone
> and tap Accept. Every new version after that updates automatically."
>
> ΕΛ: "Θα πάρεις πρόωρη πρόσβαση στο Ludi μέσω του TestFlight της
> Apple. Δύο πράγματα: (1) κατέβασε τη δωρεάν εφαρμογή **TestFlight**
> από το App Store, (2) στείλε μου το **email του Apple ID** σου
> (Ρυθμίσεις → το όνομά σου πάνω-πάνω). Θα σου έρθει πρόσκληση με
> email — άνοιξέ το στο κινητό και πάτα Accept. Μετά, κάθε νέα έκδοση
> ενημερώνεται μόνη της."

---

## What this does NOT unblock

- **App Store listing** — needs the privacy policy page (M4 #28),
  screenshots, and full App Review. TestFlight first; store later.
- **Apple Pay in production** — needs a merchant identifier under the
  new team + Stripe configuration; card payments in the Payment Sheet
  work without it. Tracked separately.
- **Live money** — Stripe live-mode activation is its own queue
  ([2026-08 plan](plans/2026-08.md), "Start these today").

## Changelog

- **2026-08-11** — Initial checklist. `ITSAppUsesNonExemptEncryption`
  set in `app.json` alongside, so builds skip the export-compliance
  questionnaire.
- **2026-08-26** — Route B field flow added: public link = the invite,
  QR primary / templated WhatsApp with link as backup, no per-tester ASC
  work. Privacy URL prerequisite (`ludi.football/privacy`) is live.
- **2026-08-11** — Account active, Phase 0/1 done. `npx eas login` fails
  with `npm error could not determine executable to run` — the package
  is `eas-cli`, not `eas`; `npx eas` never resolves it. Use
  `npx eas-cli login` (or install globally: `npm install -g eas-cli`,
  then plain `eas login`/`eas init`).
