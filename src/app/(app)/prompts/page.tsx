import Link from 'next/link';

import { CreateFromSection } from '@/components/topics/create-from-section';
import { getData } from '@/lib/data';
import type { Subtopic } from '@/lib/domain/types';
import { cn, formatDate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * The Prompt Library.
 *
 * Winning is a property of a VERSION, not of a prompt: once a prompt has
 * several versions, "which prompt text produced the best result" cannot be
 * answered at prompt level. The winning body shown here is the exact version
 * that was designated, which is not necessarily the latest — a later version is
 * often an experiment that did worse.
 */
export default async function PromptsPage() {
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
    topics.map(async (t) => {
      const prompts = await data.prompts.listForTopic(t.topic.id);
      const enriched = await Promise.all(
        prompts.map(async ({ prompt, current }) => ({
          topic: t.topic,
          prompt,
          current,
          winning: await data.prompts.getWinning(prompt.id),
        })),
      );
      return enriched;
    }),
  );
  const all = perTopic.flat();
  const winners = all.filter((p) => p.winning !== null);
  const rest = all.filter((p) => p.winning === null);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:py-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Prompts</h1>
        <p className="mt-1 text-sm muted">
          What you asked, which version worked, and the exact text that won. Previous versions are
          never overwritten.
        </p>
      </header>

      <div className="mt-5">
        <CreateFromSection
          topics={topics.map((t) => t.topic)}
          subtopicsByTopic={subtopicsByTopic}
          label="Prompt"
        />
      </div>

      {all.length === 0 ? (
        <p className="mt-6 rounded-lg p-6 text-sm muted surface">
          No prompts saved yet. Save one from a topic page and its versions will be tracked here.
        </p>
      ) : (
        <>
          {winners.length > 0 && (
            <section className="mt-6">
              <h2 className="text-xs font-medium uppercase tracking-wider muted">
                Winning · {winners.length}
              </h2>
              <ul className="mt-2 space-y-2">
                {winners.map(({ topic, prompt, winning }) => (
                  <li key={prompt.id} id={prompt.id} className="relative overflow-hidden rounded-lg p-4 surface">
                    <span className="absolute inset-y-0 left-0 w-1 bg-cyan-500" aria-hidden />
                    <div className="pl-2">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <h3 className="text-sm font-medium break-words">{prompt.title}</h3>
                        <span className="inline-flex items-center rounded bg-cyan-50 px-1.5 py-0.5 text-[11px] font-medium text-cyan-700 ring-1 ring-inset ring-cyan-600/20 dark:bg-cyan-500/10 dark:text-cyan-300 dark:ring-cyan-400/20">
                          Winning v{winning!.version}
                        </span>
                        <Link href={`/topics/${topic.id}`} className="text-xs muted hover:underline">
                          {topic.name}
                        </Link>
                        <time className="ml-auto text-xs tabular-nums muted" dateTime={winning!.selectedAt}>
                          {formatDate(winning!.selectedAt)}
                        </time>
                      </div>
                      {winning!.reason && (
                        <p className="mt-1.5 text-sm leading-6 break-words muted">
                          <span className="font-medium">Why this one:</span> {winning!.reason}
                        </p>
                      )}
                      {/* The winning version's body — what "Copy Winning Prompt" copies. */}
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md p-3 text-xs leading-6 hairline">
                        {winning!.body}
                      </pre>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {rest.length > 0 && (
            <section className="mt-8">
              <h2 className="text-xs font-medium uppercase tracking-wider muted">
                No winner chosen yet · {rest.length}
              </h2>
              <ul className="mt-2 space-y-2">
                {rest.map(({ topic, prompt, current }) => (
                  <li key={prompt.id} id={prompt.id} className="relative overflow-hidden rounded-lg p-4 surface">
                    <span className="absolute inset-y-0 left-0 w-1 bg-blue-500" aria-hidden />
                    <div className="pl-2">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <h3 className="text-sm font-medium break-words">{prompt.title}</h3>
                        {current && (
                          <span
                            className={cn(
                              'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset hairline muted',
                            )}
                          >
                            v{current.version} · {current.result.replace(/_/g, ' ')}
                          </span>
                        )}
                        <Link href={`/topics/${topic.id}`} className="text-xs muted hover:underline">
                          {topic.name}
                        </Link>
                      </div>
                      {prompt.purpose && (
                        <p className="mt-1.5 text-sm leading-6 break-words muted">{prompt.purpose}</p>
                      )}
                      {current && (
                        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md p-3 text-xs leading-6 hairline">
                          {current.body}
                        </pre>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
