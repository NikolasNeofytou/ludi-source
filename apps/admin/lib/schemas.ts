// Zod schemas for the admin's write surface (M6 #41e).
//
// ADR-0006: "Zod for every data boundary — user input (forms, URL params)",
// and "Zod first, infer the type". The Edge Functions have done this since
// M1; this is the first time the admin has had any input to validate.
// Pinned to the same zod 3.23.8 the functions' import map uses.
//
// The split between owner and admin fields is not cosmetic. It is one of
// three layers that has to agree:
//
//   1. the form does not render an admin-only field to an owner;
//   2. the server action does not READ one from an owner's submission
//      (below — an owner's parse simply has no such keys);
//   3. `tg_venues_block_privileged_columns` /
//      `tg_pitches_block_privileged_columns` reject the write at the
//      database if it gets there anyway.
//
// Layer 3 is the one that matters; 1 and 2 exist so a legitimate owner
// never sees a raw `insufficient_privilege` error.

import { z } from 'zod';

// An optional free-text field that an HTML form submits as '' when empty.
// Stored as NULL rather than an empty string so `contact_email IS NULL`
// keeps meaning "not provided".
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v));

// NOT `z.coerce.number()`. An HTML form submits an untouched number input
// as '', and `z.coerce.number('')` is 0 — which passes a -90..90 check and
// would silently move a venue to POINT(0 0) in the Gulf of Guinea. Caught
// exactly that way: the edit form rendered blank coordinates (PostgREST
// serialises geography as hex EWKB) and saving would have relocated the
// venue. The blank render is fixed by the lat/lng computed columns in
// migration 20260822000004; this stops the coercion being dangerous even
// if a field is ever empty again.
// A comma decimal ('34,9171') is read as a point: a Greek-locale keypad
// types one, and the map picker only tidies it on blur — Enter inside the
// field submits the raw text.
const requiredNumber = (min: number, max: number, label: string) =>
  z.preprocess(
    (v) => {
      if (typeof v !== 'string') return v;
      const t = v.trim();
      return t === '' ? undefined : t.replace(',', '.');
    },
    z.coerce
      .number({ required_error: `${label} is required` })
      .min(min, `${label} is out of range`)
      .max(max, `${label} is out of range`),
  );

export const CANCELLATION_POLICIES = ['standard', 'strict', 'flex'] as const;
export const PITCH_TYPES = ['5-a-side', '7-a-side', '11-a-side'] as const;
export const PITCH_SURFACES = ['turf', 'grass', 'indoor'] as const;

// ── Venue ────────────────────────────────────────────────────────────

// The hidden `id` an edit form posts back. Parsed rather than trusted: a
// mangled one otherwise reaches Postgres and comes back as a raw
// "invalid input syntax for type uuid". Pitches use it too.
export const RowId = z.string().uuid();

// Everything a venue owner may write, matching the column guard exactly.
export const VenueOwnerFields = z.object({
  name: z.string().trim().min(2, 'Name is too short').max(120),
  address: z.string().trim().min(4, 'Address is too short').max(240),
  contact_phone: optionalText(32),
  contact_email: z
    .union([z.literal(''), z.string().trim().email('Not a valid email').max(160)])
    .transform((v) => (v === '' ? null : v)),
  // Split into two inputs because asking anyone to type WKT is unkind.
  // Recombined into `SRID=4326;POINT(lng lat)` by toCoords() — note the
  // order: PostGIS is (longitude, latitude), which is the reverse of how
  // every mapping UI shows it.
  lat: requiredNumber(-90, 90, 'Latitude'),
  lng: requiredNumber(-180, 180, 'Longitude'),
});

// Commercial and platform terms. Admin only — see the three layers above.
export const VenueAdminFields = z.object({
  city_id: z.string().uuid('Pick a city'),
  take_rate_bps: z.coerce
    .number()
    .int()
    .min(0)
    .max(5000, 'Take rate is capped at 50%'),
  cancellation_policy: z.enum(CANCELLATION_POLICIES),
  // The venue's own link, ludi.football/v/<slug> (plans/reach.md R1).
  // Ludi's to set; empty clears it. Mirrors venues_slug_shape.
  slug: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^[a-z0-9][a-z0-9-]{2,39}$/.test(v), {
      message: 'Lowercase letters, digits and dashes, 3–40 characters',
    }),
  is_active: z.coerce.boolean(),
});

export const VenueCreate = VenueOwnerFields.merge(VenueAdminFields);
export const VenueOwnerUpdate = VenueOwnerFields;
export const VenueAdminUpdate = VenueOwnerFields.merge(VenueAdminFields);

export function toCoords(lng: number, lat: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`;
}

// ── Pitch ────────────────────────────────────────────────────────────

export const PitchFields = z.object({
  venue_id: z.string().uuid('Pick a venue'),
  name: z.string().trim().min(2, 'Name is too short').max(120),
  type: z.enum(PITCH_TYPES),
  surface: z.enum(PITCH_SURFACES),
  // The form asks for euros because that is what an owner knows; the
  // column is cents because money is never a float. Rounded rather than
  // truncated so 45.005 doesn't quietly become €45.00.
  price_per_hour_eur: z.coerce
    .number()
    .positive('Price must be more than zero')
    .max(10000),
  // Free text, comma-separated. There is no controlled vocabulary for
  // amenities in the schema (`text[]`) and the seed uses display strings
  // like "Lights" and "Showers" — inventing an enum here would be a
  // data-model decision, not a form decision.
  amenities: z
    .string()
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().max(40)).max(20)),
});

// An edit never reads a venue from the form. The pitch's venue is whatever
// the database says it is — that is what access is checked against — and
// moving a pitch between venues is not an edit (the column guard refuses it).
export const PitchUpdate = PitchFields.omit({ venue_id: true });

export function toCents(eur: number): number {
  return Math.round(eur * 100);
}

export type FieldErrors = Record<string, string[]>;

export type FormState =
  | { status: 'idle' }
  | {
      status: 'error';
      message: string;
      fieldErrors?: FieldErrors;
      // An escape hatch out of the error: the schedule editor's collision
      // refusal (#41f) uses it to link straight to the blocking bookings
      // instead of leaving "cancel them first" as a dead end (#41k).
      link?: { href: string; label: string };
    }
  | { status: 'success'; message: string };

// ── Schedule (M6 #41f) ───────────────────────────────────────────────

export const SLOT_DURATIONS = [30, 60, 90, 120] as const;

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

// `time` columns come back as 'HH:MM:SS'; <input type="time"> wants 'HH:MM'.
const hhmm = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Use HH:MM')
  .transform((v) => v.slice(0, 5));

// A CLOSING time of 00:00 means the end of the day. <input type="time">
// cannot produce 24:00, and read literally 00:00 is before every opening
// time — so a pitch that shuts at midnight could not be saved at all.
// Normalised before the closes-after-opens check, and stored as 24:00:
// Postgres accepts `time '24:00'`, and `date + time '24:00'` is the next
// midnight, which is exactly what get_available_slots and the collision
// checks need. The editor shows a stored 24:00 back as 00:00.
const closesHhmm = hhmm.transform((v) => (v === '00:00' ? '24:00' : v));

const slotDuration = z.coerce
  .number()
  .int()
  .refine(
    (n) => (SLOT_DURATIONS as readonly number[]).includes(n),
    'Slot length must be 30, 60, 90 or 120 minutes',
  );

// An optional form field arrives as '' when left empty, or not at all when
// it was never rendered (the special-hours fields while "Closed" is picked).
const blankToUndefined = (v: unknown) => (v === '' ? undefined : v);

const window = z
  .object({
    opens_at: hhmm,
    closes_at: closesHhmm,
    slot_duration_minutes: slotDuration,
  })
  // Mirrors the table's own CHECK. Caught here so the owner gets a sentence
  // instead of a constraint-violation code — and because a window that ends
  // before it starts is the single easiest thing to mistype.
  .refine((v) => v.closes_at > v.opens_at, {
    message: 'Closing time must be after opening time',
    path: ['closes_at'],
  });

export const ScheduleWindowCreate = z
  .object({
    pitch_id: z.string().uuid(),
    day_of_week: z.coerce.number().int().min(0).max(6),
  })
  .and(window);

// No day_of_week: editing a window changes its hours, never its day. The
// action reads the day from the stored row, so a tampered form cannot move
// a window to another day past the collision check for the old one.
export const ScheduleWindowUpdate = z
  .object({
    id: z.string().uuid(),
    pitch_id: z.string().uuid(),
  })
  .and(window);

// Remove buttons post only these two. Validated rather than read raw so a
// junk id is refused before it reaches a query.
export const ScheduleRowRef = z.object({
  id: z.string().uuid(),
  pitch_id: z.string().uuid(),
});

// 'YYYY-MM-DD' → 0 (Sunday) … 6 (Saturday), matching pitch_schedules
// .day_of_week and Postgres EXTRACT(DOW). Calendar arithmetic on the key
// itself, so no timezone can shift it onto the neighbouring day.
export function dayOfWeekOfKey(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// The slot length an exception should default to: the pitch's own weekly
// slot length for that weekday, else the length its week mostly uses, else
// 60 (the table default). A 90-minute pitch given special hours on a
// Saturday should keep selling 90-minute slots unless the owner says not.
export function defaultSlotMinutes(
  windows: ReadonlyArray<{ day_of_week: number; slot_duration_minutes: number }>,
  dayOfWeek: number,
): number {
  const mostCommon = (ws: typeof windows): number | null => {
    const counts = new Map<number, number>();
    for (const w of ws) {
      counts.set(w.slot_duration_minutes, (counts.get(w.slot_duration_minutes) ?? 0) + 1);
    }
    let best: number | null = null;
    for (const [minutes, n] of counts) {
      if (best === null || n > (counts.get(best) ?? 0)) best = minutes;
    }
    return best;
  };
  return (
    mostCommon(windows.filter((w) => w.day_of_week === dayOfWeek)) ??
    mostCommon(windows) ??
    60
  );
}

export const OverrideCreate = z
  .object({
    pitch_id: z.string().uuid(),
    override_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
    is_closed: z
      .union([z.literal('true'), z.literal(''), z.undefined()])
      .transform((v) => v === 'true'),
    reason: optionalText(200),
    opens_at: z.preprocess(blankToUndefined, hhmm.optional()),
    closes_at: z.preprocess(blankToUndefined, closesHhmm.optional()),
    // Absent → the action picks the pitch's own weekly slot length for
    // that weekday, not a flat 60 (see defaultSlotMinutes).
    slot_duration_minutes: z.preprocess(blankToUndefined, slotDuration.optional()),
  })
  // A closure carries no hours; special hours must carry both, in order.
  // The table's CHECK says the same thing — this is so the message is a
  // sentence rather than `23514`.
  .superRefine((v, ctx) => {
    if (v.is_closed) return;
    if (!v.opens_at || !v.closes_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['opens_at'],
        message: 'Give opening and closing times, or mark the day closed',
      });
      return;
    }
    if (v.closes_at <= v.opens_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['closes_at'],
        message: 'Closing time must be after opening time',
      });
    }
  });

// ── Owner access (venue_owners) ──────────────────────────────────────

export const VENUE_OWNER_ROLES = ['owner', 'manager'] as const;

// The phone is the whole identifier — sign-in is phone-OTP, so the number
// the owner signs in with is the number the founder grants. Normalisation
// to digits happens in the database (admin_lookup_user_by_phone); this
// only refuses obvious non-numbers before a round trip.
export const OwnerGrant = z.object({
  venue_id: z.string().uuid(),
  phone: z
    .string()
    .trim()
    .min(8, 'That number looks too short')
    .max(32)
    .regex(/^[+0-9 ()-]+$/, 'Digits, spaces and + only'),
  owner_role: z.enum(VENUE_OWNER_ROLES),
});

export const OwnerRevoke = z.object({
  venue_id: z.string().uuid(),
  user_id: z.string().uuid(),
});

// ── Enrolment (plans/venue-enrol.md, ADR-0031) ───────────────────────

// Step 1 has no `is_active` field: the action forces it false, because the
// inactive venue IS the draft. Everything else is the admin create form.
export const EnrolVenue = VenueOwnerFields.merge(
  VenueAdminFields.omit({ is_active: true }),
);

// One row of the courts table. Amenities are optional here — the counter
// is not the moment to enumerate showers — and the venue comes from the URL,
// never from the rows. `count` expands a row into numbered courts ("Court"
// × 7 → Court 1 … Court 7); `made_of` names the leaves a composite row is
// made of (ADR-0032) — names, because the leaves may not exist yet when the
// form is posted, and the action resolves them after inserting the leaves.
export const CourtRow = PitchFields.omit({ venue_id: true, amenities: true }).extend({
  count: z.coerce.number().int().min(1, 'At least one').max(20, 'At most twenty').default(1),
  made_of: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().max(120)).max(8)),
});

// The leaf pitches a composite is made of (ADR-0032). Posted as repeated
// checkbox values; read with formData.getAll, never Object.fromEntries.
export const PitchComponents = z.array(RowId).max(8, 'A pitch is made of at most eight others');

export const EnrolCourts = z.object({
  venue_id: RowId,
  courts: z.array(CourtRow).min(1, 'Add at least one court').max(20),
});

const checkbox = z
  .union([z.literal('true'), z.literal('on'), z.literal(''), z.undefined()])
  .transform((v) => v === 'true' || v === 'on');

// A day in the hours grid: closed, or open with both times in order. The
// same `closesHhmm` rule as the editor — 00:00 as a closing time is midnight.
const dayHours = z
  .object({
    day_of_week: z.coerce.number().int().min(0).max(6),
    closed: checkbox,
    opens_at: z.preprocess(blankToUndefined, hhmm.optional()),
    closes_at: z.preprocess(blankToUndefined, closesHhmm.optional()),
  })
  .superRefine((v, ctx) => {
    if (v.closed) return;
    if (!v.opens_at || !v.closes_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['opens_at'],
        message: 'Give opening and closing times, or mark the day closed',
      });
      return;
    }
    if (v.closes_at <= v.opens_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['closes_at'],
        message: 'Closing time must be after opening time',
      });
    }
  });

export const EnrolHours = z
  .object({
    venue_id: RowId,
    slot_duration_minutes: slotDuration,
    days: z.array(dayHours).length(7),
  })
  .refine((v) => v.days.some((d) => !d.closed), {
    message: 'At least one day has to be open',
    path: ['days'],
  });

export const EnrolPublish = z.object({ venue_id: RowId });

// Enable a city for players from the Review page (plans/counter-follow-
// through.md). The venue is only for the redirect and the audit payload.
export const EnableCity = z.object({ venue_id: RowId, city_id: RowId });

// ── Standing bookings (plans/standing-bookings.md, ADR-0033) ─────────

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date');

export const SeriesCreate = z
  .object({
    venue_id: RowId,
    name: z.string().trim().min(1, 'Say who it is for').max(120),
    phone: optionalText(30),
    pitch_ids: z.array(RowId).min(1, 'Pick at least one court').max(20),
    weekdays: z
      .array(z.coerce.number().int().min(0).max(6))
      .min(1, 'Pick at least one day')
      .max(7),
    starts_time: hhmm,
    duration_minutes: z.coerce
      .number()
      .int()
      .min(30)
      .max(480)
      .refine((n) => n % 30 === 0, 'Whole half-hours only'),
    starts_on: dateKey,
    ends_on: z.preprocess(blankToUndefined, dateKey.optional()).transform((v) => v ?? null),
    // The contact picked in the booking form (plans/owner-contacts.md,
    // slice C). Absent from the /standing form and when a new name is
    // typed; formData.get() hands back null for a missing field, not ''.
    contact_id: z
      .preprocess((v) => (v === '' || v === null ? undefined : v), RowId.optional())
      .transform((v) => v ?? null),
  })
  .refine((v) => v.ends_on === null || v.ends_on >= v.starts_on, {
    message: 'The end must not be before the start',
    path: ['ends_on'],
  });

export const SeriesEnd = z.object({
  series_id: RowId,
  ends_on: z.preprocess(blankToUndefined, dateKey.optional()).transform((v) => v ?? null),
});

// ── Contacts (plans/owner-contacts.md, slice B) ─────────────────────
// The owner's own page onto his regulars. The database is the gate for
// every one of these (venue_contact_create / _update / _delete /
// venue_contacts_delete_all, 20260918000002); these only shape what the
// form sends. A contact needs a name or a number — the same rule as the
// table's venue_contacts_name_or_phone CHECK, said before the round trip.
export const ContactSave = z
  .object({
    venue_id: RowId,
    // Present when editing, absent when adding.
    contact_id: z.preprocess((v) => (v === '' || v === null ? undefined : v), RowId.optional()),
    display_name: z.string().trim().max(120),
    phone: optionalText(30),
    note: optionalText(280),
  })
  .refine((v) => v.display_name !== '' || v.phone !== null, {
    message: 'Give a name or a number',
    path: ['display_name'],
  });

export const ContactRef = z.object({ venue_id: RowId, contact_id: RowId });

export const ContactsDeleteAll = z.object({ venue_id: RowId });
