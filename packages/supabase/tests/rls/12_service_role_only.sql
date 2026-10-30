-- 12_service_role_only.sql — RLS on tables with NO policies attached.
-- These tables are reachable only by service role (Edge Functions). RLS is
-- enabled with zero policies → every client-side read/write is blocked.
-- Regression guard: if anyone accidentally adds a policy, this fails loudly.
BEGIN;
SELECT plan(6);

-- 1. authenticated SELECT on stripe_events returns nothing
SELECT public.set_test_user('00000000-0000-4000-8000-0000000000a1'::uuid);
SELECT is(
  (SELECT count(*)::int FROM public.stripe_events),
  0,
  'stripe_events: even admin client sees nothing (no SELECT policy)'
);

-- 2. authenticated INSERT on stripe_events denied
SELECT throws_ok(
  $$INSERT INTO public.stripe_events (event_id, event_type, response_code)
    VALUES ('evt_rls_test', 'payment_intent.succeeded', 200)$$,
  '42501',
  NULL,
  'stripe_events: client INSERT denied'
);

-- 3. authenticated SELECT on idempotency_keys returns nothing
SELECT is(
  (SELECT count(*)::int FROM public.idempotency_keys),
  0,
  'idempotency_keys: even admin client sees nothing (no SELECT policy)'
);

-- 4. authenticated INSERT on idempotency_keys denied
SELECT throws_ok(
  $$INSERT INTO public.idempotency_keys (key, user_id, request_hash, response_status, response_body)
    VALUES ('rls-test-key', '00000000-0000-4000-8000-0000000000a1'::uuid,
            'sha256:0000', 200, '{}'::jsonb)$$,
  '42501',
  NULL,
  'idempotency_keys: client INSERT denied'
);

-- 5. anon SELECT on stripe_events empty (defence in depth — anon has no GRANT
--    either, but if a policy ever appears we want to catch the regression).
SELECT public.set_test_anon();
SELECT is(
  (SELECT count(*)::int FROM public.stripe_events),
  0,
  'stripe_events: anon sees nothing'
);

-- 6. anon SELECT on idempotency_keys empty
SELECT is(
  (SELECT count(*)::int FROM public.idempotency_keys),
  0,
  'idempotency_keys: anon sees nothing'
);

SELECT * FROM finish();
ROLLBACK;
