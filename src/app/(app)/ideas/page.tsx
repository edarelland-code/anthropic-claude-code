import Link from 'next/link';

import { CreateFromSection } from '@/components/topics/create-from-section';
import { getData } from '@/lib/data';
import type { IdeaStatus, Subtopic } from '@/lib/domain/types';
import { cn, formatDate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * The Idea Library, grouped by lifecycle state.
 *
 * A rejected idea keeps its rationale and stays visible. That is deliberate:
 * "we already tried this and here is why it did not work" is the answer to the
 * question this product exists to answer, and deleting it would throw the
 * answer away (rule 9).
 */

const ORDER: IdeaStatus[] = ['suggested', 'considering', 'approved', 'implemented', 'deferred', 'rejected'];

const META: Record<IdeaStatus, { label: string; accent: string; note: string }> = {
  suggested: { label: 'Suggested', accent: 'bg-amber-500', note: 'Captured, not yet judged' },
  considering: { label: 'Considering', accent: 'bg-amber-400', note: 'Being weighed' },
  approved: { label: 'Approved', accent: 'bg-emerald-500', note: 'Agreed, not yet built' },
  implemented: { label: 'Implemented', accent: 'bg-emerald-600', note: 'Built' },
  deferred: { label: 'Deferred', accent: 'bg-slate-400', note: 'Good, but not now' },
  rejected: { label: 'Rejected', accent: 'bg-rose-500', note: 'Ruled out — kept so it is not re-proposed' },
};

export default async function IdeasPage() {
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
    topics.map(async (t) => ({ topic: t.topic, ideas: await data.ideas.listForTopic(t.topic.id) })),
  );
  const all = perTopic.flatMap(({ topic, ideas }) => ideas.map((idea) => ({ topic, idea })));

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:py-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Ideas</h1>
        <p className="mt-1 text-sm muted">
          Suggestions from any source, and what became of them. Rejected ideas stay, with the reason.
        </p>
      </header>

      <div className="mt-5">
        <CreateFromSection
          topics={topics.map((t) => t.topic)}
          subtopicsByTopic={subtopicsByTopic}
          label="Idea"
        />
      </div>

      {all.length === 0 ? (
        <p className="mt-6 rounded-lg p-6 text-sm muted surface">
          No ideas captured yet. Add one from a topic page.
        </p>
      ) : (
        ORDER.filter((status) => all.some((a) => a.idea.status === status)).map((status) => {
          const group = all.filter((a) => a.idea.status === status);
          const meta = META[status];
          return (
            <section key={status} className="mt-6">
              <h2 className="text-xs font-medium uppercase tracking-wider muted">
                {meta.label} · {group.length}
                <span className="ml-2 normal-case tracking-normal opacity-80">{meta.note}</span>
              </h2>
              <ul className="mt-2 space-y-2">
                {group.map(({ topic, idea }) => (
                  <li
                    key={idea.id}
                    id={idea.id}
                    className={cn(
                      'relative overflow-hidden rounded-lg p-4 surface',
                      status === 'rejected' && 'opacity-75',
                    )}
                  >
                    <span className={cn('absolute inset-y-0 left-0 w-1', meta.accent)} aria-hidden />
                    <div className="pl-2">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <h3 className="text-sm font-medium break-words">{idea.title}</h3>
                        <Link href={`/topics/${topic.id}`} className="inline-flex min-h-11 items-center text-xs muted hover:underline">
                          {topic.name}
                        </Link>
                        <time className="ml-auto text-xs tabular-nums muted" dateTime={idea.createdAt}>
                          {formatDate(idea.createdAt)}
                        </time>
                      </div>
                      {idea.idea && (
                        <p className="mt-1.5 text-sm leading-6 break-words">{idea.idea}</p>
                      )}
                      {idea.rationale && (
                        <p className="mt-1.5 whitespace-pre-line text-sm leading-6 break-words muted">
                          {idea.rationale}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
