import { Suspense } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';

import { TopicCard } from '@/components/topics/topic-card';
import { TopicsBoardCards } from '@/components/topics/topics-board-cards';
import { TopicsControls } from '@/components/topics/topics-controls';
import { TopicsTable } from '@/components/topics/topics-table';
import { getData } from '@/lib/data';
import { buildBoard, type BoardSort } from '@/lib/topics/board';

export const dynamic = 'force-dynamic';

const SORTS = new Set<BoardSort>(['activity', 'project', 'status']);

export default async function TopicsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; q?: string; status?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const view = sp.view === 'table' ? 'table' : 'cards';

  const data = await getData();
  const workspace = await data.workspaces.getDefault();
  // One read serves both views: `list` already batches its related tables, so
  // the table view costs no extra round trips over the cards it replaces.
  const topics = workspace ? await data.topics.list(workspace.id, { includeArchived: true }) : [];

  const sort = SORTS.has(sp.sort as BoardSort) ? (sp.sort as BoardSort) : 'activity';

  return (
    <div
      className={
        // The table needs room to breathe; the cards keep the width they had.
        view === 'table'
          ? 'mx-auto max-w-[1800px] px-4 py-6 sm:px-6 lg:py-8'
          : 'mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-8'
      }
    >
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Topics</h1>
          <p className="mt-1 text-sm muted">
            The main organizational unit. Sources feed into these.
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

      <Suspense fallback={null}>
        <TopicsControls view={view} />
      </Suspense>

      {view === 'table' ? (
        <TableView topics={topics} q={sp.q} status={sp.status} sort={sort} />
      ) : (
        <CardsView topics={topics} />
      )}
    </div>
  );
}

function TableView({
  topics,
  q,
  status,
  sort,
}: {
  topics: Awaited<ReturnType<Awaited<ReturnType<typeof getData>>['topics']['list']>>;
  q?: string;
  status?: string;
  sort: BoardSort;
}) {
  const sections = buildBoard(topics, { query: q, status, sort });
  return (
    <>
      {/* Both render server-side; the media query picks one, so there is no
          viewport measurement and no flash of the wrong layout. */}
      <div className="hidden lg:block">
        <TopicsTable sections={sections} />
      </div>
      <div className="lg:hidden">
        <TopicsBoardCards sections={sections} />
      </div>
    </>
  );
}

function CardsView({
  topics,
}: {
  topics: Awaited<ReturnType<Awaited<ReturnType<typeof getData>>['topics']['list']>>;
}) {
  const active = topics.filter((t) => t.topic.status !== 'archived');
  const archived = topics.filter((t) => t.topic.status === 'archived');

  return (
    <>
      {active.length === 0 ? (
        <p className="mt-8 rounded-lg p-6 text-sm muted surface">
          No topics yet. Create one to start collecting knowledge against it.
        </p>
      ) : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {active.map((t) => (
            <TopicCard key={t.topic.id} summary={t} />
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-2.5 text-sm font-semibold muted">Archived</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {archived.map((t) => (
              <TopicCard key={t.topic.id} summary={t} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
