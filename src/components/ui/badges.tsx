import { KNOWLEDGE_TYPE_META, SOURCE_META } from '@/lib/domain/knowledge';
import type { EntryStatus, KnowledgeType, SourceType } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

/** Colour signals knowledge type and nothing else (CLAUDE.md rule 23). */
export function KnowledgeChip({ type, className }: { type: KnowledgeType; className?: string }) {
  const meta = KNOWLEDGE_TYPE_META[type];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        meta.chip,
        className,
      )}
    >
      {meta.label}
    </span>
  );
}

/** Source is secondary and monochrome — it is metadata, not organization. */
export function SourceBadge({ source, className }: { source: SourceType; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] muted ring-1 ring-inset hairline',
        className,
      )}
      title={SOURCE_META[source].label}
    >
      {SOURCE_META[source].short}
    </span>
  );
}

export function StatusPill({ status }: { status: EntryStatus }) {
  if (status === 'active') return null;
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium muted ring-1 ring-inset hairline">
      {status[0]!.toUpperCase() + status.slice(1)}
    </span>
  );
}

export function Progress({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/10"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-indigo-600" style={{ width: `${clamped}%` }} />
      </div>
      <span className="shrink-0 text-xs tabular-nums muted">{clamped}%</span>
    </div>
  );
}
