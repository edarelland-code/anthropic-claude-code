import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, CircleAlert, Scale, Sparkles } from 'lucide-react';

import { KnowledgeChip, Progress, SourceBadge, StatusPill } from '@/components/ui/badges';
import { getData } from '@/lib/data';
import { formatDayHeading } from '@/lib/utils';
import { freshness, groupByDay } from '@/lib/utils';

import { AddEntryForm } from './add-entry-form';
import { AddSubtopicForm } from './add-subtopic-form';
import { CurrentStateForm } from './current-state-form';
import { OpenIssues } from './open-issues';
import { ResumePanel } from './resume-panel';

export const dynamic = 'force-dynamic';

export default async function TopicPage({ params }: { params: Promise<{ topicId: string }> }) {
  const { topicId } = await params;
  const data = await getData();
  const ctx = await data.topics.getContext(topicId);
  if (!ctx) notFound();

  const { topic, subtopics, counts, currentEntries, timeline, activeDecisions, openActions } = ctx;
  const fresh = freshness(topic.lastMeaningfulUpdateAt);
  const nextStep = openActions.find((a) => a.kind === 'next_step') ?? null;
  const days = groupByDay(timeline, (e) => e.occurredAt);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
      <Link href="/topics" className="inline-flex items-center gap-1.5 text-sm muted hover:underline">
        <ArrowLeft className="size-4" aria-hidden />
        Topics
      </Link>

      {/* Header: what is this, and how fresh is it */}
      <header className="mt-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{topic.name}</h1>
          <span className="rounded px-1.5 py-0.5 text-[11px] font-medium muted ring-1 ring-inset hairline">
            {topic.status}
          </span>
          <span className={fresh.stale ? 'text-xs text-amber-600 dark:text-amber-400' : 'text-xs muted'}>
            {fresh.label}
          </span>
        </div>
        {topic.description && (
          <p className="mt-2 max-w-prose text-sm leading-6 muted">{topic.description}</p>
        )}
        <div className="mt-3 max-w-xs">
          <Progress value={topic.progress} />
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          {/* CURRENT — the top of the page answers "where are we now" */}
          <section className="rounded-lg p-4 surface sm:p-5">
            <h2 className="text-xs font-medium uppercase tracking-wider muted">Current</h2>
            <CurrentStateForm
              topicId={topic.id}
              expectedUpdatedAt={topic.updatedAt}
              goal={topic.goal}
              currentState={topic.currentState}
              progress={topic.progress}
              resumeTriggerIf={topic.resumeTriggerIf}
              resumeTriggerThen={topic.resumeTriggerThen}
              nextStep={nextStep?.title ?? null}
            />
          </section>

          {/* What is decided, and what is unresolved */}
          <div className="grid gap-4 sm:grid-cols-2">
            <section className="rounded-lg p-4 surface">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Scale className="size-4 muted" aria-hidden />
                Active decisions
                <span className="ml-auto text-xs muted">{activeDecisions.length}</span>
              </h2>
              {activeDecisions.length === 0 ? (
                <p className="mt-3 text-sm leading-5 muted">
                  None recorded. The Decision Ledger — with reasons, alternatives, and supersession
                  — is built in Phase 2.
                </p>
              ) : (
                <ul className="mt-3 space-y-2.5">
                  {activeDecisions.map((d) => (
                    <li key={d.id} className="border-l-2 border-violet-500 pl-2.5">
                      <p className="text-sm font-medium">{d.title}</p>
                      {d.reason && <p className="mt-0.5 text-sm leading-5 muted">{d.reason}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <OpenIssues topicId={topic.id} actions={openActions} />
          </div>

          {/* Subtopics */}
          <section className="rounded-lg p-4 surface">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold">Subtopics</h2>
              <span className="text-xs muted">{counts.subtopics}</span>
            </div>
            {subtopics.length > 0 && (
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {subtopics.map((s) => (
                  <li key={s.id} className="rounded-md border p-2.5 hairline">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    {s.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs leading-5 muted">{s.description}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <AddSubtopicForm topicId={topic.id} />
          </section>

          {/* Capture */}
          <section className="rounded-lg p-4 surface">
            <h2 className="text-sm font-semibold">Add knowledge</h2>
            <p className="mt-1 text-sm muted">
              Typed entries, not generic notes. Source is recorded as metadata.
            </p>
            <AddEntryForm topicId={topic.id} subtopics={subtopics} />
          </section>

          {/* Current State vs History, on one page */}
          <section>
            <div className="mb-2.5 flex items-baseline gap-3">
              <h2 className="text-sm font-semibold">Timeline</h2>
              <span className="text-xs muted">
                {timeline.length} entries · {currentEntries.length} current
              </span>
            </div>
            {timeline.length === 0 ? (
              <p className="rounded-lg p-4 text-sm muted surface">
                Nothing recorded yet. Add an entry above, or paste a transcript into the Inbox once
                Phase 3 lands.
              </p>
            ) : (
              <ol className="space-y-5">
                {days.map(({ day, items }) => (
                  <li key={day}>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wider muted">
                      {formatDayHeading(items[0]!.occurredAt)}
                    </p>
                    <ul className="space-y-2">
                      {items.map((entry) => (
                        <li
                          key={entry.id}
                          className={`rounded-lg p-3.5 surface ${entry.status !== 'active' ? 'opacity-70' : ''}`}
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                            <KnowledgeChip type={entry.knowledgeType} />
                            <SourceBadge source={entry.sourceType} />
                            <StatusPill status={entry.status} />
                          </div>
                          <p className="mt-1.5 text-sm font-medium">{entry.title}</p>
                          {entry.content && (
                            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 muted">
                              {entry.content}
                            </p>
                          )}
                          {entry.supersedesReason && (
                            <p className="mt-2 border-l-2 border-amber-500 pl-2.5 text-xs leading-5 muted">
                              Superseded — {entry.supersedesReason}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        {/* Right contextual panel — becomes a section on mobile, not a hidden gesture */}
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <ResumePanel topic={topic} />

          <section className="rounded-lg p-4 surface">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4 muted" aria-hidden />
              At a glance
            </h2>
            <dl className="mt-3 space-y-1.5 text-sm">
              {(
                [
                  ['Entries', counts.entries],
                  ['Subtopics', counts.subtopics],
                  ['Sessions', counts.sessions],
                  ['Decisions', counts.decisions],
                  ['Ideas', counts.ideas],
                  ['Prompts', counts.prompts],
                  ['Files', counts.files],
                  ['Open items', counts.openActions],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="muted">{label}</dt>
                  <dd className="tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          {counts.sessions === 0 && (
            <p className="flex gap-2 rounded-lg p-3.5 text-xs leading-5 muted surface">
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              No source sessions linked yet. Transcript import lands in Phase 3 and automatic
              Claude Code ingestion in Phase 5.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
