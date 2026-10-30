// wallet-pass/index.ts
// GET /wallet-pass?ticket= — the caller's Ludi member card as a signed Apple
// Wallet pass (.pkpass). POST /wallet-pass mints the ticket. Plan: docs/plans/wallet-passes.md; design: the charcoal
// skin of the Factions card (memory: card-design-criteria) — charcoal
// ground, chalk ink, honour-gold labels, MEMBER <n> as the header field,
// the same /get?m= QR the in-app card carries.
//
// Auth, in two halves (security audit 2026-10-19). The add-to-wallet flow
// opens this URL in Safari, and the OS fetch that hands the file to Wallet
// cannot attach headers — so the GET has to authorise itself from its URL.
// That used to be ?token=<the caller's Supabase JWT>, which left a live
// session token in Safari's history and in every log the URL touched.
//   POST, with the caller's JWT as a bearer header, mints a ticket: a row in
//     wallet_pass_tickets (migration 20261020090000), random uuid, good for
//     sixty seconds. One live ticket per player.
//   GET ?ticket= redeems it by deleting the row, so it works once, and
//     returns that player's card. A JWT in the URL is no longer accepted.
// Self-view only by construction (the card is the ticket's owner's). The
// gateway's JWT check is off for this function (config.toml) because
// Safari's GET carries none.
//
// Signing: manifest.json lists SHA-1 digests of every file (Apple's pass
// spec); signature is a detached PKCS#7 over manifest.json made with the
// Pass Type ID key + cert, WWDR G4 included in the chain. Secrets are PEMs
// (APPLE_PASS_KEY_PEM / APPLE_PASS_CERT_PEM / APPLE_WWDR_PEM) — no p12,
// no password to manage.
//
// Static v1: no webServiceURL/authenticationToken (pass updates are a later
// version — see the plan's "Not in v1").

import { serve } from 'std/http/server.ts';
import forge from 'node-forge';
import * as jszip from 'jszip';
import { withSentry } from '../_shared/sentry.ts';
import { errorResponse } from '../_shared/errors.ts';
import { createAnonClient, createServiceClient } from '../_shared/supabase.ts';
import { ICONS, LOGOS, STRIPS } from './assets.ts';

// jszip ships `export =` types, which Deno releases read differently as a
// default import (2.7 accepts it, 2.9 rejects it), so the constructor is
// taken off the module object, typed by what this function uses.
type Zip = {
  file(name: string, data: Uint8Array): unknown;
  generateAsync(options: { type: 'arraybuffer' }): Promise<ArrayBuffer>;
};
const JSZip =
  (jszip as unknown as { default?: new () => Zip }).default ??
  (jszip as unknown as new () => Zip);

// Position line → factio (mirror of apps/mobile factions.ts — keep in sync).
// `key` picks the strip artwork; `latin` is the display tag.
const DEF = ['CB', 'LB', 'RB'];
const MID = ['CDM', 'CM', 'CAM'];
function factioFor(positions: string[]): { key: string; latin: string } {
  const p = positions[0];
  if (p === 'GK') return { key: 'aurata', latin: 'AVRATA' };
  if (p && DEF.includes(p)) return { key: 'veneta', latin: 'VENETA' };
  if (p && MID.includes(p)) return { key: 'prasina', latin: 'PRASINA' };
  if (p) return { key: 'russata', latin: 'RVSSATA' };
  return { key: 'albata', latin: 'ALBATA' };
}

function b64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesToForgeBuffer(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

function sha1Hex(bytes: Uint8Array): string {
  const md = forge.md.sha1.create();
  md.update(bytesToForgeBuffer(bytes));
  return md.digest().toHex();
}

// Detached PKCS#7 signature over manifest.json (signer cert + WWDR chain).
function signManifest(manifest: Uint8Array): Uint8Array {
  const keyPem = Deno.env.get('APPLE_PASS_KEY_PEM') ?? '';
  const certPem = Deno.env.get('APPLE_PASS_CERT_PEM') ?? '';
  const wwdrPem = Deno.env.get('APPLE_WWDR_PEM') ?? '';
  if (!keyPem || !certPem || !wwdrPem) {
    throw new Error('wallet-pass: missing APPLE_PASS_* secrets');
  }
  const key = forge.pki.privateKeyFromPem(keyPem);
  const cert = forge.pki.certificateFromPem(certPem);
  const wwdr = forge.pki.certificateFromPem(wwdrPem);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(bytesToForgeBuffer(manifest));
  p7.addCertificate(wwdr);
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return Uint8Array.from(der, (c: string) => c.charCodeAt(0));
}

const TICKET = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST: the app, signed in, asks for a ticket for the URL it will open.
async function mintTicket(req: Request): Promise<Response> {
  const header = req.headers.get('Authorization') ?? '';
  const jwt = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!jwt) return errorResponse('UNAUTHORIZED', 'Missing token', 401);
  const { data: authData, error: authErr } = await createAnonClient().auth.getUser(jwt);
  const userId = authData?.user?.id;
  if (authErr || !userId) return errorResponse('UNAUTHORIZED', 'Invalid token', 401);

  const supa = createServiceClient();
  // One live ticket per player, and nobody's expired ones linger.
  await supa.from('wallet_pass_tickets').delete().eq('user_id', userId);
  await supa.from('wallet_pass_tickets').delete().lt('expires_at', new Date().toISOString());
  const { data: row, error } = await supa
    .from('wallet_pass_tickets')
    .insert({ user_id: userId })
    .select('id')
    .single();
  if (error || !row) return errorResponse('DB_ERROR', 'Could not issue a ticket', 500);
  return new Response(JSON.stringify({ ticket: row.id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

serve(withSentry(async (req) => {
  if (req.method === 'POST') return mintTicket(req);
  if (req.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Use GET or POST', 405);
  }

  // 1. Auth — redeem the ticket. Deleting it is the redemption, so a second
  //    GET with the same ticket (a retry, a shared link, a log reader) finds
  //    nothing.
  const ticket = new URL(req.url).searchParams.get('ticket') ?? '';
  if (!TICKET.test(ticket)) return errorResponse('UNAUTHORIZED', 'Missing ticket', 401);
  const supa = createServiceClient();
  const { data: redeemed } = await supa
    .from('wallet_pass_tickets')
    .delete()
    .eq('id', ticket)
    .gt('expires_at', new Date().toISOString())
    .select('user_id')
    .maybeSingle();
  const userId = redeemed?.user_id as string | undefined;
  if (!userId) return errorResponse('UNAUTHORIZED', 'Ticket expired or already used', 401);

  // 2. The ticket owner's card substrate.
  const { data: row, error } = await supa
    .from('users')
    .select('first_name, last_name, member_no, skill_level, positions, created_at, cities(name_en)')
    .eq('id', userId)
    .single();
  if (error || !row) return errorResponse('DB_ERROR', 'Failed to load profile', 500);

  const fullName = `${row.first_name ?? ''} ${row.last_name ?? ''}`.trim() || 'Ludi player';
  const memberNo = row.member_no as number | null;
  const positions = (row.positions as string[]) ?? [];
  const cityRel = row.cities as { name_en: string } | { name_en: string }[] | null;
  const city = Array.isArray(cityRel) ? cityRel[0]?.name_en : cityRel?.name_en;
  const since = row.created_at
    ? new Date(row.created_at as string).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : null;

  const passTypeId = Deno.env.get('APPLE_PASS_TYPE_ID') ?? 'pass.football.ludi.member';
  const teamId = Deno.env.get('APPLE_TEAM_ID') ?? '';
  const qr = `https://ludi.football/get${memberNo != null ? `?m=${memberNo}` : ''}`;

  // 3. pass.json — storeCard style (membership cards' native style; it is
  //    the one that renders the strip artwork with the name overlaid, the
  //    same anatomy as the in-app card's hero).
  const factio = factioFor(positions);
  const passJson = {
    formatVersion: 1,
    passTypeIdentifier: passTypeId,
    teamIdentifier: teamId,
    serialNumber: memberNo != null ? `member-${memberNo}` : `member-${userId}`,
    organizationName: 'Ludi',
    description: 'Ludi member card',
    backgroundColor: 'rgb(10, 46, 61)',
    foregroundColor: 'rgb(251, 248, 240)',
    labelColor: 'rgb(217, 149, 32)',
    storeCard: {
      headerFields: [
        ...(memberNo != null
          ? [{ key: 'member', label: 'MEMBER', value: String(memberNo) }]
          : []),
      ],
      primaryFields: [{ key: 'name', value: fullName }],
      secondaryFields: [
        { key: 'factio', label: 'FACTIO', value: factio.latin },
        ...(city ? [{ key: 'city', label: 'CITY', value: city }] : []),
        { key: 'level', label: 'LEVEL', value: `${row.skill_level ?? 3}/5` },
        ...(since ? [{ key: 'since', label: 'SINCE', value: since }] : []),
      ],
      backFields: [
        {
          key: 'reputation',
          label: 'REPUTATION',
          value: 'Earned as you play — reliability, matches and ratings fill in from real games.',
        },
        { key: 'site', label: 'LUDI', value: 'https://ludi.football' },
        ...(memberNo != null
          ? [{ key: 'memberno', label: 'MEMBER NUMBER', value: String(memberNo) }]
          : []),
      ],
    },
    barcodes: [
      { format: 'PKBarcodeFormatQR', message: qr, messageEncoding: 'iso-8859-1', altText: 'ludi.football' },
    ],
  };

  // 4. Bundle: files → manifest (SHA-1) → detached signature → zip.
  const files = new Map<string, Uint8Array>();
  files.set('pass.json', new TextEncoder().encode(JSON.stringify(passJson)));
  for (const [name, b64] of Object.entries(ICONS)) files.set(name, b64ToBytes(b64));
  for (const [name, b64] of Object.entries(LOGOS)) files.set(name, b64ToBytes(b64));
  const strip = STRIPS[factio.key] ?? STRIPS['albata'];
  for (const [name, b64] of Object.entries(strip ?? {})) files.set(name, b64ToBytes(b64));

  const manifest: Record<string, string> = {};
  for (const [name, bytes] of files) manifest[name] = sha1Hex(bytes);
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));

  let signature: Uint8Array;
  try {
    signature = signManifest(manifestBytes);
  } catch (e) {
    console.error('wallet-pass: signing failed', { err: `${e}` });
    return errorResponse('INTERNAL_ERROR', 'Pass signing unavailable', 500);
  }

  const zip = new JSZip();
  for (const [name, bytes] of files) zip.file(name, bytes);
  zip.file('manifest.json', manifestBytes);
  zip.file('signature', signature);
  const pkpass = await zip.generateAsync({ type: 'arraybuffer' });

  return new Response(pkpass, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': 'attachment; filename="ludi-member.pkpass"',
      'Cache-Control': 'no-store',
    },
  });
}));
