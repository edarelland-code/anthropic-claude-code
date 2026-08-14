'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Loader2,
  Pencil,
  Quote,
  X,
} from 'lucide-react';

import { KNOWLEDGE_TYPES, type KnowledgeType } from '@/lib/domain/types';
import type { StoredSuggestion } from '@/lib/ports/repositories';
import { SUGGESTION_KINDS } from '@/lib/extraction/types';
import { cn } from '@/lib/utils';

import {
  confirmSuggestionsAction,
  editSuggestionAction,
  rejectSuggestionsAction,
  setSuggestionSelectionAction,
} from './extract-actions';

/**
 * The review workspace (Phase 6G).
 *
 * The most important screen in Phase 6, and the one with the clearest failure
 * mode: if reviewing thirty suggestions is slower than typing them, nobody
 * reviews and everything gets confirmed unread. So it is one scrolling list of
 * inline-editable rows grouped by section — not thirty modal dialogs — with
 * select-all, deselect-all and one confirm.
 *
 * Two things it will not do, however convenient they would be:
 *
 *   * It never pre-ticks a decision or a Current State, at any confidence.
 *     Those change what the project believes, and a pre-ticked box turns a
 *     glance into an approval.
 *   * It never says "AI" while the deterministic provider is running. What
 *     ran was label and phrase matching, and a reviewer who believes a machine
 *     understood the conversation reviews less carefully than one who knows it
 *     did not.
 */

const SECTIONS: Array<{ key: string; label: string; match: (s: StoredSuggestion) => boolean }> = [
  { key: 'decision', label: 'Decisions', match: (s) => s.kind === 'decision' },
  { key: 'current_state', label: 'Current State', match: (s) => s.kind === 'current_state' },
  { key: 'idea', label: 'Ideas', match: (s) => s.kind === 'idea' },
  { key: 'prompt', label: 'Prompts', match: (s) => s.kind === 'prompt' },
  { key: 'action', label: 'Actions, blockers and questions', match: (s) => s.kind === 'action' },
  {
    key: 'implementation',
    label: 'Implementations and changes',
    match: (s) =>
      s.kind === 'knowledge_entry' &&
      ['implementation', 'added', 'removed', 'refactored', 'progress'].includes(s.knowledgeType ?? ''),
  },
  {
    key: 'bugfix',
    label: 'Bugs and fixes',
    match: (s) => s.kind === 'knowledge_entry' && ['bug', 'fix'].includes(s.knowledgeType ?? ''),
  },
  {
    key: 'requirement',
    label: 'Requirements and constraints',
    match: (s) =>
      s.kind === 'knowledge_entry' &&
      ['requirement', 'important_context'].includes(s.knowledgeType ?? ''),
  },
  { key: 'relationship', label: 'Relationships', match: (s) => s.kind === 'relationship' },
  { key: 'other', label: 'Other context', match: () => true },
];

/** High / Medium / Low, because a reviewer weighs a word faster than a decimal. */
function confidenceBand(c: number): { label: string; tone: string } {
  if (c >= 0.85) return { label: 'High', tone: 'text-emerald-700 dark:text-emerald-400' };
  if (c >= 0.6) return { label: 'Medium', tone: 'muted' };
  return { label: 'Low', tone: 'text-amber-700 dark:text-amber-400' };
}

const AUTHORITY = new Set(['decision', 'current_state']);

export function ReviewWorkspace({
  runId,
  suggestions: initial,
  topicId,
  subtopicId,
  topics,
  providerLabel,
  providerIsModel,
  warnings,
  chunkCount,
}: {
  runId: string;
  suggestions: StoredSuggestion[];
  topicId: string | null;
  subtopicId: string | null;
  topics: Array<{ id: string; name: string }>;
  providerLabel: string;
  providerIsModel: boolean;
  warnings: string[];
  chunkCount: number;
}) {
  const [rows, setRows] = useState(initial);
  const [chosenTopic, setChosenTopic] = useState(topicId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const open = useMemo(() => rows.filter((r) => r.state !== 'confirmed' && r.state !== 'rejected'), [rows]);
  const selected = useMemo(() => open.filter((r) => r.selected), [open]);
  const confirmed = rows.filter((r) => r.state === 'confirmed');

  const patch = (id: string, next: Partial<StoredSuggestion>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...next } : r)));

  const toggle = (row: StoredSuggestion) => {
    const next = !row.selected;
    patch(row.id, { selected: next });
    start(async () => {
      const result = await setSuggestionSelectionAction({ runId, ids: [row.id], selected: next });
      if (result.error) setError(result.error);
    });
  };

  const bulk = (ids: string[], value: boolean) => {
    setRows((prev) => prev.map((r) => (ids.includes(r.id) ? { ...r, selected: value } : r)));
    start(async () => {
      const result = await setSuggestionSelectionAction({ runId, ids, selected: value });
      if (result.error) setError(result.error);
    });
  };

  const reject = (row: StoredSuggestion) => {
    patch(row.id, { state: 'rejected', selected: false });
    start(async () => {
      const result = await rejectSuggestionsAction({ ids: [row.id] });
      if (result.error) setError(result.error);
    });
  };

  const confirm = () => {
    if (!chosenTopic) {
      setError('Choose the topic these belong to first.');
      return;
    }
    // Current State is confirmed through its own comparison, never in bulk.
    const ids = selected.filter((s) => s.kind !== 'current_state').map((s) => s.id);
    if (ids.length === 0) {
      setError('Nothing is selected that a batch can file.');
      return;
    }
    start(async () => {
      const result = await confirmSuggestionsAction({
        runId,
        ids,
        topicId: chosenTopic,
        subtopicId,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      setReceipt(result.message ?? null);
      setRows((prev) =>
        prev.map((r) => (ids.includes(r.id) ? { ...r, state: 'confirmed' as const, selected: false } : r)),
      );
    });
  };

  /** "Select all safe" — never the authority-changing kinds (6H). */
  const safeIds = open
    .filter((r) => !AUTHORITY.has(r.kind) && !r.duplicateOfId && !r.conflictsWithId)
    .map((r) => r.id);

  return (
    <div className="mt-4">
      <section className="rounded-lg p-4 surface">
        <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <FileText className="size-4 muted" aria-hidden />
          {open.length} suggestion{open.length === 1 ? '' : 's'} to review
          <span className="ml-auto text-xs font-normal muted">
            {providerLabel}
            {chunkCount > 1 ? ` · ${chunkCount} parts` : ''}
          </span>
        </h2>
        <p className="mt-1 text-xs leading-5 muted">
          {providerIsModel
            ? 'These are suggestions from a model. Nothing is filed until you confirm it.'
            : 'These come from deterministic extraction — the labels and phrasing in your source, not an understanding of it. Nothing is filed until you confirm it.'}
        </p>

        {warnings.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-md p-3 text-xs leading-5 ring-1 ring-inset ring-amber-600/30">
            {warnings.map((w) => (
              <li key={w} className="text-amber-800 dark:text-amber-300">
                {w}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-xs font-medium">
            File these under
            <select
              value={chosenTopic}
              onChange={(e) => setChosenTopic(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-md border-0 px-2 text-sm ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
              style={{ background: 'var(--background)' }}
            >
              <option value="">Choose a topic…</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => bulk(safeIds, true)}
            className="inline-flex min-h-11 items-center rounded-md px-2.5 text-xs ring-1 ring-inset hairline hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
            title="Everything except decisions, Current State, duplicates and conflicts"
          >
            Select all safe
          </button>
          <button
            type="button"
            onClick={() => bulk(open.map((r) => r.id), false)}
            className="inline-flex min-h-11 items-center rounded-md px-2.5 text-xs muted ring-1 ring-inset hairline hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
          >
            Deselect all
          </button>
        </div>
      </section>

      <div className="sticky bottom-20 z-10 mt-3 flex flex-wrap items-center gap-3 rounded-lg p-3 surface lg:bottom-4">
        <button
          type="button"
          onClick={confirm}
          disabled={pending || selected.length === 0}
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
          Confirm {selected.length} selected
        </button>
        <p aria-live="polite" className="text-xs muted">
          {error ? (
            <span className="text-rose-600 dark:text-rose-400">{error}</span>
          ) : (
            (receipt ?? `${confirmed.length} filed so far. Your edits are saved as you make them.`)
          )}
        </p>
      </div>

      {SECTIONS.map((section, sectionIndex) => {
        const claimed = new Set(
          SECTIONS.slice(0, sectionIndex).flatMap((prev) => open.filter(prev.match).map((r) => r.id)),
        );
        const rowsHere = open.filter((r) => section.match(r) && !claimed.has(r.id));
        if (rowsHere.length === 0) return null;

        return (
          <section key={section.key} className="mt-3 rounded-lg p-4 surface">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              {section.label}
              <span className="ml-auto text-xs font-normal muted">{rowsHere.length}</span>
            </h3>
            <ul className="mt-3 space-y-2">
              {rowsHere.map((row) => (
                <SuggestionRow
                  key={row.id}
                  row={row}
                  editing={editing === row.id}
                  onEdit={() => setEditing(editing === row.id ? null : row.id)}
                  onToggle={() => toggle(row)}
                  onReject={() => reject(row)}
                  onPatch={(next) => patch(row.id, next)}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {confirmed.length > 0 && (
        <section className="mt-3 rounded-lg p-4 surface">
          <h3 className="text-sm font-semibold">Filed</h3>
          <ul className="mt-2 space-y-1 text-xs muted">
            {confirmed.map((r) => (
              <li key={r.id}>
                <Check className="mr-1 inline size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
                {r.title}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SuggestionRow({
  row,
  editing,
  onEdit,
  onToggle,
  onReject,
  onPatch,
}: {
  row: StoredSuggestion;
  editing: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onReject: () => void;
  onPatch: (next: Partial<StoredSuggestion>) => void;
}) {
  const [saving, startSave] = useTransition();
  const [showEvidence, setShowEvidence] = useState(false);
  const band = confidenceBand(row.confidence);
  const authority = AUTHORITY.has(row.kind);

  const save = (next: Partial<StoredSuggestion>) => {
    onPatch({ ...next, state: 'edited' });
    startSave(async () => {
      await editSuggestionAction({
        id: row.id,
        title: next.title,
        content: next.content,
        kind: next.kind,
        knowledgeType: next.knowledgeType,
      });
    });
  };

  return (
    <li
      className={cn(
        'rounded-md p-3 ring-1 ring-inset',
        row.conflictsWithId
          ? 'ring-amber-600/40'
          : row.duplicateOfId
            ? 'ring-slate-400/40'
            : 'hairline',
      )}
    >
      <div className="flex items-start gap-2.5">
        <label className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center">
          <span className="sr-only">Include “{row.title}”</span>
          <input
            type="checkbox"
            checked={row.selected}
            onChange={onToggle}
            className="size-4 rounded"
          />
        </label>

        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              defaultValue={row.title}
              onBlur={(e) => e.target.value !== row.title && save({ title: e.target.value })}
              className="min-h-11 w-full rounded-md border-0 px-2 text-sm ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
              style={{ background: 'var(--background)' }}
            />
          ) : (
            <p className="text-sm font-medium break-words">{row.title}</p>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            <span className="font-medium uppercase tracking-wider muted">
              {row.knowledgeType ?? row.kind.replace(/_/g, ' ')}
            </span>
            <span className={band.tone}>{band.label} confidence</span>
            {row.sourceReference && (
              <button
                type="button"
                onClick={() => setShowEvidence((v) => !v)}
                className="inline-flex items-center gap-1 underline decoration-dotted muted"
              >
                <Quote className="size-3" aria-hidden />
                {row.sourceReference}
              </button>
            )}
            {row.state === 'edited' && <span className="text-indigo-600 dark:text-indigo-400">Edited</span>}
          </div>

          {/* Authority is stated on the card, not buried in a heading. */}
          {authority && (
            <p className="mt-1.5 text-[11px] leading-4 text-amber-800 dark:text-amber-300">
              {row.kind === 'decision'
                ? 'Confirming files this as a PROPOSED decision. It will not be active until you approve it on the topic page.'
                : 'Current State is not filed in a batch. Compare it below and accept it on its own.'}
            </p>
          )}

          {row.duplicateOfId && (
            <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-4 muted">
              <Copy className="mt-0.5 size-3 shrink-0" aria-hidden />
              Possible existing record: <span className="font-medium">{row.duplicateReason}</span>. Keep
              it as new, or deselect and link it yourself.
            </p>
          )}

          {row.conflictsWithId && (
            <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-4 text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
              Potential conflict with an active decision: {row.conflictReason}. Nothing has been
              resolved — confirming files this as proposed, side by side with the existing one.
            </p>
          )}

          {editing && (
            <div className="mt-2 space-y-2">
              <textarea
                defaultValue={row.content ?? ''}
                rows={row.kind === 'prompt' ? 6 : 3}
                onBlur={(e) => e.target.value !== (row.content ?? '') && save({ content: e.target.value })}
                className="w-full rounded-md border-0 px-2 py-2 text-sm ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
                style={{ background: 'var(--background)' }}
                placeholder={row.kind === 'prompt' ? 'The prompt body, exactly as it was used' : 'Detail'}
              />
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[11px] muted">
                  Type
                  <select
                    defaultValue={row.kind}
                    onChange={(e) => save({ kind: e.target.value })}
                    className="ml-1 min-h-11 rounded-md border-0 px-2 text-xs ring-1 ring-inset hairline"
                    style={{ background: 'var(--background)' }}
                  >
                    {SUGGESTION_KINDS.filter((k) => k !== 'relationship').map((k) => (
                      <option key={k} value={k}>
                        {k.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </label>
                {row.kind === 'knowledge_entry' && (
                  <label className="text-[11px] muted">
                    Knowledge type
                    <select
                      defaultValue={row.knowledgeType ?? 'progress'}
                      onChange={(e) => save({ knowledgeType: e.target.value as KnowledgeType })}
                      className="ml-1 min-h-11 rounded-md border-0 px-2 text-xs ring-1 ring-inset hairline"
                      style={{ background: 'var(--background)' }}
                    >
                      {KNOWLEDGE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </div>
          )}

          {showEvidence && (
            <div className="mt-2 rounded-md p-2 text-[11px] leading-5 ring-1 ring-inset hairline">
              <p className="font-medium">Why this was suggested</p>
              <ul className="mt-1 space-y-0.5 muted">
                {row.basis.length > 0 ? (
                  row.basis.map((b) => <li key={b}>· {b}</li>)
                ) : (
                  <li>· No evidence was recorded, which is itself a reason to check the source.</li>
                )}
              </ul>
              {row.content && <p className="mt-1.5 whitespace-pre-wrap break-words muted">{row.content}</p>}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-1">
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit “${row.title}”`}
            className="inline-flex size-11 items-center justify-center rounded muted hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
          >
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : editing ? <ChevronDown className="size-4" aria-hidden /> : <Pencil className="size-4" aria-hidden />}
          </button>
          <button
            type="button"
            onClick={onReject}
            aria-label={`Reject “${row.title}”`}
            className="inline-flex size-11 items-center justify-center rounded muted hover:bg-rose-500/10"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </li>
  );
}
