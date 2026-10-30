// whatsapp-inbound/index.ts
// The booking desk's webhook (plans/whatsapp-desk.md, ADR-0046): Meta posts
// every message a customer sends to a venue's connected WhatsApp number;
// the text ones land in that venue's desk. Nothing is answered from here —
// the owner reads, confirms, and replies from the dashboard.
//
//   GET   — Meta's subscription handshake: hub.verify_token must equal
//           WHATSAPP_VERIFY_TOKEN; answer hub.challenge.
//   POST  — X-Hub-Signature-256 must be the HMAC of the raw body under
//           WHATSAPP_APP_SECRET; then each text message is handed to
//           desk_receive_whatsapp (service role), which ignores numbers no
//           venue connected and redeliveries of a message already stored.
//
// verify_jwt is off (config.toml): Meta authenticates by signature, the
// stripe-webhook precedent. Missing configuration answers 503, so a
// half-set-up environment fails visibly in Meta's webhook log.

import { serve } from 'std/http/server.ts';
import { withSentry } from '../_shared/sentry.ts';
import { secretMatches } from '../_shared/secrets.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { extractInboundTexts, verifyMetaSignature } from '../_shared/whatsapp.ts';

serve(withSentry(async (req) => {
  const verifyToken = Deno.env.get('WHATSAPP_VERIFY_TOKEN');
  const appSecret = Deno.env.get('WHATSAPP_APP_SECRET');
  if (!verifyToken || !appSecret) {
    return new Response('not configured', { status: 503 });
  }

  if (req.method === 'GET') {
    const url = new URL(req.url);
    if (
      url.searchParams.get('hub.mode') === 'subscribe' &&
      secretMatches(url.searchParams.get('hub.verify_token'), verifyToken)
    ) {
      return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 });
    }
    return new Response('forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const raw = await req.text();
  if (!(await verifyMetaSignature(raw, req.headers.get('x-hub-signature-256'), appSecret))) {
    return new Response('bad signature', { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response('bad json', { status: 400 });
  }

  const supa = createServiceClient();
  let stored = 0;
  for (const m of extractInboundTexts(payload)) {
    const { data, error } = await supa.rpc('desk_receive_whatsapp', {
      p_phone_number_id: m.phoneNumberId,
      p_wa_message_id: m.waMessageId,
      p_from: m.from,
      p_name: m.name,
      p_body: m.body,
      p_received_at: m.receivedAt,
    });
    // A failure answers 500 so Meta redelivers; the unique message id makes
    // the retry harmless for the ones that did land.
    if (error) {
      console.error(JSON.stringify({ level: 'error', event: 'desk_receive_failed', code: error.code }));
      return new Response('store failed', { status: 500 });
    }
    if (data) stored++;
  }

  console.log(JSON.stringify({ level: 'info', event: 'whatsapp_inbound', stored }));
  return new Response('ok', { status: 200 });
}));
