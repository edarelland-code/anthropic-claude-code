'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Layers } from 'lucide-react';

import { cn } from '@/lib/utils';
import { NAV_ITEMS } from './nav';

interface PinnedTopic {
  id: string;
  name: string;
}

export function Sidebar({
  workspaceName,
  pinnedTopics,
  email,
}: {
  workspaceName: string;
  pinnedTopics: PinnedTopic[];
  email: string | null;
}) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r hairline lg:flex" style={{ background: 'var(--surface)' }}>
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="flex size-7 items-center justify-center rounded-md bg-indigo-600">
          <Layers className="size-4 text-white" aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">ContextShelf</p>
          <p className="truncate text-xs muted">{workspaceName}</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="Primary">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                    active
                      ? 'bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300'
                      : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
                  )}
                >
                  <item.icon className="size-4 shrink-0" aria-hidden />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.phase !== null && (
                    <span
                      className="rounded px-1 text-[10px] font-medium muted ring-1 ring-inset hairline"
                      title={`Planned for Phase ${item.phase}`}
                    >
                      P{item.phase}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>

        {pinnedTopics.length > 0 && (
          <div className="mt-6">
            <p className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider muted">
              Pinned
            </p>
            <ul className="space-y-0.5">
              {pinnedTopics.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/topics/${t.id}`}
                    className="block truncate rounded-md px-2.5 py-1.5 text-sm hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                  >
                    {t.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>

      {email && (
        <div className="border-t px-4 py-3 hairline">
          <p className="truncate text-xs muted">{email}</p>
        </div>
      )}
    </aside>
  );
}
