'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ArrowRight, Pencil } from 'lucide-react';

import { updateTopicAction, type FormState } from '../actions';

const initial: FormState = { error: null };

/**
 * The block that answers "where are we now" and "what should I do next".
 * Reads by default; edits in place. `expectedUpdatedAt` carries the optimistic
 * concurrency token so a change made on another machine surfaces as a conflict
 * rather than being silently overwritten (ARCHITECTURE §4.4).
 */
export function CurrentStateForm({
  topicId,
  expectedUpdatedAt,
  goal,
  currentState,
  progress,
  resumeTriggerIf,
  resumeTriggerThen,
  nextStep,
}: {
  topicId: string;
  expectedUpdatedAt: string;
  goal: string | null;
  currentState: string | null;
  progress: number;
  resumeTriggerIf: string | null;
  resumeTriggerThen: string | null;
  nextStep: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction] = useActionState(async (prev: FormState, fd: FormData) => {
    const result = await updateTopicAction(prev, fd);
    if (!result.error) setEditing(false);
    return result;
  }, initial);

  if (!editing) {
    return (
      <div className="mt-3 space-y-4">
        <Read label="Goal" value={goal} placeholder="No goal set." />
        <Read label="Current state" value={currentState} placeholder="Not written yet." />

        <div>
          <p className="text-xs font-medium uppercase tracking-wider muted">Next recommended action</p>
          {nextStep ? (
            <p className="mt-1 flex items-start gap-2 text-sm leading-6">
              <ArrowRight className="mt-1 size-3.5 shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden />
              {nextStep}
            </p>
          ) : (
            <p className="mt-1 text-sm muted">
              None set. Add a next step under Open issues.
            </p>
          )}
        </div>

        {(resumeTriggerIf || resumeTriggerThen) && (
          <div className="rounded-md border p-3 hairline">
            <p className="text-xs font-medium uppercase tracking-wider muted">Resume trigger</p>
            <p className="mt-1.5 text-sm leading-6">
              <span className="font-medium">IF</span> {resumeTriggerIf ?? '—'}
            </p>
            <p className="text-sm leading-6">
              <span className="font-medium">THEN</span> {resumeTriggerThen ?? '—'}
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:underline dark:text-indigo-400"
        >
          <Pencil className="size-3.5" aria-hidden />
          Edit current context
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-3 space-y-3">
      <input type="hidden" name="id" value={topicId} />
      <input type="hidden" name="expectedUpdatedAt" value={expectedUpdatedAt} />

      <Field label="Goal">
        <textarea name="goal" rows={2} defaultValue={goal ?? ''} className="w-full rounded-md px-3 py-2 text-sm surface" />
      </Field>
      <Field label="Current state">
        <textarea
          name="currentState"
          rows={4}
          defaultValue={currentState ?? ''}
          className="w-full rounded-md px-3 py-2 text-sm surface"
          placeholder="What is true right now — the direction in force, what is built, what is not."
        />
      </Field>
      <Field label="Progress">
        <input
          name="progress"
          type="number"
          min={0}
          max={100}
          defaultValue={progress}
          className="w-24 rounded-md px-3 py-2 text-sm surface"
        />
      </Field>

      <fieldset className="rounded-md border p-3 hairline">
        <legend className="px-1 text-xs font-medium uppercase tracking-wider muted">
          Resume trigger
        </legend>
        <Field label="IF">
          <input
            name="resumeTriggerIf"
            defaultValue={resumeTriggerIf ?? ''}
            placeholder="I return to this topic"
            className="w-full rounded-md px-3 py-2 text-sm surface"
          />
        </Field>
        <div className="mt-2">
          <Field label="THEN">
            <input
              name="resumeTriggerThen"
              defaultValue={resumeTriggerThen ?? ''}
              placeholder="Resume from … and complete …"
              className="w-full rounded-md px-3 py-2 text-sm surface"
            />
          </Field>
        </div>
      </fieldset>

      {state.error && <p className="text-sm text-red-600">{state.error}</p>}

      <div className="flex gap-2">
        <Save />
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded-md px-3 py-2 text-sm muted ring-1 ring-inset hairline"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-indigo-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
    >
      {pending ? 'Saving…' : 'Save'}
    </button>
  );
}

function Read({ label, value, placeholder }: { label: string; value: string | null; placeholder: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider muted">{label}</p>
      <p className={`mt-1 whitespace-pre-wrap break-words text-sm leading-6 ${value ? '' : 'muted'}`}>
        {value || placeholder}
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wider muted">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
