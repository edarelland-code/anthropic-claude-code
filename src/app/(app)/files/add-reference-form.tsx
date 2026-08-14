'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, ChevronDown, Link2, Plus } from 'lucide-react';

import type { Topic } from '@/lib/domain/types';

import { createFileReferenceAction, type FormState } from './actions';

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
    >
      {pending ? 'Saving…' : 'Save reference'}
    </button>
  );
}

/**
 * Adds a file or URL reference.
 *
 * The wording is deliberate throughout: "reference", "points at", "not
 * downloaded". This records where something lives; it does not hold a copy. A
 * form that implied otherwise would be the same failure as a fake sync
 * indicator (rule 13) — a UI claiming a capability the system does not have.
 */
export function AddReferenceForm({
  topics,
  subtopicsByTopic,
}: {
  topics: Topic[];
  subtopicsByTopic: Record<string, { id: string; name: string }[]>;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'repo_file' | 'url'>('repo_file');
  const [topicId, setTopicId] = useState('');
  const [state, action] = useActionState<FormState, FormData>(createFileReferenceAction, {
    error: null,
  });
  const subtopics = subtopicsByTopic[topicId] ?? [];

  return (
    <div className="rounded-lg surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium"
      >
        <Plus className="size-4 muted" aria-hidden />
        Add a file or link reference
        <ChevronDown
          className={`ml-auto size-4 muted transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <form action={action} className="border-t px-4 pb-4 pt-3 hairline">
          <fieldset>
            <legend className="text-xs font-medium">What are you pointing at?</legend>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {(
                [
                  ['repo_file', 'A file in a repository'],
                  ['url', 'A link'],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className={`inline-flex min-h-11 cursor-pointer items-center rounded-full px-3 text-xs ring-1 ring-inset ${
                    kind === value
                      ? 'bg-indigo-600 font-medium text-white ring-indigo-600'
                      : 'hairline'
                  }`}
                >
                  <input
                    type="radio"
                    name="kind"
                    value={value}
                    checked={kind === value}
                    onChange={() => setKind(value)}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          {kind === 'repo_file' ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="file-path" className="text-xs font-medium">
                  Path
                </label>
                <input
                  id="file-path"
                  name="path"
                  type="text"
                  required
                  placeholder="src/components/icon.tsx"
                  className="mt-1 min-h-11 w-full rounded-md border-0 px-2.5 font-mono text-sm ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
                  style={{ background: 'var(--background)' }}
                />
              </div>
              <div>
                <label htmlFor="file-repo" className="text-xs font-medium">
                  Repository <span className="muted">(optional)</span>
                </label>
                <input
                  id="file-repo"
                  name="repoUrl"
                  type="text"
                  placeholder="github.com/you/project"
                  className="mt-1 min-h-11 w-full rounded-md border-0 px-2.5 text-sm ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
                  style={{ background: 'var(--background)' }}
                />
              </div>
              <div>
                <label htmlFor="file-branch" className="text-xs font-medium">
                  Branch <span className="muted">(optional)</span>
                </label>
                <input
                  id="file-branch"
                  name="branch"
                  type="text"
                  placeholder="main"
                  className="mt-1 min-h-11 w-full rounded-md border-0 px-2.5 text-sm ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
                  style={{ background: 'var(--background)' }}
                />
              </div>
            </div>
          ) : (
            <div className="mt-3">
              <label htmlFor="file-url" className="text-xs font-medium">
                URL
              </label>
              <input
                id="file-url"
                name="url"
                type="url"
                required
                placeholder="https://…"
                className="mt-1 min-h-11 w-full rounded-md border-0 px-2.5 text-sm ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
                style={{ background: 'var(--background)' }}
              />
              <p className="mt-1 text-xs muted">
                The link is recorded. The page is not downloaded, so nothing here claims to know
                what it says.
              </p>
            </div>
          )}

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="file-name" className="text-xs font-medium">
                Label <span className="muted">(optional)</span>
              </label>
              <input
                id="file-name"
                name="displayName"
                type="text"
                maxLength={300}
                className="mt-1 min-h-11 w-full rounded-md border-0 px-2.5 text-sm ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
                style={{ background: 'var(--background)' }}
              />
            </div>
            <div>
              <label htmlFor="file-topic" className="text-xs font-medium">
                Topic
              </label>
              <select
                id="file-topic"
                name="topicId"
                required
                value={topicId}
                onChange={(e) => setTopicId(e.target.value)}
                className="mt-1 min-h-11 w-full rounded-md border-0 px-2 text-sm ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
                style={{ background: 'var(--background)' }}
              >
                <option value="">Choose a topic…</option>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            {subtopics.length > 0 && (
              <div>
                <label htmlFor="file-subtopic" className="text-xs font-medium">
                  Subtopic <span className="muted">(optional)</span>
                </label>
                <select
                  id="file-subtopic"
                  name="subtopicId"
                  className="mt-1 min-h-11 w-full rounded-md border-0 px-2 text-sm ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
                  style={{ background: 'var(--background)' }}
                >
                  <option value="">None</option>
                  {subtopics.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <SaveButton />
            <p aria-live="polite" className="text-xs">
              {state.error ? (
                <span className="text-rose-600 dark:text-rose-400">{state.error}</span>
              ) : state.message ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                  <Check className="size-3.5" aria-hidden />
                  {state.message}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 muted">
                  <Link2 className="size-3.5" aria-hidden />
                  Stored as a pointer, not a copy.
                </span>
              )}
            </p>
          </div>
        </form>
      )}
    </div>
  );
}
