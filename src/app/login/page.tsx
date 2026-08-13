import { redirect } from 'next/navigation';

import { isConfigured } from '@/lib/adapters/supabase/env';
import { LoginForm } from './login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (!isConfigured()) redirect('/setup');
  const { next } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12">
      <p className="text-xs font-medium uppercase tracking-widest text-indigo-600">ContextShelf</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm leading-6 muted">
        A one-time link, so there is no password to sync between your machines. Sign in from any
        computer and the same shelf is there.
      </p>
      <LoginForm next={next ?? '/home'} />
    </main>
  );
}
