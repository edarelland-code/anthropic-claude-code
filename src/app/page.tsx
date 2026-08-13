import { redirect } from 'next/navigation';

import { isConfigured } from '@/lib/adapters/supabase/env';

export default function RootPage() {
  redirect(isConfigured() ? '/home' : '/setup');
}
