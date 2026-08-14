import Link from 'next/link';

import { TimelineList } from '@/components/timeline/timeline-list';
import { getData } from '@/lib/data';
import { TIMELINE_FILTERS, type TimelineFilterKey } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * Cross-topic history.
 *
 * Reads the `timeline_events` projection, so ordering and filtering happen in
 * the database across every record type at once rather than by merging eight
 * collections here. Row-level security on the underlying tables decides what is
 * visible; this page adds no filtering of its own for that.
 */

const FILTER_LABELS: Record<TimelineFilterKey, string> = {
  all: 'All',
  decisions: 'Decisions',
  ideas: 'Ideas',
  prompts: 'Prompts',
  implementations: 'Implementations',
  changes: 'Changes',
  bugs: 'Bugs',
  fixes: 'Fixes',
  files: 'Files',
  blockers: 'Blockers',
  milestones: 'Milestones',
  progress: 'Progress',
  research: 'Research',
};

const SOURCE_FILTERS = [
  { key: 'claude_chat', label: 'Claude Chat' },
  { key: 'claude_cowork', label: 'Cowork' },
  { key: 'claude_code', label: 'Claude Code' },
  { key: 'manual', label: 'Manual' },
] as const;

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; source?: string; since?: string }>;
}) {
  const params = await searchParams;
  const filter = (params.filter ?? 'all') as TimelineFilterKey;
  const kinds = TIMELINE_FILTERS[filter] ?? [];
  const source = params.source;

  const data = await getData();
  const workspace = await data.workspaces.getDefault();

  const [events, topics] = workspace
    ? await Promise.all([
        data.timeline.query({
          workspaceId: workspace.id,
          kinds: kinds.length ? [...kinds] : undefined,
          sourceTypes: source ? [source as never] : undefined,
          since: params.since,
          limit: 200,
        }),
        data.topics.list(workspace.id, { includeArchived: true }),
      ])
    : [[], []];

  const topicNames = new Map(topics.map((t) => [t.topic.id, t.topic.name]));

  const href = (next: Partial<{ filter: string; source: string }>) => {
    const q = new URLSearchParams();
    const f = next.filter ?? filter;
    const s = 'source' in next ? next.source : source;
    if (f && f !== 'all') q.set('filter', f);
    if (s) q.set('source', s);
    const qs = q.toString();
    return qs ? `/timeline?${qs}` : '/timeline';
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Timeline</h1>
        <p className="mt-1 text-sm muted">
          Every topic, every source, in the order it happened. Superseded and rejected entries stay
          here — labelled, not removed.
        </p>
      </header>

      <nav aria-label="Knowledge type" className="mt-5 flex flex-wrap gap-1.5">
        {(Object.keys(TIMELINE_FILTERS) as TimelineFilterKey[]).map((key) => (
          <Link
            key={key}
            href={href({ filter: key })}
            className={cn(
              'inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm hairline',
              key === filter ? 'bg-indigo-600 text-white' : 'muted surface hover:underline',
            )}
          >
            {FILTER_LABELS[key]}
          </Link>
        ))}
      </nav>

      <nav aria-label="Source" className="mt-2 flex flex-wrap gap-1.5">
        <Link
          href={href({ source: undefined })}
          className={cn(
            'inline-flex min-h-11 items-center rounded-md px-3 py-2 text-xs hairline',
            !source ? 'bg-black/[0.06] dark:bg-white/10' : 'muted surface hover:underline',
          )}
        >
          Any source
        </Link>
        {SOURCE_FILTERS.map((s) => (
          <Link
            key={s.key}
            href={href({ source: s.key })}
            className={cn(
              'inline-flex min-h-11 items-center rounded-md px-3 py-2 text-xs hairline',
              source === s.key ? 'bg-black/[0.06] dark:bg-white/10' : 'muted surface hover:underline',
            )}
          >
            {s.label}
          </Link>
        ))}
      </nav>

      <div className="mt-5">
        <TimelineList
          events={events}
          showTopicLink
          topicNames={topicNames}
          emptyMessage={
            filter === 'all' && !source
              ? 'Nothing recorded yet. Add knowledge to a topic and it will appear here.'
              : 'Nothing matches these filters.'
          }
        />
      </div>
    </div>
  );
}
