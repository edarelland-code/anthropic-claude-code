import Link from 'next/link';
import { Archive, ArrowRight, FileJson, Inbox as InboxIcon } from 'lucide-react';

import { SourceBadge } from '@/components/ui/badges';
import { getData } from '@/lib/data';
import {
  INGESTION_STATUS_LABELS,
  OPEN_INGESTION_STATUSES,
  type IngestionRecord,
  type IngestionStatus,
} from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';

import { ImportPanel } from './import-panel';
import { QuickCapture } from './quick-capture';
import { StatusButton } from './status-button';

export const dynamic = 'force-dynamic';

/**
 * The Inbox — where every path into the system lands first.
 *
 * Two flows share this page and they are deliberately different weights. Quick
 * Capture is at the top, needs nothing but content, and never navigates away.
 * Import is behind a disclosure below it, because it asks for a topic and shows
 * a preview — worth the ceremony when you mean to file something, ruinous if
 * it stood between the user and saving a thought.
 *
 * Items are grouped by whether they are still waiting on a person. Nothing here
 * is ever deleted: archiving files an item away and keeps the raw capture
 * searchable, which is why `soft_delete_record()` refuses inbox records.
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ capture?: string }>;
}) {
  const { capture } = await searchParams;
  const data = await getData();
  const workspace = await data.workspaces.getDefault();

  if (!workspace) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:py-8">
        <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
        <p className="mt-2 text-sm muted">No workspace available.</p>
      </div>
    );
  }

  const [items, counts, topicSummaries] = await Promise.all([
    data.inbox.list(workspace.id),
    data.inbox.countsByStatus(workspace.id),
    data.topics.list(workspace.id),
  ]);
  const topics = topicSummaries.map((t) => t.topic);
  const subtopicsByTopic: Record<string, { id: string; name: string }[]> = {};
  for (const t of topics) {
    subtopicsByTopic[t.id] = (await data.subtopics.listForTopic(t.id)).map((s) => ({
      id: s.id,
      name: s.name,
    }));
  }

  const open = items.filter((i) =>
    (OPEN_INGESTION_STATUSES as readonly IngestionStatus[]).includes(i.status),
  );
  const filed = items.filter(
    (i) => !(OPEN_INGESTION_STATUSES as readonly IngestionStatus[]).includes(i.status),
  );
  const openCount = open.length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:py-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Inbox</h1>
        <p className="mt-1 text-sm muted">
          Capture now, decide later. Items start uncategorized on purpose — capture that demands
          decisions does not get used.
        </p>
      </header>

      <div className="mt-5">
        <QuickCapture autoFocus={capture === '1'} />
      </div>

      <div className="mt-3">
        <ImportPanel topics={topics} subtopicsByTopic={subtopicsByTopic} />
      </div>

      <section className="mt-8">
        <h2 className="text-xs font-medium uppercase tracking-wider muted">
          Waiting on you · {openCount}
        </h2>
        {openCount === 0 ? (
          <div className="mt-2 rounded-lg p-6 surface">
            <p className="flex items-center gap-2 text-sm font-medium">
              <InboxIcon className="size-4 muted" aria-hidden />
              Nothing waiting.
            </p>
            <p className="mt-1.5 text-sm leading-6 muted">
              {items.length === 0
                ? 'Paste something above — a Claude answer you want to keep, a transcript, a link, or a half-formed thought. You can file it later, or never.'
                : 'Everything captured has been filed or archived.'}
            </p>
          </div>
        ) : (
          <ul className="mt-2 space-y-2">
            {open.map((item) => (
              <InboxRow key={item.id} item={item} topics={topics} />
            ))}
          </ul>
        )}
      </section>

      {filed.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-medium uppercase tracking-wider muted">
            Import history · {filed.length}
          </h2>
          <p className="mt-1 text-xs leading-5 muted">
            Every import keeps its receipt: what arrived, what it produced, and when. Nothing here
            is deleted.
          </p>
          <ul className="mt-2 space-y-2">
            {filed.map((item) => (
              <InboxRow key={item.id} item={item} topics={topics} filed />
            ))}
          </ul>
        </section>
      )}

      {counts.failed ? (
        <p className="mt-6 text-xs muted">
          {counts.failed} {counts.failed === 1 ? 'item' : 'items'} failed to import and kept their
          original content.
        </p>
      ) : null}
    </div>
  );
}

function InboxRow({
  item,
  topics,
  filed = false,
}: {
  item: IngestionRecord;
  topics: { id: string; name: string }[];
  filed?: boolean;
}) {
  const preview = (item.rawContent ?? '').replace(/\s+/g, ' ').trim();
  const topic = topics.find((t) => t.id === item.topicId);
  const produced = item.createdEntryIds.length;

  return (
    <li className={`rounded-lg p-4 surface ${filed ? 'opacity-80' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium muted ring-1 ring-inset hairline">
          {INGESTION_STATUS_LABELS[item.status]}
        </span>
        <SourceBadge source={item.sourceType} />
        {item.sourceHint && <span className="text-xs font-medium break-words">{item.sourceHint}</span>}
        {topic && (
          <Link
            href={`/topics/${topic.id}`}
            className="inline-flex min-h-11 items-center text-xs muted hover:underline"
          >
            {topic.name}
          </Link>
        )}
        <time className="ml-auto shrink-0 text-xs tabular-nums muted" dateTime={item.createdAt}>
          {formatDate(item.createdAt)}
        </time>
      </div>

      <p className="mt-1.5 line-clamp-3 text-sm leading-6 break-words">
        {preview || <span className="muted">No content</span>}
      </p>

      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        {filed ? (
          <>
            {produced > 0 && (
              <span className="text-xs muted">
                Produced {produced} {produced === 1 ? 'entry' : 'entries'}
              </span>
            )}
            {item.createdSourceSessionId && (
              <Link
                href={`/sources/${item.createdSourceSessionId}`}
                className="inline-flex min-h-11 items-center gap-1 text-xs text-indigo-600 hover:underline dark:text-indigo-400"
              >
                <FileJson className="size-3.5" aria-hidden />
                View the original
              </Link>
            )}
            {item.status === 'archived' && (
              <StatusButton id={item.id} status="unsorted" label="Move back to the Inbox" />
            )}
          </>
        ) : (
          <>
            <Link
              href={`/inbox/${item.id}`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-700"
            >
              File this
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
            <StatusButton
              id={item.id}
              status="archived"
              label="Archive"
              icon={<Archive className="size-3.5" aria-hidden />}
            />
          </>
        )}
      </div>
    </li>
  );
}
