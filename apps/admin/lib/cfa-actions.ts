'use server';

import { revalidatePath } from 'next/cache';

import { requireVenueAccess } from '@/lib/auth';
import { getCopy } from '@/lib/copy';
import { RowId } from '@/lib/schemas';
import { createClient } from '@/lib/supabase/server';

// Loading a CFA round and the venue's public screen link
// (plans/cfa-grassroots-saturday.md). Both are definer RPCs gated on the
// venue inside the database; these only shape the call and the answer.

// A match here carries a court, minutes and a price; an away match of one
// of the venue's teams carries `elsewhere`, the CFA's venue name, and no
// court (plans/cfa-in-the-app.md K1). Each side's category and group make
// the team's key.
export type CfaMatchInput = {
  kickoff: string;
  category: string;
  home: string;
  away: string;
  home_category?: string;
  away_category?: string;
  home_group?: string;
  away_group?: string;
} & ({ pitch_id: string; minutes: number; price_cents: number } | { elsewhere: string });

export type LoadCounts = {
  placed: number;
  moved: number;
  unchanged: number;
  cancelled: number;
  away: number;
  released: number;
  skipped: { index: number; reason: string }[];
};

export type LoadResult = ({ ok: true } & LoadCounts) | { ok: false; message: string };

export async function loadCfaRound(input: {
  venueId: string;
  date: string;
  round: string;
  matches: CfaMatchInput[];
}): Promise<LoadResult> {
  const viewer = await requireVenueAccess();
  const t = getCopy(viewer.locale).cfa;
  if (!RowId.safeParse(input.venueId).success || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    return { ok: false, message: t.failed };
  }
  if (!viewer.isAdmin && !viewer.venues.some((v) => v.id === input.venueId)) {
    return { ok: false, message: t.notYours };
  }
  if (input.matches.length === 0) return { ok: false, message: t.nothingToLoad };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('load_cfa_round', {
    p_venue_id: input.venueId,
    p_date: input.date,
    p_round: input.round.trim() || t.defaultRound,
    p_matches: input.matches,
  });
  if (error) {
    console.error('load_cfa_round failed:', error.code, error.message);
    return { ok: false, message: error.code === '42501' ? t.notYours : t.failed };
  }
  const r = data as LoadCounts;
  revalidatePath('/calendar');
  return {
    ok: true,
    placed: r.placed ?? 0,
    moved: r.moved ?? 0,
    unchanged: r.unchanged ?? 0,
    cancelled: r.cancelled ?? 0,
    away: r.away ?? 0,
    released: r.released ?? 0,
    skipped: r.skipped ?? [],
  };
}

// The owner changes a CFA match from the calendar (plans/cfa-in-the-app.md
// K5). Each writes a change row in the database, which tells the match's
// followers; these only shape the call and the answer.
export type MatchChange = { ok: true } | { ok: false; reason: 'taken' | 'failed' | 'notYours' };

export async function moveCfaMatch(matchId: string, pitchId: string, kickoff: string): Promise<MatchChange> {
  await requireVenueAccess();
  if (!RowId.safeParse(matchId).success || !RowId.safeParse(pitchId).success || !/^\d{2}:\d{2}$/.test(kickoff)) {
    return { ok: false, reason: 'failed' };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('move_cfa_match', { p_match_id: matchId, p_pitch_id: pitchId, p_kickoff: kickoff });
  if (error) {
    console.error('move_cfa_match failed:', error.code, error.message);
    return { ok: false, reason: error.code === '23P01' ? 'taken' : error.code === '42501' ? 'notYours' : 'failed' };
  }
  revalidatePath('/calendar');
  return { ok: true };
}

export async function setCfaMatchStatus(
  matchId: string,
  status: 'scheduled' | 'postponed' | 'cancelled',
): Promise<MatchChange> {
  await requireVenueAccess();
  if (!RowId.safeParse(matchId).success) return { ok: false, reason: 'failed' };
  const supabase = await createClient();
  const { error } = await supabase.rpc('set_cfa_match_status', { p_match_id: matchId, p_status: status });
  if (error) {
    console.error('set_cfa_match_status failed:', error.code, error.message);
    return { ok: false, reason: error.code === '23P01' ? 'taken' : error.code === '42501' ? 'notYours' : 'failed' };
  }
  revalidatePath('/calendar');
  return { ok: true };
}

export async function rotateScreenLink(formData: FormData): Promise<void> {
  const viewer = await requireVenueAccess();
  const venueId = String(formData.get('venue_id') ?? '');
  if (!RowId.safeParse(venueId).success) return;
  if (!viewer.isAdmin && !viewer.venues.some((v) => v.id === venueId)) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc('venue_display_token', { p_venue_id: venueId, p_rotate: true });
  if (error) console.error('venue_display_token rotate failed:', error.code, error.message);
  revalidatePath('/calendar/screen');
}
