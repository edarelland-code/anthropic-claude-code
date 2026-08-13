'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { createBrowser } from '@/lib/adapters/supabase/browser';

export function SignOutButton() {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await createBrowser().auth.signOut();
          router.replace('/login');
          router.refresh();
        })
      }
      className="rounded-md px-3 py-2.5 text-sm font-medium ring-1 ring-inset hairline hover:bg-black/[0.04] disabled:opacity-60 dark:hover:bg-white/[0.06]"
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
