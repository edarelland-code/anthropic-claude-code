import { Brain } from 'lucide-react';

import type { MasterTopicMemory } from '@/lib/resume/memory';

/**
 * Master Topic Memory.
 *
 * Everything here is derived on read from the append-only tables (AD-8), so it
 * cannot drift from the records it summarises and there is nothing to keep in
 * step. It is the structure Phase 4's Resume will render into a prompt; Phase 2
 * builds and displays it, without automated summarisation.
 *
 * The two halves matter equally. "What is true now" comes from the current
 * decisions and entries; "what has been ruled out" comes from the superseded
 * and rejected ones, with reasons. A memory that carried only the first half
 * would let a fresh session re-propose something already rejected, which is the
 * failure the whole product exists to prevent (rule 9).
 */

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 first:mt-0">
      <h3 className="text-xs font-medium uppercase tracking-wider muted">{title}</h3>
      {hint && <p className="mt-0.5 text-xs muted opacity-80">{hint}</p>}
      <div className="mt-1.5 text-sm leading-6">{children}</div>
    </div>
  );
}

export function MasterMemory({ memory }: { memory: MasterTopicMemory }) {
  if (memory.isEmpty) {
    return (
      <section className="rounded-lg p-4 surface sm:p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Brain className="size-4" aria-hidden />
          Master Topic Memory
        </h2>
        <p className="mt-2 text-sm leading-6 muted">
          Nothing to assemble yet. Set a goal, record a decision, or add a next step, and this builds
          itself from those records — it is never written directly.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg p-4 surface sm:p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Brain className="size-4" aria-hidden />
        Master Topic Memory
      </h2>
      <p className="mt-1 text-xs muted">
        Assembled from this topic&apos;s records on every read. Nothing here is stored separately.
      </p>

      {memory.currentObjective && (
        <Section title="Current objective">
          <p className="break-words">{memory.currentObjective}</p>
        </Section>
      )}

      {memory.currentState && (
        <Section title="Where we are">
          <p className="whitespace-pre-line break-words">{memory.currentState}</p>
        </Section>
      )}

      {memory.activeDecisions.length > 0 && (
        <Section title={`Active decisions · ${memory.activeDecisions.length}`}>
          <ul className="space-y-1.5">
            {memory.activeDecisions.map((d) => (
              <li key={d.id} className="break-words">
                <span className="font-medium">{d.title}</span>
                {d.reason && <span className="muted"> — {d.reason}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {memory.winningPrompts.length > 0 && (
        <Section
          title={`Winning prompts · ${memory.winningPrompts.length}`}
          hint="The exact version that won, which is not always the latest."
        >
          <ul className="space-y-2">
            {memory.winningPrompts.map((p) => (
              <li key={p.promptId}>
                <span className="font-medium break-words">{p.title}</span>{' '}
                <span className="muted">v{p.version}</span>
                {p.reason && <span className="muted"> — {p.reason}</span>}
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md p-2.5 text-xs leading-6 hairline">
                  {p.body}
                </pre>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {memory.blockers.length > 0 && (
        <Section title={`Blockers · ${memory.blockers.length}`}>
          <ul className="space-y-1">
            {memory.blockers.map((a) => (
              <li key={a.id} className="break-words">
                {a.title}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {memory.openQuestions.length > 0 && (
        <Section title={`Open questions · ${memory.openQuestions.length}`}>
          <ul className="space-y-1">
            {memory.openQuestions.map((a) => (
              <li key={a.id} className="break-words">
                {a.title}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {memory.remainingWork.length > 0 && (
        <Section title={`Remaining work · ${memory.remainingWork.length}`}>
          <ol className="space-y-1">
            {memory.remainingWork.map((a) => (
              <li key={a.id} className="break-words">
                {a.title}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {memory.nextAction && (
        <Section title="Next action">
          <p className="break-words font-medium">{memory.nextAction.title}</p>
        </Section>
      )}

      {memory.requirements.length > 0 && (
        <Section title={`Requirements · ${memory.requirements.length}`}>
          <ul className="space-y-1">
            {memory.requirements.map((e) => (
              <li key={e.id} className="break-words">
                {e.title}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {memory.implemented.length > 0 && (
        <Section title={`Implemented · ${memory.implemented.length}`}>
          <ul className="space-y-1">
            {memory.implemented.slice(0, 8).map((e) => (
              <li key={e.id} className="break-words">
                {e.title}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* The avoid-list. Its presence here is the point of never deleting. */}
      {memory.removedOrRejected.length > 0 && (
        <Section
          title={`Ruled out · ${memory.removedOrRejected.length}`}
          hint="Kept so it is not proposed again. Each carries why."
        >
          <ul className="space-y-1.5">
            {memory.removedOrRejected.map((a, i) => (
              <li key={`${a.kind}-${i}`} className="break-words">
                <span className="line-through opacity-70">{a.title}</span>
                {a.reason && <span className="muted"> — {a.reason}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </section>
  );
}
