'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle, Loader2, Sparkles, RotateCw } from 'lucide-react';

import type { StoredSuggestion } from '@/lib/ports/repositories';

import { analyzeInboxItemAction } from './extract-actions';
import { ReviewWorkspace } from './review-workspace';

/**
 * The entry point to analysis, and the honesty layer around it (Phase 6AD/6C).
 *
 * Every string here is chosen so a user knows exactly what ran. With no model
 * configured the button says "Extract suggestions" and the panel says
 * "deterministic extraction" — never "AI", never "Claude". That is not
 * modesty: someone who believes a model read their conversation reviews the
 * output far less carefully than someone who knows a matcher scanned it, and
 * the review is the only thing standing between a suggestion and the project's
 * memory.
 *
 * Failure never costs the source. If extraction fails the raw capture is
 * exactly where it was, and the panel says so and offers a retry (6V).
 */
export function AnalyzePanel({
  itemId,
  topicId,
  subtopicId,
  topics,
  providerLabel,
  providerIsModel,
  providerProblem,
  sizeMessage,
  secretWarning,
  tooLarge,
  existingRun,
}: {
  itemId: string;
  topicId: string | null;
  subtopicId: string | null;
  topics: Array<{ id: string; name: string }>;
  providerLabel: string;
  providerIsModel: boolean;
  providerProblem: string | null;
  sizeMessage: string;
  secretWarning: string | null;
  tooLarge: boolean;
  existingRun: {
    id: string;
    suggestions: StoredSuggestion[];
    warnings: string[];
    chunkCount: number;
    status: string;
    failureDetail: string | null;
  } | null;
}) {
  // Read from the server-rendered run, not held in local state: the review is
  // rows in the database, and after an extraction the page reloads to pick
  // them up. Mirroring them here would create a second, divergent copy of the
  // one thing that has to survive a closed tab.
  const run = existingRun;
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, start] = useTransition();

  const analyze = () => {
    setError(null);
    start(async () => {
      const result = await analyzeInboxItemAction({
        itemId,
        topicId,
        subtopicId,
        secretsAcknowledged: acknowledged,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      // The page reloads to pick up the saved run, so a refresh mid-review
      // finds exactly the same workspace (6AB).
      window.location.reload();
    });
  };

  return (
    <section className="mt-6">
      <div className="rounded-lg p-4 surface">
        <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 muted" aria-hidden />
          Analyze &amp; review
          <span className="ml-auto text-xs font-normal muted">{providerLabel}</span>
        </h2>

        <p className="mt-1 text-xs leading-5 muted">
          {providerIsModel
            ? 'Sends the source below to the configured model provider and proposes records for you to review.'
            : 'Reads the labels and phrasing in the source below and proposes records for you to review. This is deterministic extraction — it does not understand the conversation, and no model is involved.'}
        </p>

        {providerProblem && (
          <p className="mt-2 rounded-md p-2.5 text-xs leading-5 ring-1 ring-inset hairline muted">
            AI-assisted extraction is not configured. {providerProblem} You can still extract
            suggestions deterministically and review them, and everything else in ContextShelf —
            capture, the Inbox, import, search and Resume — is unaffected.
          </p>
        )}

        <p className="mt-2 text-xs muted">{sizeMessage}</p>

        {secretWarning && (
          <div className="mt-3 rounded-md p-3 ring-1 ring-inset ring-amber-600/40">
            <p className="flex items-start gap-1.5 text-xs leading-5 text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {secretWarning}
            </p>
            {providerIsModel && (
              <label className="mt-2 flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="size-4 rounded"
                />
                I have reviewed this and want to continue.
              </label>
            )}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={analyze}
            disabled={pending || tooLarge}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : run ? (
              <RotateCw className="size-4" aria-hidden />
            ) : (
              <Sparkles className="size-4" aria-hidden />
            )}
            {pending ? 'Reading the source…' : run ? 'Extract again' : 'Extract suggestions'}
          </button>
          {run && (
            <span className="text-xs muted">
              Last run: {run.status}
              {run.chunkCount > 1 ? ` · ${run.chunkCount} parts` : ''}
            </span>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-2 text-xs leading-5 text-rose-600 dark:text-rose-400">
            {error} Your captured source is untouched — nothing was written. You can try again, or
            file it by hand below.
          </p>
        )}

        {run?.status === 'failed' && !error && (
          <p role="alert" className="mt-2 text-xs leading-5 text-rose-600 dark:text-rose-400">
            The last run failed: {run.failureDetail ?? 'no reason was recorded'}. The source is
            unchanged.
          </p>
        )}
      </div>

      {run && run.suggestions.length > 0 && (
        <ReviewWorkspace
          runId={run.id}
          suggestions={run.suggestions}
          topicId={topicId}
          subtopicId={subtopicId}
          topics={topics}
          providerLabel={providerLabel}
          providerIsModel={providerIsModel}
          warnings={run.warnings}
          chunkCount={run.chunkCount}
        />
      )}

      {run && run.suggestions.length === 0 && run.status !== 'failed' && (
        <p className="mt-3 rounded-lg p-4 text-sm leading-5 muted surface">
          Nothing was proposed from this source. That is a real answer rather than a failure —
          deterministic extraction only reports what the text states plainly. File it by hand below,
          or add labels like <code>Decision:</code> and <code>TODO:</code> to the source and run it
          again.
        </p>
      )}
    </section>
  );
}
