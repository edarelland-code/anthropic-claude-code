'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { FolderTree } from 'lucide-react';

import { SegmentEditor, type EditableSegment } from '@/components/capture/segment-editor';
import { SuggestedChip } from '@/components/ui/suggestion';
import type { Topic } from '@/lib/domain/types';

import { processAction, type FormState } from '../actions';

export type TriageSegment = EditableSegment;

/**
 * The confirm gate.
 *
 * Every suggestion on this screen — the topic, and each proposed knowledge type
 * — is a pre-filled control the user can change, never a value already applied.
 * The topic select starts on the suggestion because a wrong preselection costs
 * one click to fix and is visible in the control itself; the segment rows start
 * excluded because a wrong inclusion writes a permanent record and is not.
 */
function FileButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
    >
      {pending ? 'Filing…' : 'File these entries'}
    </button>
  );
}

export function TriageForm({
  itemId,
  defaultTitle,
  segments,
  topics,
  subtopicsByTopic,
  suggestedTopicId,
  suggestedTopicBasis,
  suggestedTopicConfidence,
  extractionNotes,
}: {
  itemId: string;
  defaultTitle: string;
  segments: TriageSegment[];
  topics: Topic[];
  subtopicsByTopic: Record<string, { id: string; name: string }[]>;
  suggestedTopicId: string | null;
  suggestedTopicBasis: string[];
  suggestedTopicConfidence?: number;
  extractionNotes: string[];
}) {
  const [state, action] = useActionState<FormState, FormData>(processAction, { error: null });
  const [topicId, setTopicId] = useState(suggestedTopicId ?? '');
  const subtopics = subtopicsByTopic[topicId] ?? [];

  return (
    <form action={action}>
      <input type="hidden" name="id" value={itemId} />

      <section>
        <h2 className="text-xs font-medium uppercase tracking-wider muted">Where it belongs</h2>
        {extractionNotes.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs leading-5 muted">
            {extractionNotes.map((n) => (
              <li key={n}>· {n}</li>
            ))}
          </ul>
        )}

        <div className="mt-2 flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor="triage-topic" className="flex items-center gap-2 text-xs font-medium">
              <FolderTree className="size-3.5 muted" aria-hidden />
              Topic
              {suggestedTopicId && topicId === suggestedTopicId && (
                <SuggestedChip basis={suggestedTopicBasis} confidence={suggestedTopicConfidence} />
              )}
            </label>
            <select
              id="triage-topic"
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
            <div className="min-w-0 flex-1">
              <label htmlFor="triage-subtopic" className="text-xs font-medium">
                Subtopic
              </label>
              <select
                id="triage-subtopic"
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

        <div className="mt-3">
          <label htmlFor="triage-title" className="text-xs font-medium">
            Name this source
          </label>
          <input
            id="triage-title"
            name="title"
            type="text"
            maxLength={300}
            defaultValue={defaultTitle}
            placeholder="Icon exploration, 14 August"
            className="mt-1 min-h-11 w-full rounded-md border-0 px-2.5 text-sm ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
            style={{ background: 'var(--background)' }}
          />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-xs font-medium uppercase tracking-wider muted">What to record</h2>
        <div className="mt-2">
          <SegmentEditor segments={segments} />
        </div>
      </section>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <FileButton />
        {topics.length === 0 && (
          <span className="text-xs muted">Create a topic first — every record belongs to one.</span>
        )}
      </div>

      {state.error && (
        <p role="alert" className="mt-2 text-sm text-rose-600 dark:text-rose-400">
          {state.error}
        </p>
      )}
    </form>
  );
}
