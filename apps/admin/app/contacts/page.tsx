import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  AddContactForm,
  ContactsTable,
  DeleteAllContacts,
  type ContactRow,
} from '@/components/contacts-list';
import { AppShell, Card, EmptyState, PageHead } from '@/components/ui';
import { requireVenueAccess } from '@/lib/auth';
import { getCopy } from '@/lib/copy';
import { createClient } from '@/lib/supabase/server';

// Contacts — the owner's regulars (plans/owner-contacts.md, slice B).
//
// OWNER-ONLY, like /access and for the reason slice A drew the read line
// where it did: the list, its export and its deletion are the owner's. A
// manager has no SELECT on venue_contacts at all — he finds a regular in
// the booking form's typeahead and never sees the list — so this page
// would render empty for him; it sends him home instead. An admin is sent
// to /venues: Ludi is the processor of these lists, and the founder does
// not need every venue's customers on one screen.
//
// The list mostly fills itself from walk-ins, so this is housekeeping:
// correct a name, add a note, download it, delete it.

// A venue with more regulars than this is searched, not scrolled. The
// count says so; nothing is silently cut.
const CAP = 200;

type SearchParams = { venue?: string; q?: string };

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const viewer = await requireVenueAccess();
  const t = getCopy(viewer.locale);
  const c = t.contacts;

  if (viewer.isAdmin) redirect('/venues');
  const owned = viewer.venues.filter((v) => v.role === 'owner');
  if (owned.length === 0) redirect('/');

  const params = await searchParams;
  const venue = owned.find((v) => v.id === params.venue) ?? owned[0]!;
  const q = (params.q ?? '').trim().slice(0, 60);

  const supabase = await createClient();

  // The same folding the booking form's search uses, done by the database's
  // own function so the page and the typeahead can never disagree about
  // whether «Ανδ» is "and". The result is a–z0–9 and spaces only, which is
  // what makes it safe to place inside the filter below.
  let key = '';
  if (q) {
    const { data } = await supabase.rpc('normalize_contact_text', { p: q });
    key = typeof data === 'string' ? data : '';
  }
  const digits = q.replace(/[^0-9]/g, '');

  let query = supabase
    .from('venue_contacts')
    .select('id, display_name, phone, phone_e164, note, source', { count: 'exact' })
    .eq('venue_id', venue.id)
    // By the folded key, not the name: under a byte collation the name puts
    // every Latin spelling before every Greek one. search_key is both in one
    // alphabet, so Ανδρέας sits beside Andreas where a person looks for him.
    .order('search_key', { ascending: true })
    .limit(CAP);
  const ors: string[] = [];
  if (key) ors.push(`search_key.ilike."*${key}*"`);
  if (digits.length >= 3) ors.push(`phone_e164.ilike."*${digits}*"`);
  if (ors.length) query = query.or(ors.join(','));

  const [{ data, count, error }, { count: total, error: totalError }] = await Promise.all([
    query,
    supabase
      .from('venue_contacts')
      .select('id', { count: 'exact', head: true })
      .eq('venue_id', venue.id),
  ]);
  // The code, not the message: this is a list of people's names and
  // numbers, and a thrown message travels to logs and error reporting.
  if (error) throw new Error(`contacts: list failed (${error.code || 'unknown'})`);
  if (totalError) throw new Error(`contacts: count failed (${totalError.code || 'unknown'})`);

  const contacts = (data ?? []) as ContactRow[];
  const shown = count ?? contacts.length;
  const all = total ?? 0;
  const venueParam = owned.length > 1 ? `venue=${venue.id}&` : '';

  return (
    <AppShell viewer={viewer}>
      <PageHead
        title={c.title}
        meta={c.count(all)}
        actions={
          all > 0 ? (
            // A plain link: the browser downloads what the route answers.
            <a
              href={`/contacts/export?venue=${venue.id}`}
              className="btn btn-secondary"
              download
            >
              {c.exportCsv}
            </a>
          ) : undefined
        }
      />
      <p className="page-intro">{c.intro}</p>

      <div className="stack">
        {owned.length > 1 ? (
          <form method="get" className="filters">
            <label className="field">
              <span className="field-label">{c.venue}</span>
              <select name="venue" defaultValue={venue.id} className="input">
                {owned.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="filters-actions">
              <button type="submit" className="btn btn-secondary">
                {c.search}
              </button>
            </div>
          </form>
        ) : null}

        {all > 0 ? (
          <form method="get" className="filters">
            {owned.length > 1 ? <input type="hidden" name="venue" value={venue.id} /> : null}
            <label className="field">
              <span className="field-label">{c.search}</span>
              <input
                name="q"
                defaultValue={q}
                className="input"
                placeholder={c.searchPlaceholder}
                maxLength={60}
                autoComplete="off"
              />
            </label>
            <div className="filters-actions">
              <button type="submit" className="btn btn-secondary">
                {c.search}
              </button>
              {q ? (
                <Link href={`/contacts${venueParam ? `?${venueParam.slice(0, -1)}` : ''}`} className="btn btn-secondary">
                  {c.clear}
                </Link>
              ) : null}
            </div>
          </form>
        ) : null}

        {all === 0 ? (
          <EmptyState>{c.empty}</EmptyState>
        ) : contacts.length === 0 ? (
          <EmptyState>{c.noMatch}</EmptyState>
        ) : (
          <Card pad={false}>
            <ContactsTable venueId={venue.id} contacts={contacts} />
          </Card>
        )}
        {shown > contacts.length ? (
          <p className="field-hint" style={{ margin: 0 }}>
            {c.capped(contacts.length, shown)}
          </p>
        ) : null}

        <Card>
          <p className="form-section" style={{ marginTop: 0 }}>
            {c.add.title}
          </p>
          <AddContactForm venueId={venue.id} />
        </Card>

        {all > 0 ? (
          <Card>
            <p className="form-section" style={{ marginTop: 0 }}>
              {c.dangerTitle}
            </p>
            <DeleteAllContacts venueId={venue.id} count={all} />
          </Card>
        ) : null}

        {all > 0 ? <p className="field-hint">{c.exportHint}</p> : null}
      </div>
    </AppShell>
  );
}
