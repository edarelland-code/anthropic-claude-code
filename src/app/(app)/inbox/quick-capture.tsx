'use client';

import { useActionState, useEffect, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, Inbox } from 'lucide-react';

import { captureAction, type FormState } from './actions';

/**
 * Quick Capture.
 *
 * CLARIFICATION 2. Open, paste, save — and that is the entire flow. There is
 * deliberately no topic picker, no knowledge type, no source selector, no tags
 * and no classification step in front of the Save button. Anything that made
 * the user stop and decide would defeat the reason the Inbox exists: capture
 * has to be cheaper than the interruption it is competing with, which is
 * usually "carry on talking to Claude and lose it".
 *
 * The form stays mounted and clears itself on success, so several things can be
 * captured in a row without a navigation between them.
 */
function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-60"
    >
      <Inbox className="size-4" aria-hidden />
      {pending ? 'Saving…' : 'Save to Inbox'}
    </button>
  );
}

export function QuickCapture({ autoFocus = false }: { autoFocus?: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(captureAction, { error: null });
  const formRef = useRef<HTMLFormElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (state.message) {
      formRef.current?.reset();
      fieldRef.current?.focus();
    }
  }, [state.message]);

  useEffect(() => {
    if (autoFocus) fieldRef.current?.focus();
  }, [autoFocus]);

  return (
    <form ref={formRef} action={action} className="rounded-lg p-4 surface sm:p-5">
      <label htmlFor="capture-content" className="text-sm font-medium">
        Capture anything
      </label>
      <p className="mt-0.5 text-xs muted">
        Paste a Claude response, a transcript, a link, or a thought. Nothing else is needed now —
        you decide where it belongs later.
      </p>

      <textarea
        ref={fieldRef}
        id="capture-content"
        name="content"
        rows={5}
        required
        // Ctrl/Cmd+Enter submits, so a paste never needs a trip to the mouse.
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.currentTarget.form?.requestSubmit();
          }
        }}
        placeholder="Paste or type…"
        className="mt-2.5 w-full resize-y rounded-md border-0 px-3 py-2.5 text-sm leading-6 ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
        style={{ background: 'var(--background)' }}
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <SaveButton />
        <input
          type="text"
          name="sourceHint"
          maxLength={200}
          placeholder="Optional label"
          aria-label="Optional label"
          className="min-h-11 min-w-0 flex-1 rounded-md border-0 px-3 text-sm ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
          style={{ background: 'var(--background)' }}
        />
      </div>

      <p aria-live="polite" className="mt-2 text-xs">
        {state.error ? (
          <span className="text-rose-600 dark:text-rose-400">{state.error}</span>
        ) : state.message ? (
          <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
            <Check className="size-3.5" aria-hidden />
            {state.message}
          </span>
        ) : (
          <span className="muted">⌘/Ctrl + Enter saves.</span>
        )}
      </p>
    </form>
  );
}
