import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// `forward` adds request headers the server render must see — the CSP and
// its nonce (middleware.ts). They are re-applied on top of the request's
// headers every time the response is rebuilt, so a refreshed auth cookie
// and the nonce both reach the page in the same request.
export async function updateSession(
  request: NextRequest,
  forward: Record<string, string> = {},
) {
  const next = () => {
    const headers = new Headers(request.headers);
    for (const [name, value] of Object.entries(forward)) headers.set(name, value);
    return NextResponse.next({ request: { headers } });
  };

  let supabaseResponse = next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[],
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = next();
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refreshing the auth token. Must be called between createServerClient and
  // returning supabaseResponse — otherwise the user session may silently expire.
  await supabase.auth.getUser();

  return supabaseResponse;
}
