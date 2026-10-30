-- 23_venue_payouts.sql — venue_payouts RLS (migration 20260831000002)
--
-- The table is a webhook-written mirror of Stripe payouts. Under test:
-- owners read their own venue's payouts and nothing else; strangers see
-- nothing; no authenticated role can write (service role only).
--
-- Fixture recap (_bootstrap.sql): a2 owns venue_a (b1), a3 manages it,
-- a5 is a stranger; venue_b (b2) is owned by nobody.
BEGIN;
SELECT plan(6);

INSERT INTO public.venue_payouts
  (stripe_payout_id, venue_id, amount_cents, status, arrival_date)
VALUES
  ('po_test_owned', '00000000-0000-4000-8000-0000000000b1', 12000, 'paid',
   '2031-07-14'),
  ('po_test_other', '00000000-0000-4000-8000-0000000000b2', 9000, 'failed',
   '2031-07-14');

-- 1. owner sees exactly their venue's payout
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT is(
  (SELECT array_agg(stripe_payout_id) FROM public.venue_payouts),
  ARRAY['po_test_owned'],
  'venue_payouts: owner sees only their venue''s payouts'
);

-- 2. a manager sees no payouts. Expectation inverted by ADR-0041
--    (20260917000006) — it used to read "manager counts as venue staff".
--    The Stripe Express dashboard behind this mirror was already
--    owner-only; this closes the half that was reachable without it.
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a3'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.venue_payouts),
  0,
  'venue_payouts: a manager sees no payouts (ADR-0041)'
);

-- 3. a stranger sees nothing
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a5'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.venue_payouts),
  0,
  'venue_payouts: stranger sees no payouts'
);

-- 4. admin sees both venues
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.venue_payouts),
  2,
  'venue_payouts: admin sees every venue''s payouts'
);

-- 5. an owner cannot insert a payout for their own venue
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a2'::uuid);
SELECT throws_ok(
  $$ INSERT INTO public.venue_payouts
       (stripe_payout_id, venue_id, amount_cents, status)
     VALUES ('po_test_forged', '00000000-0000-4000-8000-0000000000b1',
             1, 'paid') $$,
  '42501',
  NULL,
  'venue_payouts: owner cannot insert (webhook-only writes)'
);

-- 6. nor update one — with no UPDATE policy the row set is empty, so the
-- write silently touches nothing; assert the value survived.
UPDATE public.venue_payouts SET amount_cents = 99999
 WHERE stripe_payout_id = 'po_test_owned';
SELECT is(
  (SELECT amount_cents FROM public.venue_payouts
    WHERE stripe_payout_id = 'po_test_owned'),
  12000,
  'venue_payouts: owner update matches zero rows (webhook-only writes)'
);

SELECT * FROM finish();
ROLLBACK;
