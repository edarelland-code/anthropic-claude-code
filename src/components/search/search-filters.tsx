'use client';

import { SEARCH_TYPE_FILTERS, RECORD_STATES, RECORD_STATE_LABELS, type RecordState, type SearchTypeFilterKey } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

const TYPE_LABELS: Record<SearchTypeFilterKey, string> = {
  all: 'Everything',
  topics: 'Topics',
  knowledge: 'Knowledge',
  decisions: 'Decisions',
  ideas: 'Ideas',
  prompts: 'Prompts',
  sources: 'Transcripts',
  files: 'Files',
  work: 'Work',
  inbox: 'Inbox',
  snapshots: 'Snapshots',
};

/**
 * Filter chips, as radio inputs inside the search form.
 *
 * Radios rather than links: the form already carries the query text, so a chip
 * submits one GET with everything set, and the URL that comes back is exactly
 * the state on screen. It also means filtering works before hydration.
 *
 * A chip whose count is zero is disabled rather than hidden. Hiding it would
 * make the filter row jump around between searches; showing it with a zero says
 * something true — that this kind of record exists but nothing matched.
 */
export function SearchFilters({
  activeType,
  activeState,
  activeTopic,
  topics,
  counts,
  disabled,
}: {
  activeType: SearchTypeFilterKey;
  activeState: RecordState | null;
  activeTopic: string | null;
  topics: { id: string; name: string }[];
  counts: Record<string, number>;
  disabled?: boolean;
}) {
  const countFor = (key: SearchTypeFilterKey) => {
    const types = SEARCH_TYPE_FILTERS[key];
    if (types.length === 0) return Object.values(counts).reduce((a, b) => a + b, 0);
    return types.reduce((sum, t) => sum + (counts[t] ?? 0), 0);
  };

  return (
    <div className="mt-3 space-y-2">
      <fieldset>
        <legend className="sr-only">Filter by record type</legend>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(SEARCH_TYPE_FILTERS) as SearchTypeFilterKey[]).map((key) => {
            const n = countFor(key);
            const active = key === activeType;
            const empty = !disabled && n === 0 && key !== 'all';
            return (
              <label
                key={key}
                className={cn(
                  'inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs ring-1 ring-inset transition-colors',
                  active
                    ? 'bg-indigo-600 font-medium text-white ring-indigo-600'
                    : 'hairline hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
                  empty && !active && 'opacity-45',
                )}
              >
                <input
                  type="radio"
                  name="type"
                  value={key}
                  defaultChecked={active}
                  disabled={empty && !active}
                  onChange={(e) => e.currentTarget.form?.requestSubmit()}
                  className="sr-only"
                />
                {TYPE_LABELS[key]}
                {!disabled && (
                  <span className={cn('tabular-nums', active ? 'text-white/80' : 'muted')}>{n}</span>
                )}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="sr-only">Filter by whether a record is still current</legend>
          <span className="text-xs muted">Show</span>
          {[null, ...RECORD_STATES].map((s) => {
            const active = s === activeState;
            return (
              <label
                key={s ?? 'any'}
                className={cn(
                  'inline-flex min-h-11 cursor-pointer items-center rounded-full px-3 text-xs ring-1 ring-inset transition-colors',
                  active
                    ? 'bg-indigo-600 font-medium text-white ring-indigo-600'
                    : 'hairline hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
                )}
              >
                <input
                  type="radio"
                  name="state"
                  value={s ?? ''}
                  defaultChecked={active}
                  onChange={(e) => e.currentTarget.form?.requestSubmit()}
                  className="sr-only"
                />
                {s === null ? 'Anything' : RECORD_STATE_LABELS[s]}
              </label>
            );
          })}
        </fieldset>

        {topics.length > 0 && (
          <>
            <label htmlFor="search-topic" className="ml-auto text-xs muted">
              In
            </label>
            <select
              id="search-topic"
              name="topic"
              defaultValue={activeTopic ?? ''}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className="min-h-11 max-w-52 rounded-md border-0 px-2 text-xs ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
              style={{ background: 'var(--surface)' }}
            >
              <option value="">Every topic</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
    </div>
  );
}
