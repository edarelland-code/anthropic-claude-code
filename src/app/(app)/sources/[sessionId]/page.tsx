import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink, GitCommitHorizontal } from 'lucide-react';

import { KnowledgeChip, SourceBadge } from '@/components/ui/badges';
import { getData } from '@/lib/data';
import { formatDate } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * A source session — Layer 1, beside the Layer 2 it produced.
 *
 * This page is what makes "view in original" a real offer rather than a claim.
 * Every entry on the right carries `source_reference`, an anchor into the
 * transcript on the left, so a summary can always be checked against what was
 * actually said (ARCHITECTURE §7).
 *
 * Nothing here is editable. Layer 1 is written once: if a summary turns out to
 * be wrong, the transcript is the evidence that proves it, and evidence that
 * can be corrected after the fact is not evidence.
 */
export default async function SourceSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const data = await getData();

  const session = await data.sessions.getById(sessionId);
  if (!session) notFound();

  const [entries, topic] = await Promise.all([
    data.knowledge.query({ sourceSessionId: sessionId }),
    session.topicId ? data.topics.getById(session.topicId) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-8">
      <Link
        href={topic ? `/topics/${topic.id}` : '/inbox'}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm muted hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {topic ? topic.name : 'Inbox'}
      </Link>

      <header className="mt-2">
        <h1 className="text-xl font-semibold tracking-tight break-words">
          {session.title || 'Source session'}
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <SourceBadge source={session.sourceType} />
          <time className="text-xs tabular-nums muted" dateTime={session.occurredAt}>
            {formatDate(session.occurredAt)}
          </time>
          {session.externalUrl && (
            <a
              href={session.externalUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex min-h-11 items-center gap-1 text-xs text-indigo-600 hover:underline dark:text-indigo-400"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              Open the original
            </a>
          )}
          {session.commitSha && (
            <span className="inline-flex items-center gap-1 text-xs tabular-nums muted">
              <GitCommitHorizontal className="size-3.5" aria-hidden />
              {session.branch ? `${session.branch} · ` : ''}
              {session.commitSha.slice(0, 8)}
            </span>
          )}
        </div>
        <p className="mt-2 text-xs muted">
          Written once and never edited. Everything on the right was derived from this.
        </p>
      </header>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <section className="min-w-0">
          <h2 className="text-xs font-medium uppercase tracking-wider muted">The original</h2>
          {session.summary && (
            <p className="mt-2 text-sm leading-6 break-words muted">{session.summary}</p>
          )}
          <pre className="mt-2 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-lg p-4 text-xs leading-6 surface">
            {session.rawContent || 'No transcript was stored for this session.'}
          </pre>
        </section>

        <section className="min-w-0">
          <h2 className="text-xs font-medium uppercase tracking-wider muted">
            What was recorded from it · {entries.length}
          </h2>
          {entries.length === 0 ? (
            <p className="mt-2 rounded-lg p-4 text-sm leading-6 muted surface">
              Nothing has been recorded from this session yet. The transcript is kept either way —
              evidence with no entries is still evidence.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {entries.map((entry) => (
                <li key={entry.id} className="rounded-lg p-3.5 surface">
                  <div className="flex flex-wrap items-center gap-2">
                    <KnowledgeChip type={entry.knowledgeType} />
                    {entry.sourceReference && (
                      <span
                        className="text-[11px] tabular-nums muted"
                        title="Where in the original this came from"
                      >
                        {entry.sourceReference}
                      </span>
                    )}
                    {entry.supersededById && (
                      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium muted ring-1 ring-inset hairline">
                        Superseded
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm font-medium leading-6 break-words">{entry.title}</p>
                  {entry.content && (
                    <p className="mt-1 text-sm leading-6 break-words muted">{entry.content}</p>
                  )}
                  {topic && (
                    <Link
                      href={`/topics/${topic.id}#${entry.id}`}
                      className="mt-1 inline-flex min-h-11 items-center text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      Open in {topic.name}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
