/**
 * Environment reading, shared by the browser and server clients.
 * Kept free of `next/headers` so it is importable from either runtime.
 */

export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

export function readEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  // The placeholder from .env.example is not a configuration.
  if (url.includes('YOUR-PROJECT-REF')) return null;
  return { url, anonKey };
}

/** True when the app has real cloud credentials. Drives the setup screen. */
export function isConfigured(): boolean {
  return readEnv() !== null;
}
