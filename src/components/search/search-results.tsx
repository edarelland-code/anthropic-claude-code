import Link from 'next/link';

import { SourceBadge } from '@/components/ui/badges';
import { KNOWLEDGE_TYPE_META } from '@/lib/domain/knowledge';
import {
  KNOWLEDGE_TYPES,
  RECORD_STATE_LABELS,
  type EntityType,
  type KnowledgeType,
  type SearchHit,
} from '@/lib/domain/types';
import { cn, formatDate } from '@/lib/utils';

/**
 * Where a hit lives, so a result is a way in rather than a dead end.
 *
 * Every record type resolves to a page that exists. A type with no page of its
 * own resolves to the topic that holds it, with the record's id as the fragment
 * — never to a URL that 404s.
 */
function hrefFor(hit: SearchHit): string {
  switch (hit.entityType) {
    case 'topic':
      return `/topics/${hit.id}`;
    case 'subtopic':
      return hit.topicId ? `/topics/${hit.topicId}#${hit.id}` : '/topics';
    case 'source_session':
      return `/sources/${hit.id}`;
    case 'ingestion_record':
      return `/inbox/${hit.id}`;
    case 'decision':
      return `/decisions#${hit.id}`;
    case 'idea':
      return `/ideas#${hit.id}`;
    case 'prompt':
      return `/prompts#${hit.id}`;
    case 'prompt_version':
      return hit.topicId ? `/topics/${hit.topicId}#${hit.id}` : '/prompts';
    case 'file_reference':
      return '/files';
    default:
      return hit.topicId ? `/topics/${hit.topicId}#${hit.id}` : '/topics';
  }
}

const ENTITY_LABELS: Partial<Record<EntityType, string>> = {
  topic: 'Topic',
  subtopic: 'Subtopic',
  decision: 'Decision',
  idea: 'Idea',
  prompt: 'Prompt',
  prompt_version: 'Prompt version',
  source_session: 'Transcript',
  file_reference: 'File',
  action: 'Work',
  milestone: 'Milestone',
  ingestion_record: 'Captured',
  context_snapshot: 'Saved memory',
};

const isKnowledgeType = (k: string): k is KnowledgeType =>
  (KNOWLEDGE_TYPES as readonly string[]).includes(k);

export function SearchResults({
  hits,
  topics,
  total,
  page,
  pageSize,
  query,
}: {
  hits: SearchHit[];
  topics: { id: string; name: string }[];
  total: number;
  page: number;
  pageSize: number;
  query: Record<string, string | undefined>;
}) {
  if (hits.length === 0) {
    return (
      <div className="mt-6 rounded-lg p-6 surface">
        <p className="text-sm font-medium">No matches.</p>
        <p className="mt-1.5 text-sm leading-6 muted">
          Nothing in this workspace contains those words. Search covers titles, bodies, transcripts,
          prompt bodies and captured items — but it matches whole words, so a partial word will
          find nothing.
        </p>
      </div>
    );
  }

  const pageLink = (n: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v && k !== 'page') params.set(k, v);
    params.set('page', String(n));
    return `/search?${params.toString()}`;
  };

  const lastPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <p className="mt-4 text-xs muted">
        {total} {total === 1 ? 'match' : 'matches'}
        {lastPage > 1 ? ` · page ${page} of ${lastPage}` : ''}
      </p>

      <ul className="mt-2 space-y-2">
        {hits.map((hit) => {
          const topic = topics.find((t) => t.id === hit.topicId);
          const accent = isKnowledgeType(hit.kind)
            ? KNOWLEDGE_TYPE_META[hit.kind].accent
            : 'bg-slate-400';

          return (
            <li
              key={`${hit.entityType}-${hit.id}`}
              className={cn(
                'relative overflow-hidden rounded-lg p-4 surface',
                // History and snapshots are dimmed, never hidden. A superseded
                // decision is often exactly what someone is looking for — they
                // just must not mistake it for the live one.
                hit.recordState !== 'current' && 'opacity-80',
              )}
            >
              <span className={cn('absolute inset-y-0 left-0 w-1', accent)} aria-hidden />
              <div className="pl-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wider muted">
                    {ENTITY_LABELS[hit.entityType] ??
                      (isKnowledgeType(hit.kind) ? KNOWLEDGE_TYPE_META[hit.kind].label : hit.kind)}
                  </span>

                  {hit.recordState !== 'current' && (
                    <span
                      className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium muted ring-1 ring-inset hairline"
                      title={
                        hit.recordState === 'snapshot'
                          ? 'A saved rendering of Master Topic Memory. Derived from records, never a record itself.'
                          : 'Superseded, rejected, closed, or evidence of something that already happened.'
                      }
                    >
                      {RECORD_STATE_LABELS[hit.recordState]}
                    </span>
                  )}

                  {hit.sourceType && <SourceBadge source={hit.sourceType} />}

                  {topic && (
                    <Link
                      href={`/topics/${topic.id}`}
                      className="inline-flex min-h-11 items-center text-xs muted hover:underline"
                    >
                      {topic.name}
                    </Link>
                  )}

                  <time className="ml-auto shrink-0 text-xs tabular-nums muted" dateTime={hit.occurredAt}>
                    {formatDate(hit.occurredAt)}
                  </time>
                </div>

                {/*
                  The link is the touch target, so it has to be one. An inline
                  anchor around a single line of 16px text is a 16px target,
                  which is the same defect Phase 2 fixed on the Timeline and the
                  section pages. `inline-block` keeps long titles wrapping;
                  the padding is negative-margined away so the hit area grows
                  without the layout moving.
                */}
                <h3 className="mt-0.5 text-sm font-medium leading-6 break-words">
                  <Link
                    href={hrefFor(hit)}
                    className="-my-2 inline-block min-h-11 py-2 hover:underline"
                  >
                    {hit.title}
                  </Link>
                </h3>

                {hit.snippet && (
                  <p className="mt-1 line-clamp-3 text-sm leading-6 break-words muted">
                    {hit.snippet}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {lastPage > 1 && (
        <nav className="mt-4 flex items-center justify-between" aria-label="Search results pages">
          {page > 1 ? (
            <Link
              href={pageLink(page - 1)}
              className="inline-flex min-h-11 items-center rounded-md px-3 text-sm ring-1 ring-inset hairline hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
            >
              Previous
            </Link>
          ) : (
            <span />
          )}
          {page < lastPage && (
            <Link
              href={pageLink(page + 1)}
              className="inline-flex min-h-11 items-center rounded-md px-3 text-sm ring-1 ring-inset hairline hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
            >
              Next
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
