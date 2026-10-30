// _shared/secrets.ts
// Comparing a presented secret (a cron header, a webhook verify token)
// with the configured one. `!==` returns at the first differing byte, so
// its timing says how much of a guess was right; this walks the whole
// length every time and folds a length difference into the result.

export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** A request header carrying a shared secret, checked in constant time.
 *  A missing header never matches. */
export function secretMatches(presented: string | null, secret: string): boolean {
  return presented !== null && timingSafeEqual(presented, secret);
}
