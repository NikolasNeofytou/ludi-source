import { NextResponse, type NextRequest } from 'next/server';

import { requireVenueAccess } from '@/lib/auth';
import { getCopy } from '@/lib/copy';
import { createClient } from '@/lib/supabase/server';

// GET /contacts/export?venue=<id> — the owner's list, as a CSV he keeps
// (plans/owner-contacts.md, slice B, and its §Legal: the venue is the
// controller of this data, and "export" is one of the two buttons that let
// it exercise its own obligations; delete-all is the other).
//
// Owner-only, answered 404 to anyone else rather than 403 — a URL that
// exists for another venue's owner should not say so. RLS would hand a
// manager nothing anyway (venue_contacts has an owner-only SELECT policy).

// A cell that starts with one of these is run as a formula by Excel and
// Sheets. The counter types free text, so "=HYPERLINK(…)" as a name is
// possible — and every phone number starts with '+', which Excel would
// otherwise turn into a bare 35799123456. A leading apostrophe makes the
// cell plain text in both, and neither displays it.
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: string | null | undefined): string {
  let v = value ?? '';
  if (FORMULA_START.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}

// The file name must be plain ASCII for older mail clients and Windows; the
// venue's own name rides in filename* for everything that reads it.
function asciiSlug(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[^\x20-\x7e]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'venue'
  );
}

export async function GET(req: NextRequest) {
  const viewer = await requireVenueAccess();
  const venueId = req.nextUrl.searchParams.get('venue') ?? '';
  const venue = viewer.venues.find((v) => v.id === venueId && v.role === 'owner');
  if (viewer.isAdmin || !venue) return new NextResponse('Not found', { status: 404 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('venue_contacts')
    .select('display_name, phone, phone_e164, note, source, created_at')
    .eq('venue_id', venue.id)
    .order('search_key', { ascending: true });
  if (error) {
    console.error('contacts export failed:', error.code);
    return new NextResponse('Export failed', { status: 500 });
  }

  const t = getCopy(viewer.locale).contacts;
  const head =
    viewer.locale === 'gr'
      ? ['Όνομα', 'Τηλέφωνο', 'Σημείωση', 'Προέλευση', 'Από']
      : ['Name', 'Phone', 'Note', 'Added', 'Since'];
  type Row = {
    display_name: string;
    phone: string | null;
    phone_e164: string | null;
    note: string | null;
    source: keyof typeof t.source;
    created_at: string;
  };
  const lines = [
    head.map(cell).join(','),
    ...((data ?? []) as Row[]).map((r) =>
      [
        r.display_name,
        r.phone_e164 ?? r.phone,
        r.note,
        t.source[r.source] ?? r.source,
        new Date(r.created_at).toLocaleDateString('en-CA', { timeZone: 'Europe/Nicosia' }),
      ]
        .map(cell)
        .join(','),
    ),
  ];

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Nicosia' });
  const base = `contacts-${asciiSlug(venue.name)}-${today}.csv`;
  const utf8Name = encodeURIComponent(`${venue.name} — ${today}.csv`);

  // The BOM is what makes Excel read the file as UTF-8. Without it every
  // Greek name opens as mojibake — which, for this venue, is every name.
  return new NextResponse(`﻿${lines.join('\r\n')}\r\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${base}"; filename*=UTF-8''${utf8Name}`,
      // A list of people's names and numbers: never kept by a cache.
      'Cache-Control': 'no-store',
    },
  });
}
