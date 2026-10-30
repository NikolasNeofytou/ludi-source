// cfa.ts — the CFA Saturday inside Ludi (plans/cfa-in-the-app.md, ADR-0051).
//
// The venue's Saturday (K2), the teams a parent follows (K3), today's CFA
// mornings for Discover (K7), and the parents' game ask (K6). Every read is
// a definer RPC that never returns a CFA score; a follow is the parent's
// alone — nothing here can see anyone else's.

import { supabase } from './supabase';

const VENUE_TZ = 'Europe/Nicosia';

export type CfaStatus = 'scheduled' | 'postponed' | 'cancelled' | 'played';

export interface VenueFixture {
  match_id: string;
  competition_kind: string;
  kickoff_at: string;
  ends_at: string;
  court: string | null;
  category: string | null;
  round_label: string;
  status: CfaStatus;
  home_team_id: string;
  home: string;
  away_team_id: string;
  away: string;
  following_home: boolean;
  following_away: boolean;
}

export interface VenueSaturday {
  /** YYYY-MM-DD, Cyprus date. */
  date: string;
  matches: VenueFixture[];
}

export interface TeamFixture {
  match_id: string;
  followed_team_id: string;
  kickoff_at: string;
  venue_id: string | null;
  venue_name: string;
  venue_lat: number | null;
  venue_lng: number | null;
  elsewhere: string | null;
  court: string | null;
  category: string | null;
  home: string;
  away: string;
  status: CfaStatus;
}

export interface FollowedTeam {
  team_id: string;
  name: string;
  category: string | null;
  group_label: string | null;
  venue_id: string;
  venue_name: string;
  plays: boolean;
}

export interface CfaToday {
  venue_id: string;
  venue_name: string;
  matches: number;
  next_kickoff: string | null;
}

/** "2026-10-31" — a moment's date on the venue's clock. */
export function cyprusDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: VENUE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** "09:15" on the venue's clock. */
export function cyprusTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: VENUE_TZ, hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

/** "Sat 31 Oct" / "Σάβ 31 Οκτ". */
export function cyprusDay(iso: string, locale: 'en' | 'gr'): string {
  return new Intl.DateTimeFormat(locale === 'gr' ? 'el-GR' : 'en-GB', {
    timeZone: VENUE_TZ,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
}

/**
 * The venue's CFA day: today if it hosts matches today, otherwise the next
 * day within a week that does. Null when there is none.
 */
export async function fetchVenueSaturday(venueId: string): Promise<VenueSaturday | null> {
  const now = new Date();
  const { data, error } = await supabase.rpc('venue_fixtures', {
    p_venue_id: venueId,
    p_from: cyprusDate(now),
    p_to: cyprusDate(new Date(now.getTime() + 7 * 86_400_000)),
  });
  if (error) throw error;
  const rows = ((data ?? []) as VenueFixture[]).filter((r) => r.competition_kind === 'cfa_grassroots');
  if (rows.length === 0) return null;
  const day = cyprusDate(new Date(rows[0]!.kickoff_at));
  return { date: day, matches: rows.filter((r) => cyprusDate(new Date(r.kickoff_at)) === day) };
}

export async function followTeam(teamId: string, plays: boolean): Promise<void> {
  const { error } = await supabase.rpc('follow_team', { p_team_id: teamId, p_plays: plays });
  if (error) throw error;
}

export async function unfollowTeam(teamId: string): Promise<void> {
  const { error } = await supabase.rpc('unfollow_team', { p_team_id: teamId });
  if (error) throw error;
}

export async function fetchMyTeamFixtures(): Promise<TeamFixture[]> {
  const { data, error } = await supabase.rpc('my_team_fixtures');
  if (error) throw error;
  return (data ?? []) as TeamFixture[];
}

export async function fetchMyFollows(): Promise<FollowedTeam[]> {
  const { data, error } = await supabase.rpc('my_follows');
  if (error) throw error;
  return (data ?? []) as FollowedTeam[];
}

export async function fetchCfaToday(cityId: string): Promise<CfaToday[]> {
  const { data, error } = await supabase.rpc('cfa_today_nearby', { p_city_id: cityId });
  if (error) throw error;
  return (data ?? []) as CfaToday[];
}

export async function venueHostsCfa(venueId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('venue_hosts_cfa', { p_venue_id: venueId });
  if (error) throw error;
  return data === true;
}

/** The parents' game (K6): asks the parents who play at this venue. Never says how many. */
export async function askParents(bookingId: string): Promise<void> {
  const { error } = await supabase.rpc('ask_parents', { p_booking_id: bookingId });
  if (error) throw error;
}
