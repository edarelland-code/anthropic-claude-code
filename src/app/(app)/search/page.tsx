import Link from 'next/link';
import { Search as SearchIcon } from 'lucide-react';

import { SearchFilters } from '@/components/search/search-filters';
import { SearchResults } from '@/components/search/search-results';
import { getData } from '@/lib/data';
import {
  RECORD_STATES,
  SEARCH_TYPE_FILTERS,
  type EntityType,
  type RecordState,
  type SearchTypeFilterKey,
} from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 30;

/**
 * Universal search.
 *
 * State lives in the URL, so a search is a link: it can be bookmarked, shared
 * between the two machines this product exists to bridge, and reloaded without
 * retyping. The form is a plain GET, which also means search works with
 * JavaScript still loading.
 *
 * Everything reads through the `search_documents` projection, which is
 * `security_invoker` — row-level security on the twelve underlying tables
 * decides what comes back, not this page.
 *
 * Current State and Master Topic Memory are searchable here without either
 * being copied anywhere: their authoritative source columns are in the index,
 * so a phrase remembered from the memory panel lands on the record that
 * produced it.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    type?: string;
    state?: string;
    topic?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const text = (sp.q ?? '').trim();
  const typeKey = (
    sp.type && sp.type in SEARCH_TYPE_FILTERS ? sp.type : 'all'
  ) as SearchTypeFilterKey;
  const stateFilter = RECORD_STATES.includes(sp.state as RecordState)
    ? (sp.state as RecordState)
    : null;
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);

  const data = await getData();
  const workspace = await data.workspaces.getDefault();
  const topics = workspace ? (await data.topics.list(workspace.id)).map((t) => t.topic) : [];
  const topicId = topics.some((t) => t.id === sp.topic) ? sp.topic : undefined;

  const query = {
    workspaceId: workspace?.id ?? '',
    text,
    entityTypes: [...SEARCH_TYPE_FILTERS[typeKey]] as EntityType[],
    recordStates: stateFilter ? [stateFilter] : undefined,
    topicId,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  };

  const [hits, counts] = workspace && text
    ? await Promise.all([data.search.query(query), data.search.countsByType(query)])
    : [[], {}];

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:py-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Search</h1>
        <p className="mt-1 text-sm muted">
          Everything at once — topics, knowledge, decisions, ideas, prompts, transcripts, files and
          captured items. Including the words inside a pasted transcript.
        </p>
      </header>

      <form method="get" action="/search" className="mt-5">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <SearchIcon
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 muted"
              aria-hidden
            />
            <input
              type="search"
              name="q"
              defaultValue={text}
              autoFocus
              placeholder="What are you looking for?"
              aria-label="Search"
              className="min-h-11 w-full rounded-md border-0 py-2 pl-9 pr-3 text-sm ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
              style={{ background: 'var(--surface)' }}
            />
          </div>
          <button
            type="submit"
            className="inline-flex min-h-11 shrink-0 items-center rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Search
          </button>
        </div>

        {/* Filters submit the same form, so a filtered search is one round trip
            and the URL always matches what is on screen. */}
        <SearchFilters
          activeType={typeKey}
          activeState={stateFilter}
          activeTopic={topicId ?? null}
          topics={topics.map((t) => ({ id: t.id, name: t.name }))}
          counts={counts}
          disabled={!text}
        />
      </form>

      {!text ? (
        <div className="mt-8 rounded-lg p-6 surface">
          <p className="text-sm font-medium">Search finds what you half-remember.</p>
          <ul className="mt-2 space-y-1 text-sm leading-6 muted">
            <li>· A phrase from a Claude transcript you pasted weeks ago.</li>
            <li>· The wording of a prompt version, including ones that were replaced.</li>
            <li>· Something you read in a topic&apos;s Current State or Master Topic Memory.</li>
            <li>· A decision you know was made, and later reversed.</li>
          </ul>
          <p className="mt-2 text-xs muted">
            Quoted &ldquo;exact phrases&rdquo;, <code>or</code>, and <code>-excluded</code> words
            all work.
          </p>
        </div>
      ) : (
        <SearchResults
          hits={hits}
          topics={topics.map((t) => ({ id: t.id, name: t.name }))}
          total={total}
          page={page}
          pageSize={PAGE_SIZE}
          query={sp}
        />
      )}

      {text && total === 0 && (
        <p className="mt-3 text-xs muted">
          Nothing matched. Search reads whole words, so try a shorter term — or check{' '}
          <Link href="/inbox" className="text-indigo-600 hover:underline dark:text-indigo-400">
            the Inbox
          </Link>{' '}
          in case it is captured but not yet filed.
        </p>
      )}
    </div>
  );
}
