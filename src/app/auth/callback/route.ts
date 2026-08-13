import type { NextRequest } from 'next/server';

import { handleVerification } from '../verify';

/** PKCE and OTP sign-in links both land here. */
export async function GET(request: NextRequest) {
  return handleVerification(request);
}
