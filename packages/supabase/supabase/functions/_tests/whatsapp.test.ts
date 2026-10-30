// _tests/whatsapp.test.ts
// The booking desk's WhatsApp edges (ADR-0046): Meta's signature, the text
// messages inside a webhook payload, and the reply shape.

import { assert, assertEquals, assertFalse } from 'std/assert/mod.ts';
import { extractInboundTexts, textMessage, verifyMetaSignature } from '../_shared/whatsapp.ts';

const secret = 'test-app-secret';

async function sign(body: string, key = secret): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(body)));
  return 'sha256=' + [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const payload = {
  object: 'whatsapp_business_account',
  entry: [{
    id: 'WABA',
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '35799000000', phone_number_id: '1234567890' },
        contacts: [{ profile: { name: 'Kostas' }, wa_id: '35799333333' }],
        messages: [
          { from: '35799333333', id: 'wamid.A', timestamp: '1760000000', type: 'text', text: { body: 'αύριο στις 8;' } },
          { from: '35799333333', id: 'wamid.B', timestamp: '1760000001', type: 'image', image: { id: 'x' } },
        ],
        statuses: [{ id: 'wamid.Z', status: 'read' }],
      },
    }],
  }],
};

Deno.test('a body signed with the app secret verifies', async () => {
  const body = JSON.stringify(payload);
  assert(await verifyMetaSignature(body, await sign(body), secret));
});

Deno.test('a wrong secret, a changed body, a missing header do not', async () => {
  const body = JSON.stringify(payload);
  assertFalse(await verifyMetaSignature(body, await sign(body, 'other'), secret));
  assertFalse(await verifyMetaSignature(body + ' ', await sign(body), secret));
  assertFalse(await verifyMetaSignature(body, null, secret));
  assertFalse(await verifyMetaSignature(body, 'sha1=abc', secret));
});

Deno.test('only the text messages come out, with the sender\'s profile name', () => {
  const out = extractInboundTexts(payload);
  assertEquals(out.length, 1);
  assertEquals(out[0]!.phoneNumberId, '1234567890');
  assertEquals(out[0]!.waMessageId, 'wamid.A');
  assertEquals(out[0]!.name, 'Kostas');
  assertEquals(out[0]!.body, 'αύριο στις 8;');
  assertEquals(out[0]!.receivedAt, new Date(1760000000 * 1000).toISOString());
});

Deno.test('a payload of statuses only, or of nonsense, yields nothing', () => {
  assertEquals(extractInboundTexts({ entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1' }, statuses: [{}] } }] }] }), []);
  assertEquals(extractInboundTexts(null), []);
  assertEquals(extractInboundTexts({ entry: 'x' }), []);
});

Deno.test('the reply goes to digits only, as plain text', () => {
  const m = textMessage('+35799333333', 'Κλείσαμε!');
  assertEquals(m.to, '35799333333');
  assertEquals(m.type, 'text');
  assertEquals(m.text.body, 'Κλείσαμε!');
});
