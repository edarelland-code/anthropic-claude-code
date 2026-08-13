import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';

import { createServer } from '@/lib/adapters/supabase/client';
import { isConfigured } from '@/lib/adapters/supabase/env';

/**
 * Turns an email sign-in link into a session cookie.
 *
 * Two link shapes exist and both are handled, because which one arrives
 * depends on the project's email template:
 *
 *  - `?code=…`        PKCE. Requires the code_verifier cookie set when the link
 *                     was *requested*, so it only completes on the same device
 *                     and browser that asked for it.
 *  - `?token_hash=…`  OTP. Carries no device-bound secret, so it completes on
 *                     whichever device opens the email.
 *
 * The OTP shape is what makes "request on the Windows PC, click the link on
 * your phone" work. See docs/DEPLOYMENT.md for the email template that emits it.
 */
export async function handleVerification(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;

  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(reason)}`);

  if (!isConfigured()) return NextResponse.redirect(`${origin}/setup`);

  // Only ever redirect to a path on this origin — an open redirect here would
  // hand a freshly minted session to whatever host an attacker appended.
  const requested = searchParams.get('next') ?? '/home';
  const next = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/home';

  const supabaseError = searchParams.get('error_description') ?? searchParams.get('error');
  if (supabaseError) return fail(supabaseError);

  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = (searchParams.get('type') ?? 'email') as EmailOtpType;

  if (!code && !tokenHash) return fail('This sign-in link is missing its token.');

  try {
    const supabase = await createServer();

    const { error } = tokenHash
      ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      : await supabase.auth.exchangeCodeForSession(code!);

    if (error) {
      // Supabase's own wording here is user-facing and safe ("Email link is
      // invalid or has expired"). Anything unexpected is generalised below.
      return fail(error.message);
    }
  } catch {
    return fail('Could not reach the authentication service. Try again in a moment.');
  }

  return NextResponse.redirect(`${origin}${next}`);
}
