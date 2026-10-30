// whatsapp-reply/index.ts
// POST /whatsapp-reply { inbox_id, text } — the owner answers a desk
// message that arrived on the venue's connected WhatsApp number, from that
// number (ADR-0046). A pasted message is answered from the owner's own
// phone with a wa.me link instead; this function refuses it.
//
//   JWT → Zod → the message, and the caller works at its venue (owner or
//   manager) → it came by WhatsApp, inside Meta's 24-hour window → the
//   venue's number → Graph API send → 200 { sent, id }
//
// WHATSAPP_TOKEN is the Cloud API access token of the system user that
// manages the venues' numbers; unset answers NOT_CONNECTED.

import { serve } from 'std/http/server.ts';
import { z } from 'zod';
import { withSentry } from '../_shared/sentry.ts';
import { getUserFromRequest } from '../_shared/auth.ts';
import { errorResponse, jsonResponse, preflightResponse } from '../_shared/errors.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { GRAPH_VERSION, REPLY_WINDOW_MS, textMessage } from '../_shared/whatsapp.ts';

const Input = z.object({
  inbox_id: z.string().uuid(),
  text: z.string().trim().min(1).max(1000),
});

serve(withSentry(async (req) => {
  if (req.method === 'OPTIONS') return preflightResponse();
  if (req.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 'Use POST', 405);

  const user = await getUserFromRequest(req);
  if (!user) return errorResponse('UNAUTHORIZED', 'Missing or invalid token', 401);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorResponse('VALIDATION_FAILED', 'Body must be valid JSON', 400);
  }
  const parsed = Input.safeParse(raw);
  if (!parsed.success) {
    return errorResponse('VALIDATION_FAILED', 'Input failed validation', 400, { issues: parsed.error.issues });
  }

  const supa = createServiceClient();
  const { data: msg } = await supa
    .from('venue_inbox')
    .select('id, venue_id, source, sender_phone_e164, received_at')
    .eq('id', parsed.data.inbox_id)
    .maybeSingle();
  if (!msg) return errorResponse('NOT_FOUND', 'No such message', 404);

  const { data: staff } = await supa
    .from('venue_owners')
    .select('user_id')
    .eq('venue_id', msg.venue_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!staff) return errorResponse('NOT_AUTHORIZED', 'Not your venue', 403);

  if (msg.source !== 'whatsapp' || !msg.sender_phone_e164) {
    return errorResponse('NOT_CONNECTED', 'This message did not come by WhatsApp', 409);
  }
  if (Date.now() - Date.parse(msg.received_at) > REPLY_WINDOW_MS) {
    return errorResponse('WINDOW_CLOSED', 'WhatsApp only allows a free reply within 24 hours', 409);
  }

  const token = Deno.env.get('WHATSAPP_TOKEN');
  const { data: number } = await supa
    .from('venue_whatsapp_numbers')
    .select('phone_number_id')
    .eq('venue_id', msg.venue_id)
    .maybeSingle();
  if (!token || !number) return errorResponse('NOT_CONNECTED', 'The venue number is not connected', 409);

  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${number.phone_number_id}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(textMessage(msg.sender_phone_e164, parsed.data.text)),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(JSON.stringify({ level: 'error', event: 'whatsapp_reply_failed', status: res.status }));
    return errorResponse('WHATSAPP_ERROR', 'WhatsApp refused the message', 502, {
      code: (body as { error?: { code?: number } })?.error?.code ?? null,
    });
  }
  const id = (body as { messages?: { id?: string }[] })?.messages?.[0]?.id ?? null;
  return jsonResponse({ sent: true, id }, 200);
}));
