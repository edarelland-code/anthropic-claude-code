import { redirect } from 'next/navigation';

import { isConfigured } from '@/lib/adapters/supabase/env';

/**
 * Must not be prerendered: it branches on environment configuration, which is a
 * property of the running server, not of the build. Statically rendered, this
 * would bake in whatever was configured at build time and keep redirecting
 * there even after the deployment's variables changed.
 */
export const dynamic = 'force-dynamic';

export default function RootPage() {
  redirect(isConfigured() ? '/home' : '/setup');
}
