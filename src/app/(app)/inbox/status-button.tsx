'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import type { IngestionStatus } from '@/lib/domain/types';

import { setInboxStatusAction, type FormState } from './actions';

/**
 * Archive, or bring something back.
 *
 * Never a delete. Archiving moves an item out of the way and leaves the raw
 * capture exactly where it is — still readable, still searchable — which is
 * why the database refuses `soft_delete_record('ingestion_record', …)` outright
 * rather than offering both.
 */
function Button({ label, icon }: { label: string; icon?: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-xs font-medium ring-1 ring-inset hairline hover:bg-black/[0.04] disabled:opacity-60 dark:hover:bg-white/[0.06]"
    >
      {icon}
      {pending ? 'Working…' : label}
    </button>
  );
}

export function StatusButton({
  id,
  status,
  label,
  icon,
}: {
  id: string;
  status: IngestionStatus;
  label: string;
  icon?: React.ReactNode;
}) {
  const [state, action] = useActionState<FormState, FormData>(setInboxStatusAction, { error: null });

  return (
    <form action={action} className="contents">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <Button label={label} icon={icon} />
      {state.error && (
        <span role="alert" className="text-xs text-rose-600 dark:text-rose-400">
          {state.error}
        </span>
      )}
    </form>
  );
}
