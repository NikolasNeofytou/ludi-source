// _tests/payment-intent-succeeded.test.ts
// The single-payer confirm trusts our payments row, not PI metadata, and
// connected-account events never reach it.

import { assertEquals } from 'std/assert/mod.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import {
  paymentIntentSucceeded,
  singlePayerMismatch,
} from '../_shared/webhook-handlers/payment-intent-succeeded.ts';

const BOOKING = '00000000-0000-4000-8000-0000000000f1';
const ROW = { booking_id: BOOKING, amount_cents: 6000, kind: 'booking' };

Deno.test('singlePayerMismatch: a row that agrees is no mismatch', () => {
  assertEquals(singlePayerMismatch({ amount: 6000, currency: 'eur' }, ROW, BOOKING), null);
});

Deno.test('singlePayerMismatch: each disagreement has its own reason', () => {
  assertEquals(singlePayerMismatch({ amount: 6000, currency: 'eur' }, null, BOOKING), 'no-payment-row');
  assertEquals(
    singlePayerMismatch({ amount: 6000, currency: 'eur' }, { ...ROW, booking_id: 'other' }, BOOKING),
    'booking-mismatch',
  );
  assertEquals(singlePayerMismatch({ amount: 100, currency: 'eur' }, ROW, BOOKING), 'amount-mismatch');
  assertEquals(singlePayerMismatch({ amount: 6000, currency: 'usd' }, ROW, BOOKING), 'currency-mismatch');
  assertEquals(
    singlePayerMismatch({ amount: 6000, currency: 'eur' }, { ...ROW, kind: 'walk_in' }, BOOKING),
    'unexpected-kind:walk_in',
  );
});

// A stand-in for the few PostgREST calls the handler makes. Reads return
// the canned row per table; any write is recorded so a test can assert
// that nothing was flipped.
function fakeSupa(rows: Record<string, unknown>, writes: string[]): SupabaseClient {
  const chain = (table: string, op: string) => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'is']) c[m] = () => c;
    c.maybeSingle = () => Promise.resolve({ data: rows[table] ?? null, error: null });
    c.then = (resolve: (v: unknown) => void) => {
      writes.push(`${op}:${table}`);
      resolve({ data: null, error: null });
    };
    return c;
  };
  return {
    from: (table: string) => ({
      select: () => chain(table, 'select'),
      update: () => {
        writes.push(`update:${table}`);
        return chain(table, 'update');
      },
    }),
    rpc: () => {
      writes.push('rpc');
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as SupabaseClient;
}

function event(pi: Partial<Stripe.PaymentIntent>, account?: string): Stripe.Event {
  return {
    id: 'evt_test',
    type: 'payment_intent.succeeded',
    created: 1_790_000_000,
    account,
    data: { object: { id: 'pi_test', metadata: { booking_id: BOOKING }, ...pi } },
  } as unknown as Stripe.Event;
}

const noStripe = {} as Stripe;

Deno.test('handler: an event from a connected account is ignored untouched', async () => {
  const writes: string[] = [];
  const result = await paymentIntentSucceeded({
    supa: fakeSupa({}, writes),
    stripe: noStripe,
    event: event({ amount: 6000, currency: 'eur' }, 'acct_connected'),
  });
  assertEquals(result, { status: 200, notes: 'connected-account-ignored' });
  assertEquals(writes, []);
});

Deno.test('handler: a pending booking is not confirmed by a PI that disagrees with its row', async () => {
  const writes: string[] = [];
  const result = await paymentIntentSucceeded({
    supa: fakeSupa(
      {
        bookings: { id: BOOKING, state: 'pending', total_cents: 6000 },
        payments: { id: 'pay_1', status: 'requires_payment_method', ...ROW },
      },
      writes,
    ),
    stripe: noStripe,
    event: event({ amount: 1, currency: 'eur' }),
  });
  assertEquals(result, { status: 409, notes: 'payment-mismatch:amount-mismatch' });
  assertEquals(writes.filter((w) => w.startsWith('update')), []);
});

Deno.test('handler: a PI with no payments row of ours confirms nothing', async () => {
  const writes: string[] = [];
  const result = await paymentIntentSucceeded({
    supa: fakeSupa({ bookings: { id: BOOKING, state: 'pending', total_cents: 6000 } }, writes),
    stripe: noStripe,
    event: event({ amount: 6000, currency: 'eur' }),
  });
  assertEquals(result, { status: 409, notes: 'payment-mismatch:no-payment-row' });
  assertEquals(writes.filter((w) => w.startsWith('update')), []);
});
