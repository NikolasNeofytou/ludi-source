-- Teardown for the community-v3 demo fixtures (scripts/… , 2026-09-02).
-- Every demo row is coded V3-DEMO-*; this removes the whole set.
BEGIN;
DELETE FROM public.booking_participants
 WHERE booking_id IN (SELECT id FROM public.bookings WHERE code LIKE 'V3-DEMO-%');
DELETE FROM public.bookings WHERE code LIKE 'V3-DEMO-%';
COMMIT;
