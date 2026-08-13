import type { NextRequest } from 'next/server';

import { handleVerification } from '../verify';

/**
 * The target for Supabase's recommended OTP email template:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
 *
 * Identical behaviour to /auth/callback — both routes exist so either email
 * template works without the user having to reconfigure anything.
 */
export async function GET(request: NextRequest) {
  return handleVerification(request);
}
