// The goalkeeper pool (ADR-0047, plans/keeper-pool.md). A player says
// whether he goes in goal; an organiser short a keeper posts the game; the
// first willing player to claim it takes the gloves, free; afterwards both
// sides answer two yes/no questions. Everything here is an RPC or a
// definer view — the tables are the database's.

import { supabase } from './supabase';

export type GoesInGoal = 'full' | 'rotation' | 'no';
export type KeeperShape = 'full' | 'rotation';

export class KeeperError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'KeeperError';
  }
}

const fail = (error: { message: string }) => new KeeperError(error.message, error.message);

export interface KeeperRequestState {
  request_id: string;
  status: 'open' | 'claimed';
  shape: KeeperShape;
  claimed_by_name: string | null;
  audience: number;
}

/** The fixture's own request, for its organiser. Null when there is none. */
export async function fetchKeeperRequestFor(bookingId: string): Promise<KeeperRequestState | null> {
  const { data, error } = await supabase.rpc('gk_request_for', { p_booking_id: bookingId });
  if (error) throw fail(error);
  return ((data ?? [])[0] as KeeperRequestState | undefined) ?? null;
}

export async function postKeeperRequest(bookingId: string, shape: KeeperShape): Promise<{ request_id: string; audience: number }> {
  const { data, error } = await supabase.rpc('gk_post', { p_booking_id: bookingId, p_shape: shape });
  if (error) throw fail(error);
  return (data ?? [])[0] as { request_id: string; audience: number };
}

export async function withdrawKeeperRequest(requestId: string): Promise<void> {
  const { error } = await supabase.rpc('gk_withdraw', { p_request_id: requestId });
  if (error) throw fail(error);
}

/** A request a willing player can claim (v_keeper_requests) — counts only. */
export interface KeeperRequest {
  request_id: string;
  booking_id: string;
  starts_at: string;
  ends_at: string;
  pitch_type: string;
  pitch_name: string;
  venue_name: string;
  city_name_en: string;
  city_name_gr: string;
  shape: KeeperShape;
  keepers_would_return: number;
  keepers_played: number;
  /** Where the game is (plans/maps.md). */
  venue_id: string;
  lat: number | null;
  lng: number | null;
}

export async function fetchKeeperRequests(): Promise<KeeperRequest[]> {
  const { data, error } = await supabase
    .from('v_keeper_requests')
    .select(
      `request_id, booking_id, starts_at, ends_at, pitch_type, pitch_name, venue_name,
       city_name_en, city_name_gr, shape, keepers_would_return, keepers_played,
       venue_id, lat, lng`,
    )
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as KeeperRequest[];
}

/** First claim wins; returns the fixture to open. */
export async function claimKeeperRequest(requestId: string): Promise<string> {
  const { data, error } = await supabase.rpc('gk_claim', { p_request_id: requestId });
  if (error) throw fail(error);
  return data as string;
}

export interface KeeperFeedbackDue {
  request_id: string;
  role: 'organiser' | 'keeper';
  other_name: string | null;
}

export async function fetchKeeperFeedbackDue(bookingId: string): Promise<KeeperFeedbackDue | null> {
  const { data, error } = await supabase.rpc('gk_feedback_due', { p_booking_id: bookingId });
  if (error) throw fail(error);
  return ((data ?? [])[0] as KeeperFeedbackDue | undefined) ?? null;
}

export async function giveKeeperFeedback(requestId: string, showedUp: boolean | null, again: boolean): Promise<void> {
  const { error } = await supabase.rpc('gk_feedback_give', {
    p_request_id: requestId,
    p_showed_up: showedUp,
    p_again: again,
  });
  if (error) throw fail(error);
}
