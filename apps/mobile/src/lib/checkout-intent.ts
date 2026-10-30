// The Book tap, handed to the checkout screen in memory (audit 2026-10-19).
//
// Checkout creates the booking — a held slot and a PaymentIntent — the
// moment it mounts, from whatever its URL says. +native-intent.tsx already
// keeps links out of it; this is the second lock. The pitch screen's Book
// button arms one checkout for one slot, and a checkout that finds nothing
// armed for its own slot sends the player to the pitch instead of to the
// Payment Sheet. Module memory on purpose: nothing a URL, a notification or
// another app can write.

let armed: string | null = null;

function keyFor(pitchId: string, startsAt: string): string {
  return `${pitchId}|${startsAt}`;
}

export function armCheckout(pitchId: string, startsAt: string): void {
  armed = keyFor(pitchId, startsAt);
}

/** True once, for the slot the Book tap armed; false for anything else. */
export function takeCheckout(pitchId: string, startsAt: string): boolean {
  const ok = armed === keyFor(pitchId, startsAt);
  armed = null;
  return ok;
}
