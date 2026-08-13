'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { createTopicAction, type FormState } from '../actions';

const initial: FormState = { error: null };

export function NewTopicForm() {
  const [state, formAction] = useActionState(createTopicAction, initial);

  return (
    <form action={formAction} className="mt-6 space-y-4">
      <Field label="Name" hint="e.g. DailyRelay">
        <input
          name="name"
          required
          maxLength={120}
          autoFocus
          className="w-full rounded-md px-3 py-2 text-sm surface"
          placeholder="DailyRelay"
        />
      </Field>

      <Field label="Description" hint="Optional — what is this?">
        <textarea
          name="description"
          rows={2}
          maxLength={2000}
          className="w-full rounded-md px-3 py-2 text-sm surface"
          placeholder="A relay app for turning intentions into scheduled nudges."
        />
      </Field>

      <Field label="Goal" hint="Optional — what are you trying to accomplish?">
        <textarea
          name="goal"
          rows={2}
          maxLength={2000}
          className="w-full rounded-md px-3 py-2 text-sm surface"
          placeholder="Ship a v1 that a stranger can onboard into in under two minutes."
        />
      </Field>

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
      className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
    >
      {pending ? 'Creating…' : 'Create topic'}
    </button>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {hint && <span className="ml-2 text-xs muted">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
