import { createServerClient, type CookieMethodsServer } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refreshes the auth session cookie on every request so Server Components can
 * read it. The database remains the source of truth; this only keeps the
 * device's session valid (ARCHITECTURE §4).
 */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // Unconfigured: let the app render its setup screen instead of erroring.
  if (!url || !publishableKey || url.includes('YOUR-PROJECT-REF')) return NextResponse.next();

  let response = NextResponse.next({ request });

  const cookieMethods: CookieMethodsServer = {
    getAll: () => request.cookies.getAll(),
    setAll: (toSet) => {
      for (const { name, value } of toSet) request.cookies.set(name, value);
      response = NextResponse.next({ request });
      for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
    },
  };

  const supabase = createServerClient(url, publishableKey, { cookies: cookieMethods });

  // A network failure here must not 500 the whole app. Treat an unreachable
  // auth service as "not signed in": the user lands on /login, which explains
  // itself, instead of on an unstyled error page.
  let user = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch (cause) {
    console.error('[contextshelf] auth check failed in middleware:', cause);
  }

  const path = request.nextUrl.pathname;
  // `/api/*` is exempt because it carries its OWN authentication: an ingestion
  // token in an Authorization header, not a session cookie. Redirecting it
  // would answer every delivery with a 307 to an HTML login page, which a
  // machine would report as a mysterious success. Exempt is not open — the
  // route rejects a request without a valid token itself, with a 401.
  const isPublic =
    path.startsWith('/login') ||
    path.startsWith('/auth') ||
    path.startsWith('/setup') ||
    path.startsWith('/api/');

  if (!user && !isPublic) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/login';
    redirect.searchParams.set('next', path);
    return NextResponse.redirect(redirect);
  }

  if (user && path === '/login') {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/home';
    redirect.search = '';
    return NextResponse.redirect(redirect);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
