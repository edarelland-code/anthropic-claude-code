import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { readEnv } from './env';

/**
 * The service-role client, for the ingestion endpoint only.
 *
 * A delivery arrives with a token and no browser session, so there is no JWT
 * for a policy to read — the request has to be authenticated before the
 * database can be asked anything, and only a key with that reach can do the
 * asking. This is the single place in the product that constructs such a
 * client, and the single caller is `POST /api/ingest`.
 *
 * The reach is real, so it is fenced rather than trusted:
 *
 *   * `SUPABASE_SECRET_KEY` has no `NEXT_PUBLIC_` prefix, so Next.js will not
 *     bundle it into anything a browser receives.
 *   * The only thing this client is used for is `ingest_from_token()`, whose
 *     EXECUTE grant is service_role and nothing else, and which derives the
 *     workspace from the token row rather than from any argument.
 *   * It is never handed to a Server Component. Those get `createServer()`,
 *     which carries the visitor's own session.
 */
export function createServiceClient(): SupabaseClient | null {
  const env = readEnv();
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!env || !secret) return null;

  return createClient(env.url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Why ingestion is unavailable, for an operator reading a 503. */
export function ingestionConfigurationProblem(): string | null {
  if (!readEnv()) return 'Supabase is not configured.';
  if (!process.env.SUPABASE_SECRET_KEY) {
    return 'SUPABASE_SECRET_KEY is not set, so the ingestion endpoint cannot reach the database.';
  }
  return null;
}
