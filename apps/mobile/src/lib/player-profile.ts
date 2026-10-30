// Shared player-profile vocabulary (Player Card, ADR-0012).
// Used by the profile edit form and the viewable player card so the two
// surfaces (edit vs view) speak the same field language. Reusable by
// Stage 3 matchmaking when it lands.

import type { Copy } from '@ludi/ui';

import { supabase } from './supabase';

export const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LW', 'RW', 'ST'] as const;
export type Position = (typeof POSITIONS)[number];

export type Foot = 'left' | 'right' | 'both';
export type Locale = 'en' | 'gr';

// Age is a coarse band, never a birth date (GDPR minimisation, ADR-0012).
// Band labels are language-neutral, so they live here rather than in COPY.
export const AGE_BANDS = ['u18', '18_25', '26_35', '36_45', '45_plus'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];
export const AGE_BAND_LABELS: Record<AgeBand, string> = {
  u18: 'U18',
  '18_25': '18–25',
  '26_35': '26–35',
  '36_45': '36–45',
  '45_plus': '45+',
};

export const PLAY_FREQUENCIES = ['casual', 'weekly', 'often'] as const;
export type PlayFrequency = (typeof PLAY_FREQUENCIES)[number];

export const HEIGHT_MIN = 120;
export const HEIGHT_MAX = 230;

// Plain-language anchors for the 1–5 skill scale (Plei/Playtomic style),
// so the bare number is legible. Keys resolve against @ludi/ui COPY.
export const SKILL_TIER_KEYS = [
  'profileSkillTier1',
  'profileSkillTier2',
  'profileSkillTier3',
  'profileSkillTier4',
  'profileSkillTier5',
] as const;
export type SkillTierKey = (typeof SKILL_TIER_KEYS)[number];

// Clamp + index safely (noUncheckedIndexedAccess) so callers get a key, never undefined.
export function skillTierKey(level: number): SkillTierKey {
  const clamped = Math.min(Math.max(Math.round(level), 1), 5);
  return SKILL_TIER_KEYS[clamped - 1] ?? 'profileSkillTier3';
}

// ── Player Card v2 vocabulary (plans/player-card-v2.md) ────────────────
// The card says the level as a short name over its meaning ("Regular" /
// "Plays local pickup often") instead of one long sentence, names the
// position in words beside its code, and fits the frequency into a grid cell.

/** The 1–5 level, clamped — `skill_level` is NOT NULL but not trusted to be in range. */
export function skillLevel(level: number): 1 | 2 | 3 | 4 | 5 {
  return Math.min(Math.max(Math.round(level), 1), 5) as 1 | 2 | 3 | 4 | 5;
}

export function skillTierNameKey(level: number): Extract<keyof Copy, `skillTierName${number}`> {
  return `skillTierName${skillLevel(level)}`;
}

export function skillTierDescKey(level: number): Extract<keyof Copy, `skillTierDesc${number}`> {
  return `skillTierDesc${skillLevel(level)}`;
}

/** Null for a code outside POSITIONS — the caller shows the bare code. */
export function positionNameKey(code: string): Extract<keyof Copy, `positionName${Position}`> | null {
  return (POSITIONS as readonly string[]).includes(code) ? `positionName${code as Position}` : null;
}

/** The positions after the first, as "RW, LW, CM +2" — at most `max` codes. */
export function alsoPlaysList(positions: string[], max = 3): string {
  const others = positions.slice(1);
  if (others.length <= max) return others.join(', ');
  return `${others.slice(0, max).join(', ')} +${others.length - max}`;
}

export function playFrequencyShortKey(
  f: PlayFrequency,
): 'playerCardFreqCasual' | 'playerCardFreqWeekly' | 'playerCardFreqOften' {
  return f === 'casual' ? 'playerCardFreqCasual' : f === 'weekly' ? 'playerCardFreqWeekly' : 'playerCardFreqOften';
}

// "since {month} {year}". Greek needs the accusative after «από» — «από Μάιο
// 2026» — and Intl only offers the nominative («Μάιος») or the genitive
// («Μαΐου»), depending on the engine. A table cannot drift by platform.
export const GR_MONTHS_ACC = [
  'Ιανουάριο',
  'Φεβρουάριο',
  'Μάρτιο',
  'Απρίλιο',
  'Μάιο',
  'Ιούνιο',
  'Ιούλιο',
  'Αύγουστο',
  'Σεπτέμβριο',
  'Οκτώβριο',
  'Νοέμβριο',
  'Δεκέμβριο',
] as const;

/** Month + year for "since {{when}}" — '' when unknown. */
export function formatSince(iso: string | null, locale: Locale): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (locale === 'gr') return `${GR_MONTHS_ACC[d.getMonth()]} ${d.getFullYear()}`;
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

// Small-caps labels. Greek capitals carry no accents («Επίπεδο» → «ΕΠΙΠΕΔΟ»,
// never «ΕΠΊΠΕΔΟ»), which bare `textTransform: 'uppercase'` gets wrong on
// iOS. Strip the tonos and breathings, keep the diaeresis, then upper-case.
export function upperLabel(s: string): string {
  if (typeof s.normalize !== 'function') return s.toUpperCase();
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u0307\u0309-\u036f]/g, '')
    .normalize('NFC')
    .toUpperCase();
}

export function footLabelKey(foot: Foot): 'profileFootLeft' | 'profileFootRight' | 'profileFootBoth' {
  return foot === 'left' ? 'profileFootLeft' : foot === 'right' ? 'profileFootRight' : 'profileFootBoth';
}

export function playFrequencyLabelKey(
  f: PlayFrequency,
): 'profilePlayFrequencyCasual' | 'profilePlayFrequencyWeekly' | 'profilePlayFrequencyOften' {
  return f === 'casual'
    ? 'profilePlayFrequencyCasual'
    : f === 'weekly'
    ? 'profilePlayFrequencyWeekly'
    : 'profilePlayFrequencyOften';
}

// Member number — permanent signup-order number (founder = 1), shown as the
// bare number: no # prefix, no zero-padding (founder corrections 2026-08-31).
// "Member 1" IS the badge.
export function formatMemberNo(n: number | null): string {
  if (n == null || n < 0) return '';
  return String(n);
}

// ── The record (community v2) ────────────────────────────────────────
// The caller's persistent history, read via the my_record() definer RPC:
// completed matches stood on and distinct teammates shared a roster with.
// Own data only — the public-card version is a separate consent decision
// (community-v2.md).

export interface MyRecord {
  matches_played: number;
  teammates: number;
  /**
   * Distinct venues played at. Added by 20260902000002_record_venues.sql —
   * `null` when the app is talking to a database that predates it, so the
   * profile can drop the third stat instead of showing a confident zero.
   * Schema-first deploy order makes that window short, not impossible.
   */
  venues: number | null;
}

/** A venue the caller has played at (plans/maps.md): own completed games. */
export interface MyGround {
  venue_id: string;
  name: string;
  slug: string | null;
  lat: number | null;
  lng: number | null;
  games: number;
  last_played: string;
}

export async function fetchMyGrounds(): Promise<MyGround[]> {
  const { data, error } = await supabase.rpc('my_grounds');
  if (error) throw error;
  return (data ?? []) as MyGround[];
}

export async function fetchMyRecord(): Promise<MyRecord> {
  const { data, error } = await supabase.rpc('my_record');
  if (error) throw error;
  const row = (data ?? [])[0] as Partial<MyRecord> | undefined;
  return {
    matches_played: row?.matches_played ?? 0,
    teammates: row?.teammates ?? 0,
    venues: row?.venues ?? null,
  };
}

// ── Display name ────────────────────────────────────────────────────
// The card and the hub both anchor on the player's name, and both used to
// interpolate `${first} ${last}` directly — which renders an empty string
// on an account that never set one, collapsing the whole identity into a
// bare logo (profile audit 2026-09-02). Every name-bearing surface goes
// through here so the fallback can never be forgotten in one of them.

export function displayName(
  p: { first_name: string; last_name: string },
  fallback: string,
): string {
  return `${p.first_name} ${p.last_name}`.trim() || fallback;
}

// The monogram beside the name — initials where a photo would go. Photos
// stay deferred (ADR-0012), but the researched profile formula puts *some*
// personal mark at the top of the screen, and initials cost no storage and
// carry no moderation tail.
export function monogram(
  p: { first_name: string; last_name: string },
  memberNo: number | null,
): string {
  const first = p.first_name.trim()[0] ?? '';
  const last = p.last_name.trim()[0] ?? '';
  const initials = `${first}${last}`.toUpperCase();
  if (initials) return initials;
  // No name yet: the member number is the only identity the account has.
  return memberNo != null ? String(memberNo) : '·';
}

// "Member since" — month + year is enough credibility without exposing a precise date.
export function formatMemberSince(iso: string | null, locale: Locale): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale === 'gr' ? 'el-GR' : 'en-GB', {
    month: 'long',
    year: 'numeric',
  });
}
