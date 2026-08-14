'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, Copy, KeyRound, RefreshCw, ShieldOff, Terminal } from 'lucide-react';

import type { IngestionToken } from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';

import {
  createTokenAction,
  revokeTokenAction,
  type TokenFormState,
} from './actions';

/**
 * Claude Code Connection.
 *
 * The whole setup is meant to be: name it, create it, copy two lines into a
 * project, run one command. Nobody should have to open Supabase, Vercel or a
 * database to connect a repository — so nothing on this screen asks them to.
 *
 * The token appears once. That is a real cost to the user and it is the right
 * one: a token that could be re-read later would have to be stored in a form
 * that could be stolen later. The screen says so plainly at the moment it
 * matters, rather than leaving someone to discover it after navigating away.
 */

function Submit({ label, busy, icon }: { label: string; busy: string; icon?: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-indigo-600 px-3 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
    >
      {icon}
      {pending ? busy : label}
    </button>
  );
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          // Selecting is the fallback everywhere else in this app; here the
          // block is already selectable, so saying so is enough.
          setCopied(false);
        }
      }}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-xs ring-1 ring-inset hairline hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? 'Copied' : label}
    </button>
  );
}

export function ClaudeCodeConnection({
  tokens,
  topics,
  baseUrl,
}: {
  tokens: IngestionToken[];
  topics: Array<{ id: string; name: string }>;
  baseUrl: string;
}) {
  const [state, action] = useActionState<TokenFormState, FormData>(createTokenAction, {
    error: null,
  });
  const [rotating, setRotating] = useState<IngestionToken | null>(null);

  const live = tokens.filter((t) => t.revokedAt === null);
  const revoked = tokens.filter((t) => t.revokedAt !== null);

  return (
    <section className="mt-4 rounded-lg p-4 surface">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Terminal className="size-4 muted" aria-hidden />
        Claude Code connection
      </h2>
      <p className="mt-1 text-xs leading-5 muted">
        A token lets a Claude Code session send what it did — repository, branch, commit, the files
        it touched, whether the build and tests passed, the action it finished and the one it
        started — straight into a topic. It cannot approve a decision, replace Current State,
        reject an idea, pick a winning prompt or delete anything; those stay with you.
      </p>

      {/* The secret, shown once. */}
      {state.token && (
        <div className="mt-3 rounded-md p-3 ring-1 ring-inset ring-amber-600/40">
          <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
            Copy this now — it is not shown again, and it is not stored anywhere it could be read
            back.
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-black/[0.04] p-2 text-xs break-all dark:bg-white/[0.06]">
            {state.token}
          </pre>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CopyButton text={state.token} label="Copy token" />
            <CopyButton
              text={setupInstructions(baseUrl, state.token)}
              label="Copy setup instructions"
            />
          </div>
          {state.message && <p className="mt-2 text-xs muted">{state.message}</p>}
        </div>
      )}

      {/* Create, or rotate. */}
      <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
        {rotating && <input type="hidden" name="rotatedFromId" value={rotating.id} />}
        <label className="min-w-0 flex-1 text-xs font-medium">
          {rotating ? `Replacement for “${rotating.name}”` : 'Name this machine or repository'}
          <input
            name="name"
            required
            maxLength={80}
            defaultValue={rotating ? `${rotating.name} (rotated)` : ''}
            placeholder="Work laptop · dailyrelay"
            className="mt-1 min-h-11 w-full rounded-md border-0 px-2.5 text-sm ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
            style={{ background: 'var(--background)' }}
          />
        </label>
        <label className="min-w-0 text-xs font-medium">
          Default topic
          <select
            name="scopeTopicId"
            defaultValue={rotating?.scopeTopicId ?? ''}
            className="mt-1 min-h-11 w-full rounded-md border-0 px-2 text-sm ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
            style={{ background: 'var(--background)' }}
          >
            <option value="">None — each delivery names its own</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <Submit
          label={rotating ? 'Create replacement' : 'Create token'}
          busy="Creating…"
          icon={<KeyRound className="size-3.5" aria-hidden />}
        />
        {rotating && (
          <button
            type="button"
            onClick={() => setRotating(null)}
            className="inline-flex min-h-11 items-center rounded-md px-2.5 text-xs muted ring-1 ring-inset hairline"
          >
            Cancel
          </button>
        )}
      </form>
      {state.error && (
        <p role="alert" className="mt-2 text-xs text-rose-600 dark:text-rose-400">
          {state.error}
        </p>
      )}

      {live.length === 0 && revoked.length === 0 ? (
        <p className="mt-3 text-sm muted">No tokens yet. Nothing can deliver into this workspace.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {[...live, ...revoked].map((t) => (
            <TokenRow
              key={t.id}
              token={t}
              topicName={topics.find((x) => x.id === t.scopeTopicId)?.name ?? null}
              onRotate={() => setRotating(t)}
            />
          ))}
        </ul>
      )}

      <details className="mt-4 border-t pt-3 text-xs hairline">
        <summary className="cursor-pointer font-medium">How to connect a project</summary>
        <ol className="mt-2 space-y-2 leading-5 muted">
          <li>
            <span className="font-medium">1.</span> Create a token above and copy it.
          </li>
          <li>
            <span className="font-medium">2.</span> In the project, put it where secrets already
            live — an environment variable, or a git-ignored file. Never in{' '}
            <code>CLAUDE.md</code>, and never committed.
          </li>
          <li>
            <span className="font-medium">3.</span> Run{' '}
            <code>npm run contextshelf:sync -- --check</code> once to confirm the connection, then{' '}
            <code>npm run contextshelf:sync</code> whenever you want the session recorded.
          </li>
        </ol>
        <pre className="mt-2 overflow-x-auto rounded bg-black/[0.04] p-2 text-[11px] leading-5 dark:bg-white/[0.06]">
          {setupInstructions(baseUrl, 'cs_live_…the token you copied…')}
        </pre>
        <p className="mt-2 muted">
          The command prints what it is about to send and never prints the token itself.
        </p>
      </details>
    </section>
  );
}

function TokenRow({
  token,
  topicName,
  onRotate,
}: {
  token: IngestionToken;
  topicName: string | null;
  onRotate: () => void;
}) {
  const [state, action] = useActionState<TokenFormState, FormData>(revokeTokenAction, {
    error: null,
  });
  const isRevoked = token.revokedAt !== null;

  return (
    <li className={`rounded-md p-3 ring-1 ring-inset hairline ${isRevoked ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium break-words">{token.name}</span>
        <code className="rounded bg-black/[0.04] px-1.5 py-0.5 text-[11px] dark:bg-white/[0.06]">
          {token.tokenPrefix ?? 'cs_live_…'}…
        </code>
        {isRevoked && (
          <span className="text-[11px] font-medium uppercase tracking-wider text-rose-600 dark:text-rose-400">
            Revoked
          </span>
        )}
        <span className="ml-auto shrink-0 text-xs muted">
          {token.lastUsedAt ? `Last used ${formatDate(token.lastUsedAt)}` : 'Never used'}
        </span>
      </div>
      <p className="mt-1 text-xs muted">
        {topicName ? `Defaults to ${topicName}.` : 'Every delivery names its own topic.'} Created{' '}
        {formatDate(token.createdAt)}.
        {isRevoked && token.revokedAt ? ` Revoked ${formatDate(token.revokedAt)}.` : ''}
      </p>

      {!isRevoked && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRotate}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-xs ring-1 ring-inset hairline hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
          >
            <RefreshCw className="size-3.5" aria-hidden />
            Rotate
          </button>
          <form action={action}>
            <input type="hidden" name="id" value={token.id} />
            <button
              type="submit"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-xs text-rose-600 ring-1 ring-inset hairline hover:bg-rose-500/10 dark:text-rose-400"
            >
              <ShieldOff className="size-3.5" aria-hidden />
              Revoke
            </button>
          </form>
          {state.error && (
            <span role="alert" className="text-xs text-rose-600 dark:text-rose-400">
              {state.error}
            </span>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * The two lines a project needs.
 *
 * Written as shell exports rather than a file, because an environment variable
 * cannot be committed by accident and a config file can.
 */
function setupInstructions(baseUrl: string, token: string): string {
  return [
    `export CONTEXTSHELF_URL="${baseUrl}"`,
    `export CONTEXTSHELF_TOKEN="${token}"`,
    '',
    '# optional: the topic this repository maps to',
    '# export CONTEXTSHELF_TOPIC_ID="…"',
    '',
    'npm run contextshelf:sync -- --check',
  ].join('\n');
}
