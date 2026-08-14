import Link from 'next/link';

import { CreateFromSection } from '@/components/topics/create-from-section';
import { getData } from '@/lib/data';
import { PromptVersionControls } from '@/components/topics/lifecycle-controls';
import type { Prompt, PromptVersion, Subtopic } from '@/lib/domain/types';
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

  // Two queries per topic, not two per prompt. The previous shape called
  // getWinning() once for every prompt in the library, which is an N+1 that
  // grew with the thing the page exists to show.
  const perTopic = await Promise.all(
    topics.map(async (t) =>
      (await data.prompts.listWithVersions(t.topic.id)).map((p) => ({ topic: t.topic, ...p })),
    ),
  );
  const all = perTopic.flat();
  const winners = all.filter((p) => p.winningVersionId !== null);
  const rest = all.filter((p) => p.winningVersionId === null);

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
                {winners.map(({ topic, prompt, versions, winningVersionId, winningReason }) => {
                  // The exact version that won — resolved by id, never by
                  // taking the newest (rule 9a).
                  const winner = versions.find((v) => v.id === winningVersionId) ?? null;
                  return (
                  <li key={prompt.id} id={prompt.id} className="relative overflow-hidden rounded-lg p-4 surface">
                    <span className="absolute inset-y-0 left-0 w-1 bg-cyan-500" aria-hidden />
                    <div className="pl-2">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <h3 className="text-sm font-medium break-words">{prompt.title}</h3>
                        <span className="inline-flex items-center rounded bg-cyan-50 px-1.5 py-0.5 text-[11px] font-medium text-cyan-700 ring-1 ring-inset ring-cyan-600/20 dark:bg-cyan-500/10 dark:text-cyan-300 dark:ring-cyan-400/20">
                          Winning v{winner?.version ?? '—'}
                        </span>
                        <Link href={`/topics/${topic.id}`} className="inline-flex min-h-11 items-center text-xs muted hover:underline">
                          {topic.name}
                        </Link>
                        <time className="ml-auto text-xs tabular-nums muted" dateTime={prompt.updatedAt}>
                          {formatDate(prompt.updatedAt)}
                        </time>
                      </div>
                      {winningReason && (
                        <p className="mt-1.5 text-sm leading-6 break-words muted">
                          <span className="font-medium">Why this one:</span> {winningReason}
                        </p>
                      )}
                      {/* The winning version's body — what "Copy Winning Prompt" copies. */}
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md p-3 text-xs leading-6 hairline">
                        {winner?.body ?? 'The selected version is no longer available.'}
                      </pre>
                      <PromptVersions
                        prompt={prompt}
                        topicId={topic.id}
                        versions={versions}
                        winningVersionId={winningVersionId}
                      />
                    </div>
                  </li>
                  );
                })}
              </ul>
            </section>
          )}

          {rest.length > 0 && (
            <section className="mt-8">
              <h2 className="text-xs font-medium uppercase tracking-wider muted">
                No winner chosen yet · {rest.length}
              </h2>
              <ul className="mt-2 space-y-2">
                {rest.map(({ topic, prompt, versions }) => {
                  const current = versions[0] ?? null;
                  return (
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
                        <Link href={`/topics/${topic.id}`} className="inline-flex min-h-11 items-center text-xs muted hover:underline">
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
                      <PromptVersions
                        prompt={prompt}
                        topicId={topic.id}
                        versions={versions}
                        winningVersionId={null}
                      />
                    </div>
                  </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Every version, with its outcome and the control to re-rate it.
 *
 * Shown because "which version won" is only answerable next to the versions
 * that did not. Collapsed by default: the winning body is what a reader wants
 * first, and the history is what they want when that stops being true.
 */
function PromptVersions({
  prompt,
  topicId,
  versions,
  winningVersionId,
}: {
  prompt: Prompt;
  topicId: string;
  versions: PromptVersion[];
  winningVersionId: string | null;
}) {
  if (versions.length === 0) return null;
  return (
    <details className="mt-2">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs muted">
        {versions.length} {versions.length === 1 ? 'version' : 'versions'} · re-rate or change the
        winner
      </summary>
      <ul className="mt-2 space-y-3">
        {versions.map((v) => (
          <li key={v.id} id={v.id} className="rounded-md p-3 ring-1 ring-inset hairline">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium">v{v.version}</span>
              <span className="rounded px-1.5 py-0.5 text-[11px] muted ring-1 ring-inset hairline">
                {v.result.replace(/_/g, ' ')}
              </span>
              {v.id === winningVersionId && (
                <span className="rounded bg-cyan-50 px-1.5 py-0.5 text-[11px] font-medium text-cyan-700 ring-1 ring-inset ring-cyan-600/20 dark:bg-cyan-500/10 dark:text-cyan-300 dark:ring-cyan-400/20">
                  Winner
                </span>
              )}
              <time className="ml-auto text-xs tabular-nums muted" dateTime={v.createdAt}>
                {formatDate(v.createdAt)}
              </time>
            </div>
            <PromptVersionControls
              version={v}
              promptId={prompt.id}
              topicId={topicId}
              isWinner={v.id === winningVersionId}
            />
          </li>
        ))}
      </ul>
    </details>
  );
}
