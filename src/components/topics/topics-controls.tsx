'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { LayoutGrid, Rows3, Search } from 'lucide-react';

import { BOARD_SECTIONS, type BoardSort } from '@/lib/topics/board';
import { cn } from '@/lib/utils';

const KEY = 'contextshelf:topics-view';

const SORTS: Array<{ value: BoardSort; label: string }> = [
  { value: 'activity', label: 'Last activity' },
  { value: 'project', label: 'Project' },
  { value: 'status', label: 'Status' },
];

/**
 * View toggle, search, status filter and sort.
 *
 * The URL is the source of truth so a table view is bookmarkable and Back
 * behaves. localStorage holds one thing only — which view was last chosen —
 * which is a UI preference and not data (rule 12); it is applied by redirecting
 * to the same URL with `?view=`, so the rendered page always matches its
 * address rather than drifting from it.
 */
export function TopicsControls({ view }: { view: 'cards' | 'table' }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const explicit = params.get('view');

  useEffect(() => {
    if (explicit) {
      window.localStorage.setItem(KEY, explicit);
      return;
    }
    // No view in the URL: honour the stored preference once, by navigating, so
    // the address bar and the rendering never disagree.
    const stored = window.localStorage.getItem(KEY);
    if (stored === 'table') router.replace(`${pathname}?view=table`);
  }, [explicit, pathname, router]);

  const withParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value && value !== 'all') next.set(key, value);
    else next.delete(key);
    if (!next.get('view')) next.set('view', view);
    return `${pathname}?${next.toString()}`;
  };

  const onSelect = (key: string) => (e: React.ChangeEvent<HTMLSelectElement>) =>
    router.replace(withParam(key, e.target.value));

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <div
        className="inline-flex rounded-md p-0.5 hairline"
        role="group"
        aria-label="Topics view"
      >
        <Toggle href={withParam('view', 'cards')} active={view === 'cards'} label="Cards">
          <LayoutGrid className="size-3.5" aria-hidden />
        </Toggle>
        <Toggle href={withParam('view', 'table')} active={view === 'table'} label="Table">
          <Rows3 className="size-3.5" aria-hidden />
        </Toggle>
      </div>

      {view === 'table' && (
        <>
          <form action={pathname} className="relative min-w-0 flex-1 sm:max-w-xs">
            <input type="hidden" name="view" value="table" />
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 muted"
              aria-hidden
            />
            <input
              type="search"
              name="q"
              defaultValue={params.get('q') ?? ''}
              placeholder="Search topics"
              aria-label="Search topics"
              className="w-full rounded-md py-2 pl-8 pr-2.5 text-sm hairline bg-transparent"
            />
          </form>

          <label className="text-sm">
            <span className="sr-only">Status</span>
            <select
              value={params.get('status') ?? 'all'}
              onChange={onSelect('status')}
              className="rounded-md px-2.5 py-2 text-sm hairline bg-transparent"
            >
              <option value="all">All statuses</option>
              {BOARD_SECTIONS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="sr-only">Sort by</span>
            <select
              value={params.get('sort') ?? 'activity'}
              onChange={onSelect('sort')}
              className="rounded-md px-2.5 py-2 text-sm hairline bg-transparent"
            >
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  Sort: {s.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </div>
  );
}

function Toggle({
  href,
  active,
  label,
  children,
}: {
  href: string;
  active: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm font-medium transition-colors',
        active ? 'bg-indigo-600 text-white' : 'muted hover:text-slate-900 dark:hover:text-slate-100',
      )}
    >
      {children}
      {label}
    </Link>
  );
}
