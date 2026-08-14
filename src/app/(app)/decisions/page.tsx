import Link from 'next/link';

import { CreateFromSection } from '@/components/topics/create-from-section';
import { getData } from '@/lib/data';
import type { Subtopic } from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * The Decision Ledger, across every topic.
 *
 * Active decisions first, then everything that has been superseded, rejected,
 * or deprecated — kept, never removed, each carrying the reason it stopped
 * being current (rules 5 and 7). That history is the point: it is what stops a
 * later session re-proposing something already ruled out.
 */
export default async function DecisionsPage() {
  const data = await getData();
  const workspace = await data.workspaces.getDefault();
  const topics = workspace ? await data.topics.list(workspace.id, { includeArchived: true }) : [];

  // Subtopics for the picker. Every memory object belongs to a topic (rule 1),
  // so the section-level create action chooses one before showing the form.
  const subtopicsByTopic: Record<string, Subtopic[]> = {};
  for (const t of topics) {
    subtopicsByTopic[t.topic.id] = await data.subtopics.listForTopic(t.topic.id);
  }

  const perTopic = await Promise.all(
    topics.map(async (t) => ({
      topic: t.topic,
      decisions: await data.decisions.listForTopic(t.topic.id),
    })),
  );
  const all = perTopic.flatMap(({ topic, decisions }) =>
    decisions.map((decision) => ({ topic, decision })),
  );

  const current = all.filter((d) => d.decision.status === 'active' && d.decision.supersededById === null);
  const past = all.filter((d) => !(d.decision.status === 'active' && d.decision.supersededById === null));

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:py-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Decisions</h1>
        <p className="mt-1 text-sm muted">
          What was decided, why, and what it replaced. Nothing here is deleted when it stops being
          current.
        </p>
      </header>

      <div className="mt-5">
        <CreateFromSection
          topics={topics.map((t) => t.topic)}
          subtopicsByTopic={subtopicsByTopic}
          label="Decision"
        />
      </div>

      <section className="mt-6">
        <h2 className="text-xs font-medium uppercase tracking-wider muted">
          Current · {current.length}
        </h2>
        {current.length === 0 ? (
          <p className="mt-2 rounded-lg p-6 text-sm muted surface">
            No active decisions yet. Record one from a topic page.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {current.map(({ topic, decision }) => (
              <li key={decision.id} id={decision.id} className="relative overflow-hidden rounded-lg p-4 surface">
                <span className="absolute inset-y-0 left-0 w-1 bg-violet-500" aria-hidden />
                <div className="pl-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h3 className="text-sm font-medium break-words">{decision.title}</h3>
                    <Link href={`/topics/${topic.id}`} className="text-xs muted hover:underline">
                      {topic.name}
                    </Link>
                    <time className="ml-auto text-xs tabular-nums muted" dateTime={decision.decidedAt}>
                      {formatDate(decision.decidedAt)}
                    </time>
                  </div>
                  <p className="mt-1.5 text-sm leading-6 break-words">{decision.decision}</p>
                  {decision.reason && (
                    <p className="mt-1.5 text-sm leading-6 break-words muted">
                      <span className="font-medium">Why:</span> {decision.reason}
                    </p>
                  )}
                  {decision.alternatives.length > 0 && (
                    <p className="mt-1.5 text-sm leading-6 break-words muted">
                      <span className="font-medium">Also considered:</span>{' '}
                      {decision.alternatives.join(' · ')}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-medium uppercase tracking-wider muted">
            History · {past.length}
          </h2>
          <ul className="mt-2 space-y-2">
            {past.map(({ topic, decision }) => (
              <li
                key={decision.id}
                id={decision.id}
                className="relative overflow-hidden rounded-lg p-4 opacity-75 surface"
              >
                <span className="absolute inset-y-0 left-0 w-1 bg-rose-400" aria-hidden />
                <div className="pl-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h3 className="text-sm font-medium break-words">{decision.title}</h3>
                    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium muted ring-1 ring-inset hairline">
                      {decision.status[0]!.toUpperCase() + decision.status.slice(1)}
                    </span>
                    <Link href={`/topics/${topic.id}`} className="text-xs muted hover:underline">
                      {topic.name}
                    </Link>
                    <time className="ml-auto text-xs tabular-nums muted" dateTime={decision.decidedAt}>
                      {formatDate(decision.decidedAt)}
                    </time>
                  </div>
                  <p className="mt-1.5 text-sm leading-6 break-words">{decision.decision}</p>
                  {/* The reason it stopped being current is the whole product. */}
                  {decision.supersedeReason && (
                    <p className="mt-1.5 text-sm leading-6 break-words muted">
                      <span className="font-medium">Replaced because:</span> {decision.supersedeReason}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
