'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Undo2 } from 'lucide-react';

import { restoreAction, type FormState } from './actions';

function Button() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-xs font-medium ring-1 ring-inset hairline hover:bg-black/[0.04] disabled:opacity-60 dark:hover:bg-white/[0.06]"
    >
      <Undo2 className="size-3.5" aria-hidden />
      {pending ? 'Restoring…' : 'Restore'}
    </button>
  );
}

export function RestoreButton({ deletionLogId }: { deletionLogId: string }) {
  const [state, action] = useActionState<FormState, FormData>(restoreAction, { error: null });

  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="deletionLogId" value={deletionLogId} />
      <Button />
      {state.error && (
        <span role="alert" className="text-xs text-rose-600 dark:text-rose-400">
          {state.error}
        </span>
      )}
    </form>
  );
}
