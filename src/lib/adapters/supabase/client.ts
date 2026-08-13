import { createServerClient, type CookieMethodsServer } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

import { readEnv } from './env';

/**
 * Server-side client. Together with `./browser.ts` this is the ONLY place the
 * vendor SDK is constructed (CLAUDE.md rule 18); everything else goes through
 * the repository ports.
 */
export async function createServer(): Promise<SupabaseClient> {
  const env = readEnv();
  if (!env) throw new Error('Supabase is not configured. See .env.example.');
  const store = await cookies();

  const cookieMethods: CookieMethodsServer = {
    getAll: () => store.getAll(),
    setAll: (toSet) => {
      try {
        for (const { name, value, options } of toSet) store.set(name, value, options);
      } catch {
        // Called from a Server Component; middleware refreshes the session instead.
      }
    },
  };

  return createServerClient(env.url, env.publishableKey, { cookies: cookieMethods });
}

export { isConfigured, readEnv } from './env';
