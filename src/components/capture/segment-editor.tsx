'use client';

import { useMemo, useState } from 'react';

import { StatedChip, SuggestedChip, SuggestionNotice } from '@/components/ui/suggestion';
import { KNOWLEDGE_TYPE_META } from '@/lib/domain/knowledge';
import { KNOWLEDGE_TYPES, type KnowledgeType } from '@/lib/domain/types';

/**
 * One row of the confirm gate.
 *
 * `origin` is the whole point of this component. A segment that came from a
 * label the author typed is `stated`; one that came from keyword matching is
 * `suggested`; one the extractor found but could not type is `untyped`. The
 * three look different, read differently, and start in different states —
 * suggestions and untyped sections start EXCLUDED, so the default outcome of
 * clicking straight through is that only what the text actually stated gets
 * recorded (clarification 4).
 */
export interface EditableSegment {
  key: string;
  origin: 'stated' | 'suggested' | 'untyped';
  knowledgeType: KnowledgeType | null;
  title: string;
  content: string | null;
  sourceReference: string | null;
  /** Populated for `suggested` rows: the literal evidence behind the guess. */
  basis?: string[];
  confidence?: number;
}

interface RowState {
  included: boolean;
  knowledgeType: KnowledgeType | '';
  title: string;
}

export function SegmentEditor({
  segments,
  name = 'segments',
  emptyMessage,
}: {
  segments: EditableSegment[];
  name?: string;
  emptyMessage?: string;
}) {
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      segments.map((s) => [
        s.key,
        {
          // Only what the text stated is pre-included. Everything else is an
          // opt-in, so nothing heuristic can be recorded by inattention.
          included: s.origin === 'stated',
          knowledgeType: s.knowledgeType ?? '',
          title: s.title,
        },
      ]),
    ),
  );

  const update = (key: string, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [key]: { ...prev[key]!, ...patch } }));

  /**
   * Only rows that are included AND typed are submitted. A row with no type
   * cannot be serialised into a knowledge entry, so it is silently absent
   * rather than sent as a null the server has to reject.
   */
  const payload = useMemo(
    () =>
      JSON.stringify(
        segments
          .filter((s) => rows[s.key]?.included && rows[s.key]?.knowledgeType)
          .map((s) => ({
            knowledgeType: rows[s.key]!.knowledgeType,
            title: rows[s.key]!.title.trim() || s.title,
            content: s.content,
            sourceReference: s.sourceReference,
            // Recorded so a later reader can tell an accepted suggestion from a
            // fact the transcript stated.
            confidence: s.origin === 'stated' ? 1 : (s.confidence ?? 0.5),
          })),
      ),
    [rows, segments],
  );

  const chosen = segments.filter((s) => rows[s.key]?.included && rows[s.key]?.knowledgeType).length;
  const incomplete = segments.filter((s) => rows[s.key]?.included && !rows[s.key]?.knowledgeType);

  if (segments.length === 0) {
    return (
      <>
        <input type="hidden" name={name} value="[]" />
        <p className="rounded-lg p-4 text-sm leading-6 muted surface">
          {emptyMessage ??
            'Nothing was extracted. The text has no headings or labels to split on, so no entries were invented from it — the original is kept in full either way.'}
        </p>
      </>
    );
  }

  const stated = segments.filter((s) => s.origin === 'stated');
  const proposed = segments.filter((s) => s.origin !== 'stated');

  return (
    <div>
      <input type="hidden" name={name} value={payload} />

      {stated.length > 0 && (
        <section>
          <h3 className="text-xs font-medium uppercase tracking-wider muted">
            From the text · {stated.length}
          </h3>
          <p className="mt-1 text-xs leading-5 muted">
            Each of these was labelled in what you pasted. Uncheck anything you do not want kept.
          </p>
          <ul className="mt-2 space-y-2">
            {stated.map((s) => (
              <Row key={s.key} segment={s} state={rows[s.key]!} onChange={(p) => update(s.key, p)} />
            ))}
          </ul>
        </section>
      )}

      {proposed.length > 0 && (
        <section className={stated.length > 0 ? 'mt-6' : ''}>
          <h3 className="text-xs font-medium uppercase tracking-wider muted">
            Suggested · {proposed.length}
          </h3>
          <SuggestionNotice />
          <ul className="mt-2 space-y-2">
            {proposed.map((s) => (
              <Row key={s.key} segment={s} state={rows[s.key]!} onChange={(p) => update(s.key, p)} />
            ))}
          </ul>
        </section>
      )}

      <p aria-live="polite" className="mt-3 text-xs muted">
        {chosen === 0
          ? 'Nothing selected yet.'
          : `${chosen} ${chosen === 1 ? 'entry' : 'entries'} will be created.`}
        {incomplete.length > 0 && (
          <span className="ml-1 text-amber-700 dark:text-amber-400">
            {incomplete.length} selected {incomplete.length === 1 ? 'row needs' : 'rows need'} a
            type before {incomplete.length === 1 ? 'it' : 'they'} can be saved.
          </span>
        )}
      </p>
    </div>
  );
}

function Row({
  segment,
  state,
  onChange,
}: {
  segment: EditableSegment;
  state: RowState;
  onChange: (patch: Partial<RowState>) => void;
}) {
  const accent = state.knowledgeType ? KNOWLEDGE_TYPE_META[state.knowledgeType].accent : 'bg-transparent';

  return (
    <li className="relative overflow-hidden rounded-lg p-3 surface sm:p-4">
      <span className={`absolute inset-y-0 left-0 w-1 ${accent}`} aria-hidden />
      <div className="pl-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={state.included}
              onChange={(e) => onChange({ included: e.target.checked })}
              className="size-4 rounded"
            />
            <span className="muted">{state.included ? 'Keep' : 'Skip'}</span>
          </label>

          {segment.origin === 'stated' ? (
            <StatedChip />
          ) : (
            <SuggestedChip basis={segment.basis} confidence={segment.confidence} />
          )}

          {segment.sourceReference && (
            <span className="text-[11px] tabular-nums muted" title="Where this came from in the original">
              {segment.sourceReference}
            </span>
          )}

          <select
            value={state.knowledgeType}
            onChange={(e) => onChange({ knowledgeType: e.target.value as KnowledgeType | '' })}
            aria-label="Knowledge type"
            className="ml-auto min-h-11 rounded-md border-0 px-2 text-xs ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
            style={{ background: 'var(--background)' }}
          >
            <option value="">Choose a type…</option>
            {KNOWLEDGE_TYPES.map((t) => (
              <option key={t} value={t}>
                {KNOWLEDGE_TYPE_META[t].label}
              </option>
            ))}
          </select>
        </div>

        <input
          type="text"
          value={state.title}
          onChange={(e) => onChange({ title: e.target.value })}
          aria-label="Entry title"
          maxLength={300}
          className="mt-2 w-full min-h-11 rounded-md border-0 px-2.5 text-sm font-medium ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
          style={{ background: 'var(--background)' }}
        />

        {segment.content && (
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md p-2.5 text-xs leading-6 hairline">
            {segment.content}
          </pre>
        )}
      </div>
    </li>
  );
}
