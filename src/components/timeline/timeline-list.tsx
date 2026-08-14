import Link from 'next/link';

import { KNOWLEDGE_TYPE_META, SOURCE_META } from '@/lib/domain/knowledge';
import type { KnowledgeType, TimelineEvent } from '@/lib/domain/types';
import { cn, formatDate } from '@/lib/utils';

/**
 * The unified Timeline, rendered from the `timeline_events` projection.
 *
 * Colour carries knowledge type and nothing else (rule 23): the left rail and
 * the chip come from KNOWLEDGE_TYPE_META, and the source is a monochrome badge
 * beside them. Claude Chat, Cowork, and Code are metadata here, never the
 * organising principle (rule 2).
 *
 * Superseded and rejected rows stay in place and are labelled rather than
 * hidden — the Timeline is the history, and removing them would leave the
 * "why did we change our mind" question unanswerable (rules 5 and 7).
 */

/** Maps a projection `kind` onto the presentation metadata for its type. */
function metaFor(event: TimelineEvent) {
  const direct = KNOWLEDGE_TYPE_META[event.kind as KnowledgeType];
  if (direct) return direct;
  // Kinds the projection emits that are not knowledge types.
  const fallback: Record<string, KnowledgeType> = {
    next_step: 'next_step',
    repo_file: 'file',
    upload: 'file',
    url: 'link',
    session: 'important_context',
  };
  return KNOWLEDGE_TYPE_META[fallback[event.kind] ?? 'important_context'];
}

/** Where a row's detail lives. Not every record type has a page yet. */
function hrefFor(event: TimelineEvent): string | null {
  switch (event.entityType) {
    case 'decision':
      return `/decisions#${event.id}`;
    case 'idea':
      return `/ideas#${event.id}`;
    case 'prompt_version':
      return `/prompts#${event.id}`;
    default:
      return `/topics/${event.topicId}`;
  }
}

const SUPERSEDED = new Set(['superseded', 'rejected', 'deprecated', 'archived', 'replaced', 'dropped', 'failed']);

export function TimelineList({
  events,
  emptyMessage = 'Nothing recorded yet.',
  showTopicLink = false,
  topicNames,
}: {
  events: TimelineEvent[];
  emptyMessage?: string;
  showTopicLink?: boolean;
  topicNames?: Map<string, string>;
}) {
  if (events.length === 0) {
    return <p className="rounded-lg p-6 text-sm muted surface">{emptyMessage}</p>;
  }

  return (
    <ol className="space-y-2">
      {events.map((event) => {
        const meta = metaFor(event);
        const href = hrefFor(event);
        const isPast = event.status !== null && SUPERSEDED.has(event.status);
        return (
          <li
            key={`${event.entityType}-${event.id}`}
            id={event.id}
            className={cn(
              'relative flex gap-3 overflow-hidden rounded-lg p-3 surface sm:p-4',
              isPast && 'opacity-70',
            )}
          >
            <span className={cn('absolute inset-y-0 left-0 w-1', meta.accent)} aria-hidden />

            <div className="min-w-0 flex-1 pl-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={cn(
                    'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                    meta.chip,
                  )}
                >
                  {meta.label}
                </span>

                {event.sourceType && (
                  <span
                    className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] muted ring-1 ring-inset hairline"
                    title={SOURCE_META[event.sourceType].label}
                  >
                    {SOURCE_META[event.sourceType].short}
                  </span>
                )}

                {isPast && (
                  <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium muted ring-1 ring-inset hairline">
                    {event.status![0]!.toUpperCase() + event.status!.slice(1).replace(/_/g, ' ')}
                  </span>
                )}

                <time className="ml-auto shrink-0 text-xs tabular-nums muted" dateTime={event.occurredAt}>
                  {formatDate(event.occurredAt)}
                </time>
              </div>

              <h3 className="mt-1.5 text-sm font-medium break-words">
                {href ? (
                  // min-h-11 keeps the tap target usable on a phone; the row is
                  // already tall enough on desktop that this changes nothing there.
                  <Link href={href} className="inline-flex min-h-11 items-center hover:underline">
                    {event.title}
                  </Link>
                ) : (
                  <span className="inline-flex min-h-11 items-center">{event.title}</span>
                )}
              </h3>

              {event.summary && (
                <p className="mt-1 line-clamp-3 text-sm leading-6 break-words muted">{event.summary}</p>
              )}

              {showTopicLink && topicNames?.get(event.topicId) && (
                <Link
                  href={`/topics/${event.topicId}`}
                  className="mt-1.5 inline-flex min-h-11 items-center text-xs muted hover:underline"
                >
                  {topicNames.get(event.topicId)}
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
