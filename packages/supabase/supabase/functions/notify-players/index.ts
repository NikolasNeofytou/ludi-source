// notify-players/index.ts
// POST /notify-players — the player's notices go out (ADR-0048,
// plans/reach.md R3).
//
// Invoked every minute by pg_cron + pg_net (ludi-notify-players),
// authenticated by a shared secret header, not a Supabase JWT — the
// expire-collecting precedent. The database minted the rows and decides
// which are due (claim_player_notifications); this function owns only the
// transports and the row flips:
//   1. push  — Expo's push API, a hundred messages a request; a device
//              Expo says is gone is disabled on the spot
//   2. email — Resend, plain text, when RESEND_API_KEY is set; otherwise
//              the row is skipped with the reason, never lost
//   3. receipts — pushes sent fifteen minutes ago are checked once; a
//              DeviceNotRegistered receipt disables that device
// A transport error puts the row back for a later tick, five times.
// Rendering is _shared/notices.ts, pure and tested.

import { serve } from 'std/http/server.ts';
import { withSentry } from '../_shared/sentry.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/errors.ts';
import { secretMatches } from '../_shared/secrets.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import {
  chunk,
  isDeadDevice,
  pairTickets,
  pushMessagesFor,
  renderEmail,
  TEAM_KINDS,
  type ClaimedNotice,
  type ExpoMessage,
  type ExpoTicket,
  type TokenOutcome,
} from '../_shared/notices.ts';

const EXPO_PUSH_URL = Deno.env.get('EXPO_PUSH_URL') ?? 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = Deno.env.get('EXPO_RECEIPTS_URL') ?? 'https://exp.host/--/api/v2/push/getReceipts';
const RESEND_URL = Deno.env.get('RESEND_URL') ?? 'https://api.resend.com/emails';
const EMAIL_FROM = Deno.env.get('NOTIFY_EMAIL_FROM') ?? 'Ludi <hello@ludi.football>';
const SITE_ORIGIN = Deno.env.get('SITE_ORIGIN') ?? 'https://ludi.football';

function expoHeaders(): HeadersInit {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
  };
  const token = Deno.env.get('EXPO_ACCESS_TOKEN');
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** One request per chunk of a hundred; Expo answers with one ticket per message, in order. */
async function sendExpo(messages: ExpoMessage[]): Promise<ExpoTicket[]> {
  const tickets: ExpoTicket[] = [];
  for (const part of chunk(messages, 100)) {
    const res = await fetch(EXPO_PUSH_URL, { method: 'POST', headers: expoHeaders(), body: JSON.stringify(part) });
    if (!res.ok) throw new Error(`expo push ${res.status}`);
    const json = (await res.json()) as { data?: ExpoTicket[] };
    tickets.push(...(json.data ?? []));
  }
  return tickets;
}

async function sendResend(to: string, subject: string, text: string, key: string): Promise<string> {
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, text }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}`);
  const json = (await res.json()) as { id?: string };
  return json.id ?? '';
}

serve(withSentry(async (req) => {
  if (req.method === 'OPTIONS') return preflightResponse();
  if (req.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 'Use POST', 405);

  const secret = Deno.env.get('NOTIFY_PLAYERS_SECRET');
  if (!secret) {
    console.error('NOTIFY_PLAYERS_SECRET is not set');
    return errorResponse('INTERNAL_ERROR', 'Sender is not configured', 500);
  }
  if (!secretMatches(req.headers.get('x-notify-secret'), secret)) {
    return errorResponse('UNAUTHORIZED', 'Bad sender secret', 401);
  }

  const supa = createServiceClient();
  const counts = { push_sent: 0, email_sent: 0, skipped: 0, failed: 0, tokens_disabled: 0, receipts: 0 };

  const { data, error } = await supa.rpc('claim_player_notifications', { p_limit: 100 });
  if (error) throw new Error(`claim_player_notifications failed: ${error.message}`);
  const rows = (data ?? []) as ClaimedNotice[];

  // ── 1. push ────────────────────────────────────────────────────────
  // Every push row's messages in one batch, then each row judged by its
  // own devices: all gone → skipped; any accepted → sent with the tickets;
  // Expo unreachable → every row back for a later tick.
  // A followed team's notice whose match has gone (its competition was
  // deleted) has nothing left to say: skipped, with the reason.
  for (const r of rows) {
    if (TEAM_KINDS.has(r.kind) && !r.context?.match) {
      await supa.rpc('player_notification_skipped', { p_id: r.id, p_reason: 'match_gone' });
      counts.skipped++;
    }
  }
  const pushRows = rows.filter((r) => r.channel === 'push' && !(TEAM_KINDS.has(r.kind) && !r.context?.match));
  const perRow = pushRows.map((r) => ({ row: r, messages: pushMessagesFor(r) }));
  const all = perRow.flatMap((p) => p.messages);
  let outcomes: TokenOutcome[] = [];
  let expoDown: string | null = null;
  if (all.length > 0) {
    try {
      outcomes = pairTickets(all, await sendExpo(all));
    } catch (err) {
      expoDown = err instanceof Error ? err.message : 'expo failed';
      console.error(JSON.stringify({ level: 'error', event: 'expo_push_failed', detail: expoDown }));
    }
  }
  let cursor = 0;
  for (const { row, messages } of perRow) {
    const mine = outcomes.slice(cursor, cursor + messages.length);
    cursor += messages.length;
    if (messages.length === 0) {
      await supa.rpc('player_notification_skipped', { p_id: row.id, p_reason: 'no_token' });
      counts.skipped++;
      continue;
    }
    if (expoDown) {
      await supa.rpc('player_notification_failed', { p_id: row.id, p_error: expoDown });
      counts.failed++;
      continue;
    }
    for (const o of mine) {
      if (isDeadDevice(o.error)) {
        await supa.rpc('disable_push_token', { p_token: o.token, p_reason: o.error });
        counts.tokens_disabled++;
      }
    }
    const accepted = mine.filter((o) => o.ticketId);
    if (accepted.length > 0) {
      await supa.rpc('player_notification_sent', {
        p_id: row.id,
        p_tickets: accepted.map((o) => ({ token: o.token, id: o.ticketId })),
      });
      counts.push_sent++;
    } else if (mine.every((o) => isDeadDevice(o.error))) {
      await supa.rpc('player_notification_skipped', { p_id: row.id, p_reason: 'no_token' });
      counts.skipped++;
    } else {
      await supa.rpc('player_notification_failed', { p_id: row.id, p_error: mine[0]?.error ?? 'expo error' });
      counts.failed++;
    }
  }

  // ── 2. email ───────────────────────────────────────────────────────
  const resendKey = Deno.env.get('RESEND_API_KEY');
  for (const row of rows.filter((r) => r.channel === 'email')) {
    if (!row.email) {
      await supa.rpc('player_notification_skipped', { p_id: row.id, p_reason: 'no_email' });
      counts.skipped++;
      continue;
    }
    if (!resendKey) {
      await supa.rpc('player_notification_skipped', { p_id: row.id, p_reason: 'no_email_channel' });
      counts.skipped++;
      continue;
    }
    try {
      const e = renderEmail(row, SITE_ORIGIN);
      const id = await sendResend(row.email, e.subject, e.text, resendKey);
      await supa.rpc('player_notification_sent', { p_id: row.id, p_tickets: id ? [{ id }] : null });
      counts.email_sent++;
    } catch (err) {
      await supa.rpc('player_notification_failed', { p_id: row.id, p_error: err instanceof Error ? err.message : 'resend failed' });
      counts.failed++;
    }
  }

  // ── 3. receipts ────────────────────────────────────────────────────
  const { data: due, error: recErr } = await supa.rpc('player_notification_receipts', { p_limit: 100 });
  if (recErr) throw new Error(`player_notification_receipts failed: ${recErr.message}`);
  const dueRows = (due ?? []) as Array<{ id: string; expo_tickets: Array<{ token: string; id: string }> }>;
  const ids = dueRows.flatMap((r) => r.expo_tickets.map((t) => t.id));
  if (ids.length > 0) {
    let receipts: Record<string, { status: 'ok' | 'error'; details?: { error?: string } }> = {};
    try {
      const res = await fetch(EXPO_RECEIPTS_URL, { method: 'POST', headers: expoHeaders(), body: JSON.stringify({ ids }) });
      if (!res.ok) throw new Error(`expo receipts ${res.status}`);
      receipts = ((await res.json()) as { data?: typeof receipts }).data ?? {};
    } catch (err) {
      // Next tick asks again; nothing is marked.
      console.error(JSON.stringify({ level: 'error', event: 'expo_receipts_failed', detail: err instanceof Error ? err.message : String(err) }));
      return jsonResponse(counts, 200);
    }
    for (const r of dueRows) {
      let dead: string | null = null;
      for (const t of r.expo_tickets) {
        const rc = receipts[t.id];
        if (rc?.status === 'error' && isDeadDevice(rc.details?.error ?? null)) {
          await supa.rpc('disable_push_token', { p_token: t.token, p_reason: 'DeviceNotRegistered' });
          counts.tokens_disabled++;
          dead = 'DeviceNotRegistered';
        }
      }
      await supa.rpc('player_notification_receipt_checked', { p_id: r.id, p_error: dead });
      counts.receipts++;
    }
  }

  return jsonResponse(counts, 200);
}));
