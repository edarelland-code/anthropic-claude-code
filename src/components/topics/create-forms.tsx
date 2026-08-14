'use client';

import { useActionState, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Plus, X } from 'lucide-react';

import {
  createDecisionAction,
  createIdeaAction,
  createPromptAction,
  type FormState,
} from '@/app/(app)/topics/actions';
import { SOURCE_META } from '@/lib/domain/knowledge';
import {
  IDEA_STATUSES,
  PROMPT_RESULTS,
  SELECTABLE_DECISION_STATUSES,
  SOURCE_TYPES,
  type Subtopic,
} from '@/lib/domain/types';
import { cn } from '@/lib/utils';

/**
 * Creation forms for the three Phase 2 memory objects.
 *
 * They share one disclosure pattern so the Topic page gains three buttons
 * rather than three always-open forms — the page is a workspace, not a stack of
 * inputs (rule 24: information-dense, not overloaded). Each collapses again on
 * success, which is also the signal that the write landed.
 *
 * Sources are chosen, never inferred. An unspecified source is `manual`, which
 * is rule 11: provenance is recorded or absent, never guessed.
 */

const initial: FormState = { error: null };

/** Every control is at least 44px tall so the forms work on a phone (rule 25). */
const field = 'w-full rounded-md px-3 py-2.5 text-sm surface';
const label = 'block text-xs font-medium uppercase tracking-wider muted';

function Submit({ children }: { children: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
    >
      {pending ? 'Saving…' : children}
    </button>
  );
}

function SubtopicSelect({ subtopics }: { subtopics: Subtopic[] }) {
  if (subtopics.length === 0) return null;
  return (
    <label className="block">
      <span className={label}>Subtopic</span>
      <select name="subtopicId" defaultValue="" className={cn(field, 'mt-1')}>
        <option value="">Topic level</option>
        {subtopics.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function SourceSelect() {
  return (
    <label className="block">
      <span className={label}>Source</span>
      <select name="sourceType" defaultValue="manual" className={cn(field, 'mt-1')}>
        {SOURCE_TYPES.map((s) => (
          <option key={s} value={s}>
            {SOURCE_META[s].label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Error({ state }: { state: FormState }) {
  if (!state.error) return null;
  return <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>;
}

/** Closes the panel once the action reports success. */
function useCloseOnSuccess(action: (p: FormState, f: FormData) => Promise<FormState>, close: () => void) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, dispatch] = useActionState(async (prev: FormState, fd: FormData) => {
    const result = await action(prev, fd);
    if (!result.error) {
      formRef.current?.reset();
      close();
    }
    return result;
  }, initial);
  return { formRef, state, dispatch };
}

function DecisionForm({
  topicId,
  subtopics,
  close,
}: {
  topicId: string;
  subtopics: Subtopic[];
  close: () => void;
}) {
  const { formRef, state, dispatch } = useCloseOnSuccess(createDecisionAction, close);
  return (
    <form ref={formRef} action={dispatch} className="mt-3 space-y-3">
      <input type="hidden" name="topicId" value={topicId} />
      <label className="block">
        <span className={label}>Decision</span>
        <input name="title" required maxLength={300} placeholder="Icon direction" className={cn(field, 'mt-1')} />
      </label>
      <label className="block">
        <span className={label}>What was decided</span>
        <textarea name="decision" required rows={2} maxLength={5000} placeholder="Use the slash → arrow → X geometry." className={cn(field, 'mt-1')} />
      </label>
      <label className="block">
        <span className={label}>Why</span>
        <textarea name="reason" rows={2} maxLength={5000} placeholder="Reads at 16px where the blue circle did not." className={cn(field, 'mt-1')} />
      </label>
      <label className="block">
        <span className={label}>Alternatives considered</span>
        <textarea name="alternatives" rows={2} maxLength={5000} placeholder="One per line" className={cn(field, 'mt-1')} />
      </label>
      <label className="block">
        <span className={label}>Approved direction</span>
        <input name="approvedDirection" maxLength={2000} className={cn(field, 'mt-1')} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className={label}>Status</span>
          <select name="status" defaultValue="active" className={cn(field, 'mt-1')}>
            {SELECTABLE_DECISION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0]!.toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <SubtopicSelect subtopics={subtopics} />
        <SourceSelect />
      </div>
      <Error state={state} />
      <Submit>Record decision</Submit>
    </form>
  );
}

function IdeaForm({ topicId, subtopics, close }: { topicId: string; subtopics: Subtopic[]; close: () => void }) {
  const { formRef, state, dispatch } = useCloseOnSuccess(createIdeaAction, close);
  return (
    <form ref={formRef} action={dispatch} className="mt-3 space-y-3">
      <input type="hidden" name="topicId" value={topicId} />
      <label className="block">
        <span className={label}>Idea</span>
        <input name="title" required maxLength={300} placeholder="Overlay a checkmark" className={cn(field, 'mt-1')} />
      </label>
      <label className="block">
        <span className={label}>Detail</span>
        <textarea name="idea" rows={2} maxLength={5000} className={cn(field, 'mt-1')} />
      </label>
      <label className="block">
        <span className={label}>Why it was suggested</span>
        <textarea name="rationale" rows={2} maxLength={5000} placeholder="Kept even if the idea is later rejected." className={cn(field, 'mt-1')} />
      </label>
      <label className="block">
        <span className={label}>Notes</span>
        <textarea name="notes" rows={2} maxLength={5000} className={cn(field, 'mt-1')} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className={label}>Status</span>
          <select name="status" defaultValue="suggested" className={cn(field, 'mt-1')}>
            {IDEA_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0]!.toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <SubtopicSelect subtopics={subtopics} />
        <SourceSelect />
      </div>
      <Error state={state} />
      <Submit>Capture idea</Submit>
    </form>
  );
}

function PromptForm({ topicId, subtopics, close }: { topicId: string; subtopics: Subtopic[]; close: () => void }) {
  const { formRef, state, dispatch } = useCloseOnSuccess(createPromptAction, close);
  return (
    <form ref={formRef} action={dispatch} className="mt-3 space-y-3">
      <input type="hidden" name="topicId" value={topicId} />
      <label className="block">
        <span className={label}>Title</span>
        <input name="title" required maxLength={300} placeholder="Icon generation prompt" className={cn(field, 'mt-1')} />
      </label>
      <label className="block">
        <span className={label}>Prompt</span>
        <textarea name="body" required rows={5} maxLength={50_000} placeholder="The exact text you sent." className={cn(field, 'mt-1', 'font-mono text-xs')} />
      </label>
      <label className="block">
        <span className={label}>Purpose</span>
        <input name="purpose" maxLength={2000} className={cn(field, 'mt-1')} />
      </label>
      <label className="block">
        <span className={label}>Notes</span>
        <textarea name="notes" rows={2} maxLength={5000} className={cn(field, 'mt-1')} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className={label}>Outcome</span>
          {/* Recorded as an appended outcome, never onto the version itself. */}
          <select name="result" defaultValue="untested" className={cn(field, 'mt-1')}>
            {PROMPT_RESULTS.filter((r) => r !== 'superseded').map((r) => (
              <option key={r} value={r}>
                {r === 'untested' ? 'Not run yet' : r.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <SubtopicSelect subtopics={subtopics} />
        <SourceSelect />
      </div>
      <p className="text-xs muted">
        Saves as version 1. Later edits add a new version; this one is never overwritten.
      </p>
      <Error state={state} />
      <Submit>Save prompt</Submit>
    </form>
  );
}

/**
 * The three creation actions.
 *
 * One panel is open at a time and takes the full width beneath the buttons, so
 * the Topic page grows by one row rather than by three permanently-open forms.
 * Opening a second closes the first — there is no case for drafting a decision
 * and a prompt simultaneously, and two open forms would bury the page content
 * they are meant to sit alongside.
 */
export function CreateMemoryActions({
  topicId,
  subtopics,
}: {
  topicId: string;
  subtopics: Subtopic[];
}) {
  const [open, setOpen] = useState<'decision' | 'idea' | 'prompt' | null>(null);
  const close = () => setOpen(null);

  const buttons = [
    { key: 'decision' as const, label: 'Decision', accent: 'bg-violet-500' },
    { key: 'idea' as const, label: 'Idea', accent: 'bg-amber-500' },
    { key: 'prompt' as const, label: 'Prompt', accent: 'bg-blue-500' },
  ];

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {buttons.map((b) => (
          <button
            key={b.key}
            type="button"
            aria-expanded={open === b.key}
            onClick={() => setOpen(open === b.key ? null : b.key)}
            className={cn(
              'inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 py-2 text-sm hairline hover:underline',
              open === b.key && 'bg-black/[0.06] dark:bg-white/10',
            )}
          >
            <span className={cn('size-2 rounded-full', b.accent)} aria-hidden />
            <Plus className="size-3.5" aria-hidden />
            {b.label}
          </button>
        ))}
      </div>

      {open && (
        <div className="mt-3 rounded-lg p-4 surface">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              {open === 'decision' ? 'Record a decision' : open === 'idea' ? 'Capture an idea' : 'Save a prompt'}
            </h3>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="inline-flex size-11 items-center justify-center rounded-md muted hover:underline"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
          {open === 'decision' && <DecisionForm topicId={topicId} subtopics={subtopics} close={close} />}
          {open === 'idea' && <IdeaForm topicId={topicId} subtopics={subtopics} close={close} />}
          {open === 'prompt' && <PromptForm topicId={topicId} subtopics={subtopics} close={close} />}
        </div>
      )}
    </div>
  );
}
