import Link from 'next/link';
import { AlertTriangle, ArrowRight, Clock, Plus } from 'lucide-react';

import { TopicCard } from '@/components/topics/topic-card';
import { getData } from '@/lib/data';
import type { TopicSummary } from '@/lib/domain/types';
import { freshness } from '@/lib/utils';

export const dynamic = 'force-dynamic';

/**
 * Home answers, in order: what have I been working on, where did I leave off,
 * what needs attention, what should I resume.
 */
export default async function HomePage() {
  const data = await getData();
  const workspace = await data.workspaces.getDefault();
  if (!workspace) return <EmptyWorkspace />;

  const topics = await data.topics.list(workspace.id);

  const continueWorking = topics.filter((t) => t.nextAction !== null).slice(0, 3);
  const blocked = topics.filter((t) => t.topic.status === 'blocked');
  const recentlyActive = topics.slice(0, 6);
  const stale = topics.filter((t) => freshness(t.topic.lastMeaningfulUpdateAt).days >= 30);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Home</h1>
          <p className="mt-1 text-sm muted">
            {topics.length === 0
              ? 'Nothing on the shelf yet.'
              : `${topics.length} ${topics.length === 1 ? 'topic' : 'topics'} in ${workspace.name}.`}
          </p>
        </div>
        <Link
          href="/topics/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
        >
          <Plus className="size-4" aria-hidden />
          New topic
        </Link>
      </header>

      {topics.length === 0 ? (
        <FirstRun />
      ) : (
        <div className="mt-8 space-y-8">
          {continueWorking.length > 0 && (
            <Section title="Continue working" subtitle="Topics with a defined next action">
              <ul className="space-y-2">
                {continueWorking.map((t) => (
                  <li key={t.topic.id}>
                    <Link
                      href={`/topics/${t.topic.id}`}
                      className="flex items-start gap-3 rounded-lg p-3.5 surface hover:border-indigo-300 dark:hover:border-indigo-500/40"
                    >
                      <ArrowRight className="mt-0.5 size-4 shrink-0 text-indigo-600 dark:text-indigo-400" aria-hidden />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{t.topic.name}</p>
                        <p className="mt-0.5 text-sm leading-5 muted">{t.nextAction?.title}</p>
                      </div>
                      <span className="ml-auto hidden shrink-0 text-xs muted sm:block">
                        {freshness(t.topic.lastMeaningfulUpdateAt).label}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {blocked.length > 0 && (
            <Section title="Waiting / blocked" subtitle="These need a decision or an unblock">
              <TopicGrid topics={blocked} />
            </Section>
          )}

          <Section title="Recently active">
            <TopicGrid topics={recentlyActive} />
          </Section>

          {stale.length > 0 && (
            <Section
              title="Stale topics"
              subtitle="No meaningful update in over a month — context may need review"
              icon={<Clock className="size-4 muted" aria-hidden />}
            >
              <ul className="divide-y rounded-lg surface hairline">
                {stale.map((t) => (
                  <li key={t.topic.id}>
                    <Link
                      href={`/topics/${t.topic.id}`}
                      className="flex items-center gap-3 px-3.5 py-2.5 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">{t.topic.name}</span>
                      <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">
                        {freshness(t.topic.lastMeaningfulUpdateAt).label}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <PhaseTwoNote />
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2.5 flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtitle && <span className="hidden text-xs muted sm:inline">· {subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

function TopicGrid({ topics }: { topics: TopicSummary[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {topics.map((t) => (
        <TopicCard key={t.topic.id} summary={t} />
      ))}
    </div>
  );
}

function FirstRun() {
  return (
    <div className="mt-8 rounded-lg p-6 surface">
      <h2 className="text-sm font-semibold">Start with a topic</h2>
      <p className="mt-2 max-w-prose text-sm leading-6 muted">
        A topic is a thing you are working on — a product, a feature, an area of research. Claude
        Chat, Cowork, and Claude Code are sources that feed into it, so you never have to remember
        which conversation held what.
      </p>
      <Link
        href="/topics/new"
        className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
      >
        <Plus className="size-4" aria-hidden />
        Create your first topic
      </Link>
    </div>
  );
}

function PhaseTwoNote() {
  return (
    <p className="flex items-start gap-2 rounded-lg p-3.5 text-xs leading-5 muted surface">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>
        Recent Decisions, New Ideas, Winning Prompts, and Unsorted Inbox belong on this dashboard
        and arrive in Phases 2–3. They are absent rather than mocked.
      </span>
    </p>
  );
}

function EmptyWorkspace() {
  return (
    <div className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-lg font-semibold">No workspace found</h1>
      <p className="mt-2 text-sm leading-6 muted">
        A workspace is created automatically the first time you sign in. If you are seeing this,
        the database migration may not have been applied yet — run <code>npm run db:push</code>.
      </p>
    </div>
  );
}
