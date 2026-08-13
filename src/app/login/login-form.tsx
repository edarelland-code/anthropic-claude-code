'use client';

import { useState } from 'react';
import { Loader2, Mail } from 'lucide-react';

import { createBrowser } from '@/lib/adapters/supabase/browser';

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setState('sending');
    try {
      const supabase = createBrowser();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { error: signInError } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });
      if (signInError) throw new Error(signInError.message);
      setState('sent');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not send the link.');
      setState('idle');
    }
  }

  if (state === 'sent') {
    return (
      <div className="mt-8 rounded-lg p-4 surface">
        <p className="text-sm font-medium">Check your email</p>
        <p className="mt-1 text-sm leading-6 muted">
          A sign-in link is on its way to {email}. Open it on whichever machine you want to work
          from.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-3">
      <label htmlFor="email" className="block text-sm font-medium">
        Email
      </label>
      <div className="relative">
        <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 muted" aria-hidden />
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-md py-2.5 pl-9 pr-3 text-sm surface"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={state === 'sending'}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        {state === 'sending' && <Loader2 className="size-4 animate-spin" aria-hidden />}
        Send sign-in link
      </button>
    </form>
  );
}
