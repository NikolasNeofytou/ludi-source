-- 10_payments.sql — RLS for public.payments
-- Policy under test:
--   payments_select_self_or_admin — visibility tied to parent booking ownership
-- Plus deliberate write absence — service role only.
BEGIN;
SELECT plan(5);

-- 1. booking owner sees the payment
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.payments
   WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  1,
  'payments_select_self_or_admin: booking owner sees own payment'
);

-- 2. unrelated user sees no payments
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a3'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.payments),
  0,
  'payments_select_self_or_admin: unrelated user sees no payments'
);

-- 3. admin sees the payment
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.payments
   WHERE booking_id = '00000000-0000-4000-8000-0000000000f1'::uuid),
  1,
  'payments_select_self_or_admin: admin sees payment'
);

-- 4. anon sees nothing
SELECT public.set_test_anon();
SELECT is(
  (SELECT count(*)::int FROM public.payments),
  0,
  'payments_select_self_or_admin: anon sees no payments'
);

-- 5. authenticated INSERT denied (no INSERT policy)
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a4'::uuid);
SELECT throws_ok(
  $$INSERT INTO public.payments (
      booking_id, stripe_payment_intent_id,
      amount_cents, application_fee_cents, status
    ) VALUES (
      '00000000-0000-4000-8000-0000000000f1'::uuid,
      'pi_rls_attempt', 4000, 400, 'succeeded'
    )$$,
  '42501',
  NULL,
  'payments: client INSERT denied (no policy)'
);

SELECT * FROM finish();
ROLLBACK;
