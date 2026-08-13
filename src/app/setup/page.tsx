import { Database, KeyRound, Terminal } from 'lucide-react';

import { configurationProblem, isConfigured } from '@/lib/adapters/supabase/env';

// Same reason as `/`: this page reports the running server's configuration, so
// prerendering it would freeze the diagnostic at build time and make it lie.
export const dynamic = 'force-dynamic';

/**
 * Shown when no cloud credentials are present. ContextShelf has no local
 * fallback store on purpose — the cloud database is the only source of truth
 * (CLAUDE.md rule 12), so an unconfigured app says so instead of pretending.
 */
export default function SetupPage() {
  const configured = isConfigured();
  const problem = configurationProblem();

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-xs font-medium uppercase tracking-widest text-indigo-600">ContextShelf</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {configured ? 'Cloud database connected' : 'Connect a cloud database'}
      </h1>
      <p className="mt-3 text-sm leading-6 muted">
        ContextShelf keeps everything in a hosted Postgres database so the same shelf appears on
        every machine you sign in from. There is no local-only mode — your computer is never the
        source of truth.
      </p>

      {problem && (
        <p
          role="status"
          className="mt-5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm leading-6 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
        >
          {problem}
        </p>
      )}

      <ol className="mt-8 space-y-5">
        {[
          {
            icon: Database,
            title: 'Create a Supabase project',
            body: 'supabase.com → New project. Any region near you is fine.',
          },
          {
            icon: KeyRound,
            title: 'Copy .env.example to .env.local',
            body: 'Fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY from Project Settings → API Keys. The publishable key starts with sb_publishable_.',
          },
          {
            icon: Terminal,
            title: 'Apply the schema',
            body: 'supabase link --project-ref <ref> && npm run db:push — this creates the tables, the row-level security policies, and the append-only guarantees.',
          },
        ].map(({ icon: Icon, title, body }, i) => (
          <li key={title} className="flex gap-4 rounded-lg p-4 surface">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-slate-100 dark:bg-white/5">
              <Icon className="size-4" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-medium break-words">
                <span className="muted tabular-nums">{i + 1}. </span>
                {title}
              </h2>
              <p className="mt-1 break-words text-sm leading-6 muted">{body}</p>
            </div>
          </li>
        ))}
      </ol>

      {configured && (
        <a
          href="/home"
          className="mt-8 inline-flex rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Open ContextShelf
        </a>
      )}
    </main>
  );
}
