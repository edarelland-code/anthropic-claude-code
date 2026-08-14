import Link from 'next/link';
import { PlayCircle } from 'lucide-react';

import type { Subtopic, Topic } from '@/lib/domain/types';

/**
 * The Resume entry point on the Topic page.
 *
 * Prominent because it is the product's payoff: the reason to keep records at
 * all is to be able to walk away and come back. The trigger is shown here too,
 * since "what was I going to do next" is the question this panel answers even
 * before anything is generated.
 *
 * Per-subtopic links carry the scope through, so resuming the App Icon work is
 * one click rather than a landing page plus a selection.
 */
export function ResumePanel({ topic, subtopics }: { topic: Topic; subtopics: Subtopic[] }) {
  const trigger = topic.resumeTriggerIf || topic.resumeTriggerThen;
  const scoped = subtopics.filter((s) => s.status !== 'archived').slice(0, 4);

  return (
    <section className="rounded-lg p-4 surface">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <PlayCircle className="size-4 muted" aria-hidden />
        Resume in Claude
      </h2>

      {trigger ? (
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
          No resume trigger set. Add one below so future-you knows where to pick up.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href={`/topics/${topic.id}/resume`}
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <PlayCircle className="size-4" aria-hidden />
          Resume this topic
        </Link>
      </div>

      {scoped.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium muted">Or resume just one part</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {scoped.map((s) => (
              <Link
                key={s.id}
                href={`/topics/${topic.id}/resume?subtopic=${s.id}`}
                className="inline-flex min-h-11 items-center rounded-full px-3 text-xs ring-1 ring-inset hairline hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
              >
                {s.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      <p className="mt-3 text-xs leading-5 muted">
        Generates a continuation prompt for Claude Chat, Cowork or Claude Code at Compact, Standard
        or Full Audit density — including the directions already rejected, so a fresh session does
        not re-propose them.
      </p>
    </section>
  );
}
