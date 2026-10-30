-- 20260902000001_fixture_roster_depth.sql
-- The roster gains a person (launch prep, fixture screen).
--
-- Before this, `v_fixture_roster` answered "who has a seat" — a first name
-- and a dot. On the screen that decides whether a match is worth turning up
-- to, that is not enough: the organiser cannot tell a keeper from someone
-- who ticked keeper to get in, and a teammate cannot tell whether the squad
-- is their level. The football facts a player self-declares for their card
-- are exactly the facts a teammate needs, so the roster carries them.
--
-- Appended, never reordered: `CREATE OR REPLACE VIEW` requires the existing
-- columns keep their names, types and positions, and appending this way
-- preserves the grants from 20260824000001 rather than dropping and
-- re-granting.
--
-- ── What is added, and what deliberately is not ──────────────────────────
--   skill_level, positions, preferred_foot
--       Self-declared, already published to the player's own card
--       (ADR-0012). Football facts, no identifying power on their own.
--   played_with_you
--       Completed fixtures where BOTH the viewer and this participant were
--       'in'. Symmetric by construction — it counts only matches the viewer
--       themselves stood in, so it tells them nothing about a stranger's
--       history they were not part of. This is what keeps it clear of
--       `my_record()`'s deferred decision (community_v2, §2): that one is
--       about publishing ONE player's record to others; this is a shared
--       fact about the two of them. NULL for the viewer's own row.
--
--   NOT added: height_cm, age_band. Both are flagged quasi-identifying in
--   20260530000001 and neither answers a question a teammate has.
--   NOT added: phone, email, stripe ids, role — excluded by construction,
--   as the view's original comment requires and 13_booking_participants.sql
--   asserts.
--
-- RLS is unchanged. The caller predicate below is the same one the view has
-- carried since 20260824000001: you see this roster only if you organise the
-- fixture, stand on it, or are an admin. Nothing here widens who can read —
-- only what the people already inside can see about each other.

CREATE OR REPLACE VIEW public.v_fixture_roster
WITH (security_invoker = off) AS
  SELECT
    bp.id                       AS participant_id,
    bp.booking_id,
    bp.user_id,
    bp.slot_kind,
    bp.status,
    bp.joined_at,
    bp.left_at,
    u.first_name,
    u.handle,
    (bp.user_id = b.user_id)    AS is_organiser,
    (bp.user_id = auth.uid())   AS is_you,
    -- C2 W6: a split roster shows who has actually paid. Meaningless (and
    -- always false) on free fixtures; partially_refunded still counts as
    -- paid - the policy took some back, the seat was bought.
    EXISTS (SELECT 1 FROM public.payments pay
             WHERE pay.participant_id = bp.id
               AND pay.kind = 'share'
               AND pay.status IN ('succeeded','partially_refunded'))
                                AS share_paid,
    u.skill_level,
    u.positions,
    u.preferred_foot,
    CASE
      WHEN bp.user_id = auth.uid() THEN NULL
      ELSE (
        SELECT count(*)::int
          FROM public.booking_participants mine
          JOIN public.booking_participants theirs
            ON theirs.booking_id = mine.booking_id
          JOIN public.bookings shared
            ON shared.id = mine.booking_id
         WHERE mine.user_id   = auth.uid()
           AND mine.status    = 'in'
           AND theirs.user_id = bp.user_id
           AND theirs.status  = 'in'
           AND shared.state   = 'completed'
      )
    END                         AS played_with_you
  FROM public.booking_participants bp
  JOIN public.bookings b ON b.id = bp.booking_id
  JOIN public.users    u ON u.id = bp.user_id
 WHERE b.user_id = auth.uid()
    OR public.is_participant_of_booking(bp.booking_id)
    OR public.is_admin();

COMMENT ON VIEW public.v_fixture_roster IS
  'Who is on a fixture, readable by the people on it. Name, handle and the '
  'self-declared football facts from the player card (skill, positions, '
  'foot) plus how many completed fixtures the viewer has shared with them - '
  'no phone, email, stripe id, role, height or age band, excluded by '
  'construction. The caller predicate is what makes this different from '
  'ADR-0013''s card view: a card is meant to be public, a roster is not.';
