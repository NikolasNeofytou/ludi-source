-- 20260917000001_booking_notes.sql
-- A comment on a booking, for the venue's own eyes (plans/calendar-manage.md).
-- "Pays cash", "bringing their own ball", "the 7v7 lot, call if late" — the
-- things an owner writes in the margin of the paper sheet.
--
-- Its own table, not a column on bookings: players read their own bookings
-- rows, and a note written about them is not theirs to read. One note per
-- booking; clearing it deletes the row.

CREATE TABLE public.booking_notes (
  booking_id  uuid PRIMARY KEY REFERENCES public.bookings (id) ON DELETE CASCADE,
  note        text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 280),
  updated_by  uuid DEFAULT auth.uid() REFERENCES public.users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.booking_notes IS
  'Owner/manager/admin comment on a booking. Never visible to the player: '
  'kept off bookings on purpose, since players can read their own rows.';

CREATE TRIGGER tg_booking_notes_updated_at
  BEFORE UPDATE ON public.booking_notes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.booking_notes ENABLE ROW LEVEL SECURITY;

-- The venue's owners and managers, and admins. The booking lookup runs under
-- the caller's own bookings policies, which already let an owner read their
-- venue's bookings.
CREATE POLICY booking_notes_owner_or_admin ON public.booking_notes
  FOR ALL TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.bookings AS b
      WHERE b.id = booking_id AND public.is_venue_owner_of_pitch(b.pitch_id)
    )
  )
  WITH CHECK (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.bookings AS b
      WHERE b.id = booking_id AND public.is_venue_owner_of_pitch(b.pitch_id)
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_notes TO authenticated;
REVOKE ALL ON public.booking_notes FROM anon;
