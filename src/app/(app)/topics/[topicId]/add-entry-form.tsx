'use client';

import { useActionState, useRef } from 'react';
import { useFormStatus } from 'react-dom';

import { KNOWLEDGE_TYPE_META } from '@/lib/domain/knowledge';
import { KNOWLEDGE_TYPES, type Subtopic } from '@/lib/domain/types';

import { createEntryAction, type FormState } from '../actions';

const initial: FormState = { error: null };

/** Sources are recorded as metadata on the entry — never as its container. */
const SOURCE_CHOICES = [
  { value: 'manual', label: 'Manual' },
  { value: 'claude_chat', label: 'Claude Chat' },
  { value: 'claude_cowork', label: 'Cowork' },
  { value: 'claude_code', label: 'Claude Code' },
  { value: 'url', label: 'URL' },
] as const;

export function AddEntryForm({ topicId, subtopics }: { topicId: string; subtopics: Subtopic[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(async (prev: FormState, fd: FormData) => {
    const result = await createEntryAction(prev, fd);
    if (!result.error) formRef.current?.reset();
    return result;
  }, initial);

  return (
    <form ref={formRef} action={formAction} className="mt-3 space-y-3">
      <input type="hidden" name="topicId" value={topicId} />

      <input
        name="title"
        required
        maxLength={300}
        placeholder="What happened, in one line"
        className="w-full rounded-md px-3 py-2.5 text-sm surface"
      />

      <textarea
        name="content"
        rows={3}
        maxLength={50_000}
        placeholder="Detail, reasoning, the prompt that worked, what broke…"
        className="w-full rounded-md px-3 py-2.5 text-sm surface"
      />

      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wider muted">Type</span>
          <select
            name="knowledgeType"
            defaultValue="progress"
            className="mt-1 w-full rounded-md px-2 py-2 text-sm surface"
          >
            {KNOWLEDGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {KNOWLEDGE_TYPE_META[t].label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wider muted">Source</span>
          <select
            name="sourceType"
            defaultValue="manual"
            className="mt-1 w-full rounded-md px-2 py-2 text-sm surface"
          >
            {SOURCE_CHOICES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wider muted">Subtopic</span>
          <select
            name="subtopicId"
            defaultValue=""
            className="mt-1 w-full rounded-md px-2 py-2 text-sm surface"
            disabled={subtopics.length === 0}
          >
            <option value="">{subtopics.length === 0 ? 'None yet' : 'Topic level'}</option>
            {subtopics.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-indigo-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
    >
      {pending ? 'Saving…' : 'Add entry'}
    </button>
  );
}
