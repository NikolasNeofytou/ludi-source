// _shared/whatsapp.ts
// The WhatsApp Business Cloud API, as far as the booking desk needs it
// (ADR-0046): Meta's webhook signature, the inbound text messages inside a
// webhook payload, and the outbound text reply. No SDK — the surface is
// three small shapes, and each is unit-tested in _tests/whatsapp.test.ts.

import { timingSafeEqual } from './secrets.ts';

/** Meta signs the raw body with the app secret: `sha256=<hex HMAC>`. */
export async function verifyMetaSignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!header || !header.startsWith('sha256=')) return false;
  const given = header.slice('sha256='.length).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  const expected = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(expected, given);
}

export interface InboundText {
  phoneNumberId: string;
  waMessageId: string;
  from: string;
  name: string | null;
  body: string;
  receivedAt: string;
}

type Change = {
  field?: string;
  value?: {
    metadata?: { phone_number_id?: string };
    contacts?: { wa_id?: string; profile?: { name?: string } }[];
    messages?: { from?: string; id?: string; timestamp?: string; type?: string; text?: { body?: string } }[];
  };
};

/**
 * The text messages in a webhook payload. Statuses (delivered, read),
 * reactions, media and anything else are ignored: the desk reads words.
 */
export function extractInboundTexts(payload: unknown): InboundText[] {
  const out: InboundText[] = [];
  const entries = (payload as { entry?: { changes?: Change[] }[] })?.entry;
  if (!Array.isArray(entries)) return out;
  for (const entry of entries) {
    for (const change of entry?.changes ?? []) {
      if (change?.field !== 'messages') continue;
      const value = change.value ?? {};
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      for (const m of value.messages ?? []) {
        if (m?.type !== 'text' || !m.id || !m.from || !m.text?.body) continue;
        const contact = (value.contacts ?? []).find((c) => c.wa_id === m.from);
        const seconds = Number(m.timestamp);
        out.push({
          phoneNumberId,
          waMessageId: m.id,
          from: m.from,
          name: contact?.profile?.name ?? null,
          body: m.text.body,
          receivedAt: Number.isFinite(seconds) && seconds > 0
            ? new Date(seconds * 1000).toISOString()
            : new Date().toISOString(),
        });
      }
    }
  }
  return out;
}

/** The free-form reply, allowed inside the 24-hour customer-service window. */
export function textMessage(toE164: string, body: string) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toE164.replace(/[^0-9]/g, ''),
    type: 'text',
    text: { preview_url: false, body },
  };
}

export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const GRAPH_VERSION = 'v21.0';
