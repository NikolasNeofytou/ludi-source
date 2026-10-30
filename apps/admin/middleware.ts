import { type NextRequest } from 'next/server';

import { contentSecurityPolicy, createNonce } from './lib/csp';
import { updateSession } from './lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  // A fresh nonce per request (lib/csp.ts). The policy goes on the request
  // too, because that is where Next.js reads the nonce it stamps on its
  // own scripts; `x-nonce` is there for any server component that renders
  // a <script> of its own.
  const nonce = createNonce();
  const csp = contentSecurityPolicy({
    nonce,
    dev: process.env.NODE_ENV === 'development',
    https: request.nextUrl.protocol === 'https:',
  });

  const response = await updateSession(request, {
    'x-nonce': nonce,
    'content-security-policy': csp,
  });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
