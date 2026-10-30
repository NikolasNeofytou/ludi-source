-- ────────────────────────────────────────────────────────────────────
-- Who took the €60
-- ────────────────────────────────────────────────────────────────────
-- Slice E of docs/plans/venue-staff.md. No new table and no new column
-- on bookings: the database has known who took every walk-in since
-- 20260829000001, because create-walk-in-booking writes the ACTING staff
-- member into bookings.user_id (that migration's own comment: "user_id
-- is the acting owner — showing THEIR name would be wrong"), and
-- booking_series materialises its occurrences with user_id =
-- series.created_by. Cancels have written a walk_in_cancelled
-- admin_actions row with the actor since the same day.
--
-- None of it reached an owner. The Bookings page embeds users(...) on
-- the booking, but users RLS answers an owner with NULL for anyone but
-- himself — so the name was fetched and thrown away on every row.
--
-- It was also not worth reaching an owner until yesterday. With no way to
-- give staff a login, the counter used the owner's session and user_id
-- was a constant: every walk-in "taken by the owner". Slice C
-- (20260917000005) lets an owner give each person their own login, so
-- the column now says something.
--
-- So this is the whole slice at the database end: nine columns appended
-- to v_venue_booking_roster, the definer-rights view the Bookings and
-- Today pages already read names through. CREATE OR REPLACE VIEW may
-- only append, so they go after `origin`; everything above them is
-- 20260829000001 verbatim.
--
-- Who may read them is unchanged: the view's own predicate,
-- is_venue_owner_of_pitch(), which is owner OR manager. That is
-- deliberate and it is ADR-0041's line — who took a booking at this
-- venue is the day, not the money, and "ask Maria, she booked it" is a
-- shift-handover sentence.
--
-- The one column-level exception is the staff member's EMAIL, the
-- fallback for a nameless account: it is filled only when the caller is
-- the venue's owner (or an admin), which is exactly who can already read
-- it through venue_people(). A manager sees a colleague's name or
-- nothing. No staff phone is exposed at all.

CREATE OR REPLACE VIEW public.v_venue_booking_roster
WITH (security_invoker = off) AS
  SELECT
    b.id                                  AS booking_id,
    b.code,
    v.id                                  AS venue_id,
    p.id                                  AS pitch_id,
    p.name                                AS pitch_name,
    b.starts_at,
    b.ends_at,
    b.state,
    b.total_cents,
    CASE WHEN b.origin = 'walk_in' THEN b.walk_in_name
         ELSE u.first_name END            AS first_name,
    CASE WHEN b.origin = 'walk_in' THEN NULL
         ELSE u.last_name END             AS last_name,
    (b.gk_slots + b.outfield_slots)::int  AS party_size,
    (SELECT count(*) FROM public.booking_participants bp
      WHERE bp.booking_id = b.id AND bp.status = 'in')::int
                                          AS confirmed_count,
    CASE
      WHEN b.origin = 'walk_in' THEN b.walk_in_phone
      WHEN b.state IN ('paid', 'confirmed')
       AND now() >= b.starts_at - interval '24 hours'
       AND now() <  b.ends_at
      THEN au.phone
    END                                   AS organiser_phone,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
                'addon_code', a.addon_code,
                'quantity',   a.quantity)
              ORDER BY a.addon_code)
         FROM public.booking_addons a
        WHERE a.booking_id = b.id),
      '[]'::jsonb)                        AS addons,
    b.origin,
    -- ── appended by 20260918000001 (slice E) ─────────────────────────
    -- Who put this on the book. Walk-ins and standing-series occurrences
    -- only: for an app booking user_id is the PLAYER, and "taken by the
    -- player" is not a fact anyone needs spelled out.
    CASE WHEN b.origin = 'walk_in' THEN b.user_id END
                                          AS taken_by_user_id,
    CASE WHEN b.origin = 'walk_in'
         THEN NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '')
    END                                   AS taken_by_name,
    -- The fallback for a nameless account — and slice C invites staff with
    -- the name optional, so there will be plenty. OWNER-OR-ADMIN only, per
    -- row: an owner already reads his staff's addresses through
    -- venue_people(), and a manager does not get a colleague's email from
    -- this or anywhere else (ADR-0041). Without it the owner's answer to
    -- "who took the €60" would be "a colleague", which answers nothing.
    CASE WHEN b.origin = 'walk_in'
          AND (public.has_venue_role(v.id, 'owner') OR public.is_admin())
         THEN au.email::text
    END                                   AS taken_by_email,
    -- Ludi took it: the founder at the counter during a handover, or a
    -- standing series set up at enrolment. Said as "Ludi" rather than as
    -- a person, because that is who the owner dealt with.
    (b.origin = 'walk_in' AND u.role = 'admin')
                                          AS taken_by_ludi,
    -- Who took it off again. From the walk_in_cancelled audit row that
    -- create-walk-in-booking writes; NULL where no such row exists, which
    -- is honest — not every path that ends a booking writes one, and a
    -- blank beats a guess. Same name → email → Ludi ladder as above.
    cx.admin_user_id                      AS cancelled_by_user_id,
    NULLIF(TRIM(CONCAT_WS(' ', cu.first_name, cu.last_name)), '')
                                          AS cancelled_by_name,
    CASE WHEN public.has_venue_role(v.id, 'owner') OR public.is_admin()
         THEN cau.email::text
    END                                   AS cancelled_by_email,
    COALESCE(cu.role = 'admin', FALSE)    AS cancelled_by_ludi,
    cx.created_at                         AS cancelled_at
  FROM public.bookings b
  JOIN public.pitches p  ON p.id  = b.pitch_id
  JOIN public.venues  v  ON v.id  = p.venue_id
  JOIN public.users   u  ON u.id  = b.user_id
  LEFT JOIN auth.users au ON au.id = b.user_id
  -- The latest cancel only. admin_actions_target_idx (target_type,
  -- target_id) keeps this an index probe per row.
  LEFT JOIN LATERAL (
    SELECT a.admin_user_id, a.created_at
      FROM public.admin_actions a
     WHERE a.target_type = 'booking'
       AND a.target_id = b.id
       AND a.action_type = 'walk_in_cancelled'
     ORDER BY a.created_at DESC
     LIMIT 1
  ) cx ON b.origin = 'walk_in'
  LEFT JOIN public.users cu ON cu.id = cx.admin_user_id
  LEFT JOIN auth.users cau ON cau.id = cx.admin_user_id
 WHERE public.is_venue_owner_of_pitch(b.pitch_id)
    OR public.is_admin();

COMMENT ON VIEW public.v_venue_booking_roster IS
  'The owner''s booking sheet (M6 #41g/#41j, ADR-0023). Organiser name + '
  'code + party size + addons per booking on the caller''s pitches; app '
  'bookings expose the phone only within 24h-before-kickoff → slot end, '
  'walk-ins carry the owner-entered name/phone un-windowed. Since slice E '
  '(20260918000001) also who took a walk-in and who cancelled it: name for '
  'anyone with venue access, the staff email only for the venue''s owner or '
  'an admin, and a flag when it was Ludi. Never exposes a player email, '
  'notes, platform fee, profile attributes, or any staff phone.';
