# Ludi · Vision

_Last updated: Phase 0 kickoff (2026-04-21)_

## The one-paragraph pitch

**Ludi** is a mobile booking app for amateur football players in Cyprus. It removes the friction of finding and paying for a pitch at the right time. Players discover 5-, 7-, and 11-a-side pitches on the island, pick a slot, pay via Apple Pay / Google Pay / card, and show up to play. The primary goal is to reach product-market fit in Cyprus as a **commission-on-booking marketplace (10% take rate)** before expanding across the Eastern Mediterranean.

Matchmaking (join/host open games, skill matching, split payment, post-match results and teammate ratings) is the **Stage 3** differentiator that turns Ludi from a booking app into a habit. It is deliberately cut from MVP to ship in 3 months.

## Who this is for

**Primary: amateur footballers aged 18–45 in Cyprus** who already play weekly or want to, who've tried WhatsApp groups and Facebook events and found them exhausting. They speak English or Greek (often both), pay with card or Apple Pay, and want less admin and more playing.

**Secondary: pitch owners** — GSP Arena, Larnaca Sportsplex, Marina Pitch, neighbourhood 5-a-side venues. They have idle mid-week slots, no digital booking system, and currently manage everything over WhatsApp. Ludi gives them a free booking engine in exchange for a 10% take rate on transactions it sources.

## Why now

- Cyprus has no dominant player in this space (unlike Spain/Portugal where Playtomic is entrenched).
- Post-pandemic return to recreational sport is structural, not cyclical.
- Pitch owners already use WhatsApp for bookings — the behaviour gap to app is small.
- EU payments infrastructure (Stripe, SEPA, Apple Pay) makes take-rate economics work from day one.
- The founder lives in Cyprus and can physically walk into pitch owners' offices to sell.

## What winning looks like in 12 months

**Falsifiable targets** (these are the only ones that matter):

| Metric | 3mo | 6mo | 12mo |
|---|---|---|---|
| Paying pitch-owner partners | 1 | 5 | 15 |
| Bookings / month | 20 | 200 | 1,500 |
| Monthly active players | 50 | 500 | 3,000 |
| GMV / month (bookings) | €600 | €7,000 | €55,000 |
| Take-rate revenue / month | €60 | €700 | €5,500 |
| Cities live | 1 (Larnaca) | 2 | 4 |

If at 6 months we are under 50% of these numbers across the board, we stop adding features and talk to users. If we are over 150%, we raise or start hiring.

## Launch focus

**City: Larnaca first.** Smaller than Nicosia but tighter community, easier pitch-owner relationships, faster word-of-mouth. Single-city density beats island-wide thinness every time — this is the Playtomic/Uber/Airbnb playbook.

**Pitch type: 5-a-side first.** Higher booking frequency than 11-a-side, lower social coordination cost than 7-a-side.

**Language: EN + ΕΛ from day one.** Non-negotiable for Cypriot users and baked into the design system already.

## What Ludi is **not**

Being explicit about what we will not build is how we ship in 3 months:

- ❌ Not a social network. No feed, no following, no stories.
- ❌ Not a coaching platform. No lesson bookings, no drills, no trainer profiles.
- ❌ Not a tournament platform. No brackets, no leagues, no cups. (Maybe Stage 5.)
- ❌ Not a general sports app. Football only. Not padel, not tennis, not basketball.
- ❌ Not a web app for players. Mobile-only for players; pitch owners get a web dashboard eventually.
- ❌ Not a free platform. We take 10% from day one. No "grow first, monetize later."
- ❌ Not a Greek-speaking-Cyprus-only app. EN parity always.

## Project posture

This is a **solo-built side project with serious intent**. If it works, it becomes a company. That means:

- **Pace:** 3 months to first paying booking. Side-project hours, ruthless MoSCoW.
- **Infrastructure:** No premature optimisation, but do it right where irreversibility bites — payments, auth, RLS, data model.
- **Legal:** Sole-trader initially, LLC if/when revenue justifies. Stripe handles most compliance. GDPR posture baked in from day one (EU jurisdiction — no choice).
- **Support:** Founder handles all support via WhatsApp + email until volume forces automation.

## Open risks (in order of scariness)

1. **Supply-side unvalidated.** Zero pitch owners have said yes. Biggest risk. First real task after this planning pass: book three in-person meetings with Larnaca pitch owners.
2. **Cold-start matchmaking.** Open matches need ~20 active players per city to feel alive. Seeded launch with a WhatsApp group converting to Ludi users is the planned cold-start move.
3. **Payout friction with Stripe Connect.** Onboarding Cypriot SMB owners to Stripe Express is not zero work. Prototype in week 1 of Stage 2.
4. **Solo-founder burnout.** Mitigation: ship in 3 months, don't let scope creep beyond MVP.
5. **Seasonality.** Outdoor football drops in August heat and December rain. Indoor pitches (Strovolos, Larnaca Sportsplex) hedge this — prioritise them in supply onboarding.

## Changelog

- **2026-04-21** — Phase 0 of elite-dev planning pass. Vision locked. Launch city Larnaca, 10% take rate, 3-month horizon.
