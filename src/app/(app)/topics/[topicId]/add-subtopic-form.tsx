'use client';

import { useActionState, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Plus } from 'lucide-react';

import { createSubtopicAction, type FormState } from '../actions';

const initial: FormState = { error: null };

export function AddSubtopicForm({ topicId }: { topicId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState(async (prev: FormState, fd: FormData) => {
    const result = await createSubtopicAction(prev, fd);
    if (!result.error) formRef.current?.reset();
    return result;
  }, initial);

  return (
    <form ref={formRef} action={formAction} className="mt-3">
      <input type="hidden" name="topicId" value={topicId} />
      <div className="flex gap-2">
        <input
          name="name"
          required
          maxLength={120}
          placeholder="Add a subtopic — e.g. Branding"
          className="min-w-0 flex-1 rounded-md px-3 py-2 text-sm surface"
        />
        <AddButton />
      </div>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium ring-1 ring-inset hairline hover:bg-black/[0.04] disabled:opacity-60 dark:hover:bg-white/[0.06]"
    >
      <Plus className="size-4" aria-hidden />
      Add
    </button>
  );
}
