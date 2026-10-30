// _tests/admin-site.test.ts
// venue-connect-onboard's return URLs: the admin origin or nothing.

import { assertEquals } from 'std/assert/mod.ts';
import {
  adminReturnUrl,
  adminSiteOrigin,
  DEFAULT_ADMIN_SITE_URL,
} from '../_shared/admin-site.ts';

const ORIGIN = 'https://ludi-admin.vercel.app';

Deno.test('adminSiteOrigin: from ADMIN_SITE_URL, path and slash dropped', () => {
  assertEquals(adminSiteOrigin('https://ludi-admin.vercel.app/'), ORIGIN);
  assertEquals(adminSiteOrigin('http://localhost:3001/auth'), 'http://localhost:3001');
});

Deno.test('adminSiteOrigin: unset or junk falls back to the production admin', () => {
  assertEquals(adminSiteOrigin(''), new URL(DEFAULT_ADMIN_SITE_URL).origin);
  assertEquals(adminSiteOrigin('not a url'), new URL(DEFAULT_ADMIN_SITE_URL).origin);
});

Deno.test('adminReturnUrl: none given → the admin home page', () => {
  assertEquals(adminReturnUrl(undefined, ORIGIN), `${ORIGIN}/`);
});

Deno.test('adminReturnUrl: a path on the admin origin is kept', () => {
  assertEquals(
    adminReturnUrl(`${ORIGIN}/payments?from=stripe`, ORIGIN),
    `${ORIGIN}/payments?from=stripe`,
  );
});

Deno.test('adminReturnUrl: any other origin is refused', () => {
  for (const url of [
    'https://admin.ludi.app/venues/connect/return',
    'https://ludi-admin.vercel.app.example.com/',
    'http://ludi-admin.vercel.app/',
    'https://ludi-admin-git-branch.vercel.app/',
    'javascript:alert(1)',
    'not a url',
  ]) {
    assertEquals(adminReturnUrl(url, ORIGIN), null, url);
  }
});
