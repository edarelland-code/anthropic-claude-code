import Link from 'next/link';
import { ArrowRight, Pin } from 'lucide-react';

import { KnowledgeChip, Progress, SourceBadge } from '@/components/ui/badges';
import type { TopicSummary } from '@/lib/domain/types';
import { cn, freshness } from '@/lib/utils';

/**
 * Topic cards replace session cards entirely (CLAUDE.md rule 2). Everything
 * here answers "where did I leave off", not "where did the conversation
 * happen".
 */
export function TopicCard({ summary }: { summary: TopicSummary }) {
  const { topic, counts, sourceTypes, latestChange, nextAction } = summary;
  const fresh = freshness(topic.lastMeaningfulUpdateAt);

  return (
    <Link
      href={`/topics/${topic.id}`}
      className="group flex flex-col rounded-lg p-4 transition-colors surface hover:border-indigo-300 dark:hover:border-indigo-500/40"
    >
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{topic.name}</h3>
        {topic.pinned && <Pin className="size-3.5 shrink-0 muted" aria-label="Pinned" />}
        <span
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
            topic.status === 'blocked'
              ? 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/20'
              : 'muted hairline',
          )}
        >
          {topic.status}
        </span>
      </div>

      {topic.description && (
        <p className="mt-1.5 line-clamp-2 text-sm leading-5 muted">{topic.description}</p>
      )}

      {topic.goal && (
        <p className="mt-2.5 line-clamp-2 text-sm leading-5">
          <span className="text-xs font-medium uppercase tracking-wider muted">Goal · </span>
          {topic.goal}
        </p>
      )}

      <div className="mt-3">
        <Progress value={topic.progress} />
      </div>

      {latestChange && (
        <div className="mt-3 flex items-center gap-2">
          <KnowledgeChip type={latestChange.knowledgeType} />
          <span className="min-w-0 flex-1 truncate text-xs muted">{latestChange.title}</span>
        </div>
      )}

      {nextAction && (
        <p className="mt-2 flex items-start gap-1.5 text-sm">
          <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden />
          <span className="line-clamp-2 leading-5">{nextAction.title}</span>
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-[11px] muted hairline">
        <span className={cn(fresh.stale && 'text-amber-600 dark:text-amber-400')}>{fresh.label}</span>
        <span aria-hidden>·</span>
        <CountList counts={counts} />
      </div>

      {sourceTypes.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {sourceTypes.map((s) => (
            <SourceBadge key={s} source={s} />
          ))}
        </div>
      )}
    </Link>
  );
}

function CountList({ counts }: { counts: TopicSummary['counts'] }) {
  const parts: string[] = [];
  if (counts.subtopics) parts.push(`${counts.subtopics} subtopics`);
  if (counts.entries) parts.push(`${counts.entries} entries`);
  if (counts.sessions) parts.push(`${counts.sessions} sessions`);
  if (counts.decisions) parts.push(`${counts.decisions} decisions`);
  if (counts.prompts) parts.push(`${counts.prompts} prompts`);
  if (counts.files) parts.push(`${counts.files} files`);
  if (parts.length === 0) return <span>No entries yet</span>;
  return <span className="truncate">{parts.join(' · ')}</span>;
}
