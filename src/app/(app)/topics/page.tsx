import Link from 'next/link';
import { Plus } from 'lucide-react';

import { TopicCard } from '@/components/topics/topic-card';
import { getData } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function TopicsPage() {
  const data = await getData();
  const workspace = await data.workspaces.getDefault();
  const topics = workspace ? await data.topics.list(workspace.id, { includeArchived: true }) : [];

  const active = topics.filter((t) => t.topic.status !== 'archived');
  const archived = topics.filter((t) => t.topic.status === 'archived');

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Topics</h1>
          <p className="mt-1 text-sm muted">
            The main organizational unit. Sources feed into these.
          </p>
        </div>
        <Link
          href="/topics/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          <Plus className="size-4" aria-hidden />
          New topic
        </Link>
      </header>

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
    </div>
  );
}
