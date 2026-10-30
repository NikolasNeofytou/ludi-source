# Spike — one WhatsApp template message through the Meta Cloud API

> P2 of [plans/owner-ping.md](../plans/owner-ping.md). The WhatsApp leg
> of the owner ping depends on Meta onboarding the codebase cannot do —
> a Business Portfolio, a WhatsApp Business Account, a dedicated number,
> a display name, three approved templates, a permanent token — and on
> Meta's per-message economics for Cyprus. The spike is the first real
> message: `curl` from the founder's laptop to the founder's own phone.
> Budget ≤ 1 hour of build time; the queue before it is Meta's.

## Verdict: **not yet run** — waits on P0 (founder, Meta dashboard)

## PASS means

1. A `ludi_booking_confirmed` template with six body parameters and one
   URL button is **approved** (utility category, language `el`).
2. `POST https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages`
   with the permanent System User token returns `{ messages: [{ id }] }`.
3. The message lands on the founder's phone in Greek, with the English
   paragraph under it, and the button opens
   `https://ludi-admin.vercel.app/calendar?view=day&day=2026-09-17`.
4. Recorded here: the sender number, template approval time, delivery
   latency, and the per-message price Meta's dashboard shows for the
   recipient's country.

## FAIL means (any one)

- The number cannot be registered — it is already on the consumer or
  Business app and the founder does not want to move it.
- The template is rejected twice.
- Meta demands business verification before the first message and the
  verification queue is longer than the version's calendar.

On FAIL the version ships email only and WhatsApp gets its own plan with
the reason written here. The founder's "must" stands; the calendar does
not wait on a queue nobody controls.

## The call

```bash
curl -s -X POST "https://graph.facebook.com/v21.0/$WHATSAPP_PHONE_NUMBER_ID/messages" -H "Authorization: Bearer $WHATSAPP_TOKEN" -H "Content-Type: application/json" -d '{"messaging_product":"whatsapp","to":"357XXXXXXXX","type":"template","template":{"name":"ludi_booking_confirmed","language":{"code":"el"},"components":[{"type":"body","parameters":[{"type":"text","text":"Campeone"},{"type":"text","text":"Πέμ 17 Σεπ"},{"type":"text","text":"20:00–21:00"},{"type":"text","text":"Court 1 · 5v5"},{"type":"text","text":"Ανδρέας Κ."},{"type":"text","text":"NIC-2026-0031"}]},{"type":"button","sub_type":"url","index":"0","parameters":[{"type":"text","text":"2026-09-17"}]}]}}'
```

## What to record after the run

| Fact | Value |
|---|---|
| Sender number | |
| Template submitted → approved | |
| API call → phone buzz | |
| Price per utility message (Cyprus) | |
| Business verification asked? | |
| Message id | |
