'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Pencil, PlayCircle } from 'lucide-react';

import { updateSubtopicResumeAction, type FormState } from '@/app/(app)/topics/actions';
import type { Subtopic } from '@/lib/domain/types';

/**
 * A subtopic's own state and Resume Trigger.
 *
 * The trigger matters more here than at topic level: "what was I doing" is
 * usually a question about one part of a project. Editing it counts as
 * meaningful work, so it moves the freshness clock — a rename does not (AD-10).
 *
 * Only Resume-relevant fields are editable here. This is not a subtopic editor;
 * widening it would be redesigning the Topic page, which Phase 4 was told not
 * to do.
 */
function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 items-center rounded-md bg-indigo-600 px-3 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
    >
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}

const fieldClass =
  'mt-1 w-full rounded-md border-0 px-2.5 py-2 text-sm ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500';

export function SubtopicResume({ subtopic, topicId }: { subtopic: Subtopic; topicId: string }) {
  const [editing, setEditing] = useState(false);
  const [state, action] = useActionState<FormState, FormData>(async (prev, fd) => {
    const result = await updateSubtopicResumeAction(prev, fd);
    if (!result.error) setEditing(false);
    return result;
  }, { error: null });

  const hasTrigger = Boolean(subtopic.resumeTriggerIf || subtopic.resumeTriggerThen);

  if (!editing) {
    return (
      <div className="mt-2 space-y-2">
        {subtopic.currentState && (
          <p className="text-xs leading-5 break-words">
            <span className="font-medium muted">Where it stands: </span>
            {subtopic.currentState}
          </p>
        )}

        {hasTrigger ? (
          <div className="rounded-md p-2 text-xs leading-5 ring-1 ring-inset hairline">
            <p>
              <span className="font-medium">IF</span> {subtopic.resumeTriggerIf ?? '—'}
            </p>
            <p>
              <span className="font-medium">THEN</span> {subtopic.resumeTriggerThen ?? '—'}
            </p>
          </div>
        ) : (
          <p className="text-xs muted">No resume trigger for this subtopic yet.</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/topics/${topicId}/resume?subtopic=${subtopic.id}`}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ring-1 ring-inset hairline hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
          >
            <PlayCircle className="size-3.5" aria-hidden />
            Resume this subtopic
          </Link>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-xs muted ring-1 ring-inset hairline hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
          >
            <Pencil className="size-3.5" aria-hidden />
            Edit
          </button>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="mt-2 space-y-2">
      <input type="hidden" name="subtopicId" value={subtopic.id} />
      <input type="hidden" name="topicId" value={topicId} />
      <input type="hidden" name="expectedUpdatedAt" value={subtopic.updatedAt} />

      <label className="block text-xs font-medium">
        Where this stands
        <textarea
          name="currentState"
          rows={2}
          maxLength={4000}
          defaultValue={subtopic.currentState ?? ''}
          className={`${fieldClass} resize-y`}
          style={{ background: 'var(--background)' }}
        />
      </label>

      <fieldset>
        <legend className="text-xs font-medium">Resume trigger</legend>
        <label className="mt-1 block text-xs muted">
          IF
          <input
            name="resumeTriggerIf"
            maxLength={500}
            defaultValue={subtopic.resumeTriggerIf ?? ''}
            placeholder={`I return to ${subtopic.name}`}
            className={fieldClass}
            style={{ background: 'var(--background)' }}
          />
        </label>
        <label className="mt-1.5 block text-xs muted">
          THEN
          <input
            name="resumeTriggerThen"
            maxLength={500}
            defaultValue={subtopic.resumeTriggerThen ?? ''}
            placeholder="the specific next action"
            className={fieldClass}
            style={{ background: 'var(--background)' }}
          />
        </label>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <Save />
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="inline-flex min-h-11 items-center rounded-md px-2.5 text-xs muted ring-1 ring-inset hairline"
        >
          Cancel
        </button>
        {state.error && (
          <span role="alert" className="text-xs text-rose-600 dark:text-rose-400">
            {state.error}
          </span>
        )}
      </div>
    </form>
  );
}
