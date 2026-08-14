import { Check, Cloud, Database, Minus, Trash2 } from 'lucide-react';

import { getData } from '@/lib/data';
import { formatDate } from '@/lib/utils';

import { ClaudeCodeConnection } from './claude-code-connection';
import { RestoreButton } from './restore-button';
import { SignOutButton } from './sign-out-button';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const data = await getData();
  const user = await data.auth.getUser();
  const workspace = await data.workspaces.getDefault();
  const host = process.env.NEXT_PUBLIC_SUPABASE_URL
    ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host
    : 'not configured';

  // Tombstones, newest first. Restored ones are included so the log reads as a
  // history of deletions rather than a queue that empties.
  const deleted = workspace ? await data.recycle.list(workspace.id, true) : [];
  const recoverable = deleted.filter((d) => d.restoredAt === null);

  const tokens = workspace ? await data.tokens.list(workspace.id) : [];
  const topics = workspace ? await data.topics.list(workspace.id) : [];
  // The endpoint's own origin, so the setup block a user copies points at the
  // deployment they are actually looking at rather than at a hard-coded host.
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://contextshelf.vercel.app';

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
          <Capability done label="Structured JSON import with a preview" />
          <Capability done label="Full-text search across every record type" />
          <Capability done label="Ingestion tokens for Claude Code, with idempotent delivery" />
          <Capability label="JSON export" phase={6} />
          <Capability label="File uploads to an object store" phase={6} />
        </ul>
      </section>

      <ClaudeCodeConnection
        tokens={tokens}
        topics={topics.map((t) => ({ id: t.topic.id, name: t.topic.name }))}
        baseUrl={baseUrl}
      />

      {/*
        Recovery.
        Deleting in ContextShelf sets a timestamp and writes the whole row into
        deletion_log, so a delete is a state a record is in rather than an
        event that destroyed it (rule 5). Restoring reads that tombstone back.

        What is absent is as deliberate as what is here: prompt versions, entry
        versions, Layer 1 transcripts and inbox captures never appear, because
        the database refuses to delete them at all.
      */}
      <section className="mt-4 rounded-lg p-4 surface">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Trash2 className="size-4 muted" aria-hidden />
          Deleted records
        </h2>
        <p className="mt-1 text-xs leading-5 muted">
          Deleting hides a record and keeps a full copy of it. Nothing in ContextShelf is
          destroyed — append-only history, source transcripts and captured items cannot be deleted
          at all.
        </p>

        {deleted.length === 0 ? (
          <p className="mt-3 text-sm muted">Nothing has been deleted.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {deleted.map((d) => (
              <li
                key={d.id}
                className={`rounded-md p-3 ring-1 ring-inset hairline ${
                  d.restoredAt ? 'opacity-60' : ''
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wider muted">
                    {d.entityType.replace(/_/g, ' ')}
                  </span>
                  <span className="text-sm font-medium break-words">{d.title}</span>
                  <time className="ml-auto shrink-0 text-xs tabular-nums muted" dateTime={d.deletedAt}>
                    {formatDate(d.deletedAt)}
                  </time>
                </div>
                {d.reason && <p className="mt-1 text-xs leading-5 muted">{d.reason}</p>}
                <div className="mt-2">
                  {d.restoredAt ? (
                    <span className="text-xs muted">Restored {formatDate(d.restoredAt)}</span>
                  ) : (
                    <RestoreButton deletionLogId={d.id} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {recoverable.length > 0 && (
          <p className="mt-3 text-xs muted">
            {recoverable.length} {recoverable.length === 1 ? 'record is' : 'records are'}{' '}
            recoverable.
          </p>
        )}
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
