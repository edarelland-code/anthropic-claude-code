'use client';

import { useActionState, useRef, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, CircleDot } from 'lucide-react';

import type { Action } from '@/lib/domain/types';

import { addActionAction, resolveActionAction, type FormState } from '../actions';

const initial: FormState = { error: null };

const KIND_STYLE: Record<Action['kind'], string> = {
  next_step: 'border-green-500',
  blocker: 'border-red-500',
  question: 'border-amber-500',
};

const KIND_LABEL: Record<Action['kind'], string> = {
  next_step: 'Next step',
  blocker: 'Blocker',
  question: 'Question',
};

export function OpenIssues({ topicId, actions }: { topicId: string; actions: Action[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pendingResolve, startResolve] = useTransition();
  const [state, formAction] = useActionState(async (prev: FormState, fd: FormData) => {
    const result = await addActionAction(prev, fd);
    if (!result.error) formRef.current?.reset();
    return result;
  }, initial);

  return (
    <section className="rounded-lg p-4 surface">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <CircleDot className="size-4 muted" aria-hidden />
        Open issues
        <span className="ml-auto text-xs muted">{actions.length}</span>
      </h2>

      {actions.length === 0 ? (
        <p className="mt-3 text-sm muted">Nothing open. Add a next step, blocker, or question.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {actions.map((a) => (
            <li key={a.id} className={`flex items-start gap-2 border-l-2 pl-2.5 ${KIND_STYLE[a.kind]}`}>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-wider muted">
                  {KIND_LABEL[a.kind]}
                </p>
                <p className="text-sm leading-5">{a.title}</p>
              </div>
              <button
                type="button"
                disabled={pendingResolve}
                onClick={() => startResolve(() => void resolveActionAction(a.id, topicId))}
                aria-label={`Resolve: ${a.title}`}
                title="Mark done"
                className="shrink-0 rounded p-1 muted hover:bg-black/[0.06] disabled:opacity-50 dark:hover:bg-white/[0.08]"
              >
                <Check className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form ref={formRef} action={formAction} className="mt-3 space-y-2">
        <input type="hidden" name="topicId" value={topicId} />
        <div className="flex flex-wrap gap-2">
          <select
            name="kind"
            defaultValue="next_step"
            className="min-h-11 shrink-0 rounded-md px-2 text-sm surface"
            aria-label="Kind"
          >
            <option value="next_step">Next step</option>
            <option value="blocker">Blocker</option>
            <option value="question">Question</option>
          </select>
          <input
            name="title"
            required
            maxLength={300}
            placeholder="Add…"
            className="min-w-0 basis-full rounded-md px-3 py-2.5 text-sm surface sm:basis-auto sm:flex-1"
          />
          <AddButton />
        </div>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      </form>
    </section>
  );
}

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="shrink-0 rounded-md px-3 py-2.5 text-sm font-medium ring-1 ring-inset hairline hover:bg-black/[0.04] disabled:opacity-60 dark:hover:bg-white/[0.06]"
    >
      Add
    </button>
  );
}
