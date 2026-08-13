import { Check, Cloud, Database, Minus } from 'lucide-react';

import { getData } from '@/lib/data';

import { SignOutButton } from './sign-out-button';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const data = await getData();
  const user = await data.auth.getUser();
  const workspace = await data.workspaces.getDefault();
  const host = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
    : 'not configured';

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:py-8">
      <h1 className="text-xl font-semibold tracking-tight">Settings</h1>

      <section className="mt-6 rounded-lg p-4 surface">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Cloud className="size-4 muted" aria-hidden />
          Account
        </h2>
        <dl className="mt-3 space-y-2 text-sm">
          <Row label="Signed in as" value={user?.email ?? '—'} />
          <Row label="Workspace" value={workspace?.name ?? '—'} />
        </dl>
        <div className="mt-4">
          <SignOutButton />
        </div>
      </section>

      <section className="mt-4 rounded-lg p-4 surface">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Database className="size-4 muted" aria-hidden />
          Data
        </h2>
        <dl className="mt-3 space-y-2 text-sm">
          <Row label="Database" value={host} />
          <Row label="Source of truth" value="Cloud — your computer is a cache only" />
        </dl>
        <ul className="mt-4 space-y-2 border-t pt-4 text-sm hairline">
          <Capability done label="Row-level security scoped to your account" />
          <Capability done label="Append-only prompt and entry versions" />
          <Capability done label="Soft delete with a recoverable tombstone" />
          <Capability label="JSON export and import" phase={3} />
          <Capability label="Version recovery UI" phase={3} />
          <Capability label="Ingestion tokens for Claude Code" phase={5} />
        </ul>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="muted">{label}</dt>
      <dd className="truncate text-right">{value}</dd>
    </div>
  );
}

function Capability({ label, done, phase }: { label: string; done?: boolean; phase?: number }) {
  return (
    <li className="flex items-center gap-2">
      {done ? (
        <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
      ) : (
        <Minus className="size-4 shrink-0 muted" aria-hidden />
      )}
      <span className={done ? '' : 'muted'}>{label}</span>
      {!done && phase && <span className="ml-auto text-xs muted">Phase {phase}</span>}
    </li>
  );
}
