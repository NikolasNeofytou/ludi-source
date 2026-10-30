-- Member numbers (profile hub). Every user gets a permanent, unique
-- member number in signup order, starting at 1 — the founder is member #1.
-- Existing rows are backfilled by created_at (ties broken by id); new
-- rows take the next value via the column default, so handle_new_user
-- needs no change. The number survives GDPR anonymisation: it is not
-- PII, and the anonymised row keeps its slot so numbers are never reused.

ALTER TABLE public.users ADD COLUMN member_no integer;

UPDATE public.users u
SET member_no = numbered.n
FROM (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS n
  FROM public.users
) AS numbered
WHERE u.id = numbered.id;

CREATE SEQUENCE public.users_member_no_seq AS integer
  OWNED BY public.users.member_no;

-- Position the sequence just past the backfill; is_called=false means the
-- next nextval() returns exactly this value. Empty table → next is 1.
SELECT setval(
  'public.users_member_no_seq',
  COALESCE((SELECT max(member_no) FROM public.users), 0) + 1,
  FALSE
);

ALTER TABLE public.users
  ALTER COLUMN member_no SET DEFAULT nextval('public.users_member_no_seq'),
  ALTER COLUMN member_no SET NOT NULL;

ALTER TABLE public.users ADD CONSTRAINT users_member_no_key UNIQUE (member_no);

COMMENT ON COLUMN public.users.member_no IS
  'Permanent member number in signup order, starting at 1 (founder = 1). Unique, never reused, kept through anonymisation.';
