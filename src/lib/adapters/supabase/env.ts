/**
 * Environment reading, shared by the browser and server clients.
 * Kept free of `next/headers` so it is importable from either runtime.
 *
 * `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` holds Supabase's publishable key
 * (`sb_publishable_…`), which replaces the legacy anon JWT. It is designed to
 * be shipped to browsers: RLS is what protects the data, not the secrecy of
 * this value. The secret key is its counterpart and must never carry a
 * `NEXT_PUBLIC_` prefix.
 */

export interface SupabaseEnv {
  url: string;
  publishableKey: string;
}

const PLACEHOLDER = 'YOUR-PROJECT-REF';

export function readEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) return null;
  // The placeholder from .env.example is not a configuration.
  if (url.includes(PLACEHOLDER)) return null;
  return { url, publishableKey };
}

/** True when the app has real cloud credentials. Drives the setup screen. */
export function isConfigured(): boolean {
  return readEnv() !== null;
}

/**
 * Why configuration is incomplete, in a sentence the operator can act on.
 *
 * The legacy-variable case is called out by name because it is the likely
 * failure when following an older Supabase guide: the key is present and
 * valid, just under the name this app stopped reading.
 */
export function configurationProblem(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const legacyAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) return 'NEXT_PUBLIC_SUPABASE_URL is not set.';
  if (url.includes(PLACEHOLDER)) {
    return 'NEXT_PUBLIC_SUPABASE_URL is still the placeholder from .env.example.';
  }
  if (!publishableKey) {
    return legacyAnonKey
      ? 'NEXT_PUBLIC_SUPABASE_ANON_KEY is set but NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not. ContextShelf uses the publishable key (sb_publishable_…) from Project Settings → API Keys.'
      : 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set.';
  }
  return null;
}
