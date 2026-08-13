import 'server-only';

import { createDataContext } from '@/lib/adapters/supabase/repositories';
import { createServer } from '@/lib/adapters/supabase/client';
import { isConfigured } from '@/lib/adapters/supabase/env';
import type { DataContext } from '@/lib/ports/repositories';

/**
 * The single entry point Server Components use to reach data.
 *
 * Swapping the persistence provider means changing the import on the next line
 * and nothing else in the application (CLAUDE.md rule 18 / AD-6).
 */
export async function getData(): Promise<DataContext> {
  const db = await createServer();
  return createDataContext(db);
}

export { isConfigured };
