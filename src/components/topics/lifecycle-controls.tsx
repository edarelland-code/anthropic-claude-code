'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { ChevronDown, Replace, Star } from 'lucide-react';

import {
  IDEA_STATUSES,
  PROMPT_RESULTS,
  SELECTABLE_DECISION_STATUSES,
  type Decision,
  type Idea,
  type PromptVersion,
} from '@/lib/domain/types';

import {
  markWinningAction,
  rateVersionAction,
  setDecisionStatusAction,
  setIdeaStatusAction,
  supersedeDecisionAction,
  type FormState,
} from '@/app/(app)/topics/actions';

/**
 * The Phase 2 control gaps, closed because Resume depends on them.
 *
 * Each of these existed at the repository and database level with tests, and
 * had no button. That is a real gap rather than a cosmetic one: an avoid-list
 * can only contain what someone was able to reject, and a prompt outcome that
 * cannot be revised means Resume keeps exporting a prompt that stopped working
 * as one that works.
 */

function Submit({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 items-center rounded-md bg-indigo-600 px-3 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
    >
      {pending ? busy : label}
    </button>
  );
}

const fieldClass =
  'min-h-11 w-full rounded-md border-0 px-2.5 text-sm ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500';

/** Move a decision between the states a user may choose, or replace it outright. */
export function DecisionControls({ decision, topicId }: { decision: Decision; topicId: string }) {
  const [open, setOpen] = useState(false);
  const [statusState, statusAction] = useActionState<FormState, FormData>(setDecisionStatusAction, { error: null });
  const [supersedeState, supersedeAction] = useActionState<FormState, FormData>(supersedeDecisionAction, { error: null });

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={statusAction} className="flex items-center gap-1.5">
          <input type="hidden" name="decisionId" value={decision.id} />
          <input type="hidden" name="topicId" value={topicId} />
          <label className="sr-only" htmlFor={`status-${decision.id}`}>
            Decision state
          </label>
          <select
            id={`status-${decision.id}`}
            name="status"
            defaultValue={
              SELECTABLE_DECISION_STATUSES.includes(decision.status as never) ? decision.status : 'active'
            }
            className="min-h-11 rounded-md border-0 px-2 text-xs ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
            style={{ background: 'var(--background)' }}
          >
            {SELECTABLE_DECISION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0]!.toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
          <Submit label="Set" busy="Saving…" />
        </form>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-xs ring-1 ring-inset hairline hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
        >
          <Replace className="size-3.5" aria-hidden />
          Replace this
          <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      </div>

      {statusState.error && (
        <p role="alert" className="mt-1 text-xs text-rose-600 dark:text-rose-400">
          {statusState.error}
        </p>
      )}

      {open && (
        <form action={supersedeAction} className="mt-2 space-y-2 rounded-md p-3 ring-1 ring-inset hairline">
          <input type="hidden" name="decisionId" value={decision.id} />
          <input type="hidden" name="topicId" value={topicId} />
          <p className="text-xs muted">
            The old decision is kept and linked, not overwritten. The reason becomes part of the
            avoid list, so a future session knows why this direction changed.
          </p>
          <input name="title" required maxLength={200} placeholder="What replaces it" className={fieldClass} style={{ background: 'var(--background)' }} />
          <textarea name="decision" required rows={2} maxLength={4000} placeholder="What is being decided instead" className={`${fieldClass} resize-y py-2`} style={{ background: 'var(--background)' }} />
          <textarea name="reason" required rows={2} maxLength={2000} placeholder="Why the previous decision no longer holds (required)" className={`${fieldClass} resize-y py-2`} style={{ background: 'var(--background)' }} />
          <div className="flex flex-wrap items-center gap-2">
            <Submit label="Replace" busy="Replacing…" />
            {supersedeState.error && (
              <span role="alert" className="text-xs text-rose-600 dark:text-rose-400">
                {supersedeState.error}
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

/** Move an idea through its lifecycle. Rejecting requires a reason. */
export function IdeaControls({ idea, topicId }: { idea: Idea; topicId: string }) {
  const [status, setStatus] = useState<Idea['status']>(idea.status);
  const [state, action] = useActionState<FormState, FormData>(setIdeaStatusAction, { error: null });

  return (
    <form action={action} className="mt-2 space-y-2">
      <input type="hidden" name="ideaId" value={idea.id} />
      <input type="hidden" name="topicId" value={topicId} />
      <div className="flex flex-wrap items-center gap-1.5">
        <label className="sr-only" htmlFor={`idea-${idea.id}`}>
          Idea state
        </label>
        <select
          id={`idea-${idea.id}`}
          name="status"
          value={status}
          onChange={(e) => setStatus(e.target.value as Idea['status'])}
          className="min-h-11 rounded-md border-0 px-2 text-xs ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
          style={{ background: 'var(--background)' }}
        >
          {IDEA_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s[0]!.toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
        <Submit label="Set" busy="Saving…" />
      </div>

      {status === 'rejected' && (
        <textarea
          name="note"
          rows={2}
          required
          maxLength={2000}
          placeholder="Why is this being rejected? (required — it becomes the avoid-list reason)"
          className={`${fieldClass} resize-y py-2`}
          style={{ background: 'var(--background)' }}
        />
      )}

      {state.error && (
        <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
          {state.error}
        </p>
      )}
    </form>
  );
}

/**
 * Re-rate a version, and name the winner.
 *
 * Two separate writes on purpose. A rating is an outcome — appended, so a
 * changed judgement is history. Winning is a selection, also appended. Neither
 * touches the version row, which stays insert-only.
 */
export function PromptVersionControls({
  version,
  promptId,
  topicId,
  isWinner,
}: {
  version: PromptVersion;
  promptId: string;
  topicId: string;
  isWinner: boolean;
}) {
  const [rateState, rateAction] = useActionState<FormState, FormData>(rateVersionAction, { error: null });
  const [winState, winAction] = useActionState<FormState, FormData>(markWinningAction, { error: null });

  return (
    <div className="mt-2 space-y-2">
      <form action={rateAction} className="flex flex-wrap items-center gap-1.5">
        <input type="hidden" name="versionId" value={version.id} />
        <input type="hidden" name="promptId" value={promptId} />
        <input type="hidden" name="topicId" value={topicId} />
        <label className="sr-only" htmlFor={`result-${version.id}`}>
          Outcome for version {version.version}
        </label>
        <select
          id={`result-${version.id}`}
          name="result"
          defaultValue={version.result}
          className="min-h-11 rounded-md border-0 px-2 text-xs ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
          style={{ background: 'var(--background)' }}
        >
          {PROMPT_RESULTS.map((r) => (
            <option key={r} value={r}>
              {r.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <input
          name="notes"
          maxLength={2000}
          placeholder="What happened (optional)"
          className="min-h-11 min-w-0 flex-1 rounded-md border-0 px-2.5 text-xs ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
          style={{ background: 'var(--background)' }}
        />
        <Submit label="Record outcome" busy="Recording…" />
      </form>

      <form action={winAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="promptId" value={promptId} />
        <input type="hidden" name="topicId" value={topicId} />
        <input type="hidden" name="versionId" value={isWinner ? '' : version.id} />
        {!isWinner && (
          <input
            name="reason"
            maxLength={2000}
            placeholder="Why this version won (optional)"
            className="min-h-11 min-w-0 flex-1 rounded-md border-0 px-2.5 text-xs ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
            style={{ background: 'var(--background)' }}
          />
        )}
        <button
          type="submit"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ring-1 ring-inset hairline hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
        >
          <Star className={`size-3.5 ${isWinner ? 'fill-cyan-500 text-cyan-500' : ''}`} aria-hidden />
          {isWinner ? 'Clear winner' : 'Mark this version as the winner'}
        </button>
      </form>

      <p aria-live="polite" className="text-xs">
        {rateState.error || winState.error ? (
          <span className="text-rose-600 dark:text-rose-400">{rateState.error ?? winState.error}</span>
        ) : (
          <span className="muted">
            Outcomes and winner selections are appended. The version body is never changed.
          </span>
        )}
      </p>
    </div>
  );
}
