'use client';

import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';

import { useCopy } from '@/components/locale-provider';
import { createClient } from '@/lib/supabase/client';
import { tokens } from '@/lib/tokens';

// Slice C of plans/owner-contacts.md — the booking form knows the regulars.
//
// The one human the plan names: Giorgos behind the Kamares counter, phone
// in hand, types «Ανδ», and Andreas is the first row with his number
// attached. One tap, and the name and phone are filled. He never types
// the digits, and never wonders which Andreas this is.
//
// So this replaces the name and phone inputs of the walk-in form rather
// than sitting beside them. Both fields search: the counter types
// whichever the customer gave first, and venue_contacts_search matches a
// name (Greek or Latin, 20260918000002) or three digits of a number.
//
// Picking a contact fills both fields and holds its id, which the booking
// carries. Editing either field afterwards drops the id — what is on the
// screen is then something typed, not the person who was picked, and a
// booking must never say it is for Andreas while carrying someone else's
// number. Typing a name nobody knows still works exactly as before: the
// bookings trigger makes the contact from the phone on save.
//
// The read goes straight from the browser to venue_contacts_search: one
// hop, because a typeahead at a counter is felt, and the function is the
// gate (venue access; ≤ 8 rows; a query that says nothing returns
// nothing). A manager has no other read of the list, and this does not
// give him one.
//
// If the search fails — a dropped connection — the fields keep working as
// plain inputs. A broken typeahead must never stop a booking.

export type PickedContact = {
  id: string;
  display_name: string;
  phone: string | null;
  phone_e164: string | null;
  note: string | null;
};

type Props = {
  venueId: string | undefined;
  name: string;
  phone: string;
  contactId: string | null;
  onChange: (next: { name: string; phone: string; contactId: string | null }) => void;
  disabled: boolean;
  labels: { name: string; namePlaceholder: string; phone: string; phonePlaceholder: string };
  fieldStyle: CSSProperties;
  labelStyle: CSSProperties;
  inputStyle: CSSProperties;
};

const DEBOUNCE_MS = 180;

// What the search function will answer (it returns nothing otherwise), so
// the client does not ask a question it knows is empty.
function worthAsking(q: string): boolean {
  const letters = q.replace(/[^\p{L}]/gu, '');
  const digits = q.replace(/[^0-9]/g, '');
  return letters.length >= 2 || digits.length >= 3;
}

// "+35799123456" → "+357 99 123456": readable in the row, without trying
// to be a full phone formatter.
function displayPhone(c: PickedContact): string {
  const e = c.phone_e164;
  if (e && e.startsWith('+357') && e.length === 12) {
    return `+357 ${e.slice(4, 6)} ${e.slice(6)}`;
  }
  return e ?? c.phone ?? '';
}

export function ContactPicker({
  venueId,
  name,
  phone,
  contactId,
  onChange,
  disabled,
  labels,
  fieldStyle,
  labelStyle,
  inputStyle,
}: Props) {
  const t = useCopy().walkIn.picker;
  const listId = useId();

  const [results, setResults] = useState<PickedContact[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Which field the counter is typing in; that one's text is the query.
  const [source, setSource] = useState<'name' | 'phone'>('name');
  // Only the newest answer is shown. A slow reply to "Αν" must not replace
  // a fast one to "Ανδρ".
  const seq = useRef(0);

  const query = source === 'name' ? name : phone;

  useEffect(() => {
    if (!venueId || contactId || !worthAsking(query)) {
      setResults([]);
      setOpen(false);
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.rpc('venue_contacts_search', {
          p_venue_id: venueId,
          p_query: query,
        });
        if (mine !== seq.current) return;
        if (error) throw error;
        const rows = (data ?? []) as PickedContact[];
        setResults(rows);
        setActive(0);
        setOpen(rows.length > 0);
      } catch (err) {
        if (mine !== seq.current) return;
        // Degrade to plain inputs; say nothing on screen — the booking
        // itself is unaffected, and a red line here would be noise.
        console.error('contact search failed', err);
        setResults([]);
        setOpen(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [venueId, contactId, query]);

  function pick(c: PickedContact) {
    onChange({
      // A contact may have no name yet — the walk-in that made it carried
      // only a number. The booking still needs one, so the number stands in
      // and the counter can type over it.
      name: c.display_name || displayPhone(c),
      // The normalised number, not the one as first typed: '+35799123456'
      // is stored with its country code, so every tel: link built from the
      // booking dials. The raw form only when it would not normalise.
      phone: c.phone_e164 ?? c.phone ?? '',
      contactId: c.id,
    });
    setOpen(false);
    setResults([]);
  }

  function unlink() {
    onChange({ name, phone, contactId: null });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const c = results[active];
      if (c) pick(c);
    } else if (e.key === 'Escape') {
      // Close the list, not the modal: stop the key reaching its listener.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  }

  const comboProps = (field: 'name' | 'phone') => ({
    role: 'combobox' as const,
    'aria-autocomplete': 'list' as const,
    'aria-expanded': open && source === field,
    'aria-controls': listId,
    'aria-activedescendant':
      open && source === field && results[active] ? `${listId}-${results[active].id}` : undefined,
    onKeyDown,
    // Let a tap on a row land before the list closes under it.
    onBlur: () => setTimeout(() => setOpen(false), 120),
    onFocus: () => setSource(field),
  });

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <label style={{ ...fieldStyle, flex: 2 }}>
          <span style={labelStyle}>{labels.name}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setSource('name');
              onChange({ name: e.target.value, phone, contactId: null });
            }}
            maxLength={120}
            // No venue, no list to search — the field is the plain one it was.
            placeholder={venueId ? t.searchPlaceholder : labels.namePlaceholder}
            style={inputStyle}
            disabled={disabled}
            autoComplete="off"
            autoFocus
            {...comboProps('name')}
          />
        </label>
        <label style={{ ...fieldStyle, flex: 2 }}>
          <span style={labelStyle}>{labels.phone}</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => {
              setSource('phone');
              onChange({ name, phone: e.target.value, contactId: null });
            }}
            maxLength={30}
            placeholder={labels.phonePlaceholder}
            style={inputStyle}
            disabled={disabled}
            autoComplete="off"
            {...comboProps('phone')}
          />
        </label>
      </div>

      {contactId ? (
        <div style={linkedStyle}>
          <span aria-hidden style={dotStyle} />
          <span>{t.fromRegulars}</span>
          <button type="button" onClick={unlink} style={unlinkStyle} disabled={disabled}>
            {t.someoneElse}
          </button>
        </div>
      ) : null}

      {open && results.length > 0 ? (
        <ul id={listId} role="listbox" aria-label={t.regulars} style={listStyle}>
          {results.map((c, i) => (
            <li
              key={c.id}
              id={`${listId}-${c.id}`}
              role="option"
              aria-selected={i === active}
              // mousedown, not click: it fires before the input's blur.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
              onMouseEnter={() => setActive(i)}
              style={{ ...optionStyle, ...(i === active ? optionActiveStyle : null) }}
            >
              <span style={{ fontWeight: 600, color: tokens.ink }}>
                {c.display_name || displayPhone(c)}
              </span>
              {/* The number (unless it is already the headline) and the
                  note, joined only when both exist — a regular with no
                  phone must not open on a stray separator. */}
              {(() => {
                const detail = [c.display_name ? displayPhone(c) : '', c.note ?? '']
                  .filter(Boolean)
                  .join(' · ');
                return detail ? (
                  <span style={{ color: tokens.ink3, fontSize: 13 }}>{detail}</span>
                ) : null;
              })()}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// Inline rather than floating: the modal scrolls on a phone, and a list
// that pushes the form down cannot be clipped by the card's edge.
const listStyle: CSSProperties = {
  listStyle: 'none',
  margin: '6px 0 0',
  padding: 4,
  border: `1px solid ${tokens.lineBold}`,
  borderRadius: 8,
  background: tokens.surface,
};

const optionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '10px 10px',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 14,
};

const optionActiveStyle: CSSProperties = { background: tokens.primarySoft };

const linkedStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 6,
  fontSize: 13,
  color: tokens.pitchDeep,
};

const dotStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: 4,
  background: tokens.pitch,
};

const unlinkStyle: CSSProperties = {
  marginLeft: 'auto',
  background: 'none',
  border: 'none',
  padding: 0,
  color: tokens.primary,
  fontSize: 13,
  textDecoration: 'underline',
  cursor: 'pointer',
};
