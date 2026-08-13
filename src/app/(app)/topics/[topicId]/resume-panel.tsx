import { PlayCircle } from 'lucide-react';

import type { Topic } from '@/lib/domain/types';

/**
 * Resume is the product's payoff and lands in Phase 4 with the full context
 * assembler (3 densities × 3 targets, including the rejected-directions
 * avoid-list). Until then this panel states what it will do and shows the
 * resume trigger that already exists — it does not generate half a prompt and
 * call it Resume (CLAUDE.md rule 14).
 */
export function ResumePanel({ topic }: { topic: Topic }) {
  const hasTrigger = Boolean(topic.resumeTriggerIf || topic.resumeTriggerThen);

  return (
    <section className="rounded-lg p-4 surface">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <PlayCircle className="size-4 muted" aria-hidden />
        Resume in Claude
        <span className="ml-auto rounded px-1.5 py-0.5 text-[11px] font-medium muted ring-1 ring-inset hairline">
          Phase 4
        </span>
      </h2>

      {hasTrigger ? (
        <div className="mt-3 rounded-md border p-3 hairline">
          <p className="text-sm leading-6">
            <span className="font-medium">IF</span> {topic.resumeTriggerIf ?? '—'}
          </p>
          <p className="text-sm leading-6">
            <span className="font-medium">THEN</span> {topic.resumeTriggerThen ?? '—'}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm leading-6 muted">
          Set a resume trigger in Current above so future-you knows where to pick up.
        </p>
      )}

      <p className="mt-3 text-sm leading-6 muted">
        Phase 4 generates a continuation prompt for Claude Chat, Cowork, or Claude Code at
        Compact, Standard, or Full Audit density — including the directions already rejected, so a
        fresh session does not re-propose them.
      </p>
    </section>
  );
}
