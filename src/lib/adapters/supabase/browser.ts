import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

import { readEnv } from './env';

/**
 * Browser-side client. Used only for auth (sign in, sign out) — application
 * data is read and written through Server Components and Server Actions so the
 * database stays the single source of truth (CLAUDE.md rule 12).
 */
export function createBrowser(): SupabaseClient {
  const env = readEnv();
  if (!env) throw new Error('Supabase is not configured. See .env.example.');
  return createBrowserClient(env.url, env.publishableKey);
}
