import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, PlayCircle } from 'lucide-react';

import { getData } from '@/lib/data';

import { ResumeFlow } from './resume-flow';
import { ResumeHistory } from './resume-history';

export const dynamic = 'force-dynamic';

/**
 * Resume in Claude.
 *
 * Its own route rather than a panel on the Topic page, for two reasons: the
 * preview needs the width, and a Resume is a thing you come to do — arriving
 * here from Home, from the Topic page or from a subtopic should all land in the
 * same place with the scope already chosen.
 *
 * Everything shown is derived on this request from the authoritative records.
 * No previous export is read; `context_snapshots` is written to and listed
 * below, never consulted while assembling.
 */
export default async function ResumePage({
  params,
  searchParams,
}: {
  params: Promise<{ topicId: string }>;
  searchParams: Promise<{ subtopic?: string }>;
}) {
  const { topicId } = await params;
  const { subtopic } = await searchParams;

  const data = await getData();
  const topic = await data.topics.getById(topicId);
  if (!topic) notFound();

  const [subtopics, history] = await Promise.all([
    data.subtopics.listForTopic(topicId),
    data.resumeHistory.listForTopic(topicId, 10),
  ]);

  const initialSubtopicId = subtopics.some((s) => s.id === subtopic) ? (subtopic ?? null) : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:py-8">
      <Link
        href={`/topics/${topicId}`}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm muted hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {topic.name}
      </Link>

      <header className="mt-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <PlayCircle className="size-5 muted" aria-hidden />
          Resume in Claude
        </h1>
        <p className="mt-1 text-sm leading-6 muted">
          Everything a fresh Claude session needs to continue this work — where it stands, what is
          decided, what was ruled out and why, and what to do next. Assembled from your records, not
          from a previous export.
        </p>
      </header>

      <div className="mt-5">
        <ResumeFlow
          topicId={topicId}
          subtopics={subtopics.map((s) => ({ id: s.id, name: s.name }))}
          initialSubtopicId={initialSubtopicId}
        />
      </div>

      <div className="mt-8">
        <ResumeHistory topicId={topicId} exports={history} subtopics={subtopics} />
      </div>
    </div>
  );
}
