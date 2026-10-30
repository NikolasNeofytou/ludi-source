// _shared/walk-in-phone.ts
// How create-walk-in-booking stores the phone the counter typed.
//
// Digits only, a leading 00 dropped — the shape it has always had, and
// what the roster renders as `+${phone}` and every tel: link dials. One
// addition (slice C of plans/owner-contacts.md, 2026-09-18): a bare
// 8-digit number starting 2 or 9 is a Cypriot landline or mobile typed
// without +357, the counter's usual way of writing one. Stored bare it
// became "+99123456" on screen — a dial link to a number that does not
// exist, on the page the counter uses to ring a no-show. So it gains its
// country code.
//
// Keep in step with normalize_phone_cy (20260918000002), which keys a
// venue_contact on the same rule: a walk-in and its contact must agree.
// Anything else is left as it was typed — this does not guess at a bare
// 10-digit number, and neither does the database.
export function normaliseWalkInPhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, '').replace(/^00/, '');
  if (!digits) return null;
  return /^[29]\d{7}$/.test(digits) ? `357${digits}` : digits;
}
