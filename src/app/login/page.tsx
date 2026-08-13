import { redirect } from 'next/navigation';

import { isConfigured } from '@/lib/adapters/supabase/env';
import { LoginForm } from './login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  if (!isConfigured()) redirect('/setup');
  const { next, error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <p className="text-xs font-medium uppercase tracking-widest text-indigo-600">ContextShelf</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm leading-6 muted">
        A one-time link, so there is no password to sync between your machines. Sign in from any
        computer and the same shelf is there.
      </p>
      {error && (
        <p
          role="alert"
          className="mt-5 rounded-md border border-red-300 bg-red-50 px-3 py-2.5 text-sm leading-6 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <LoginForm next={next ?? '/home'} />
    </main>
  );
}
