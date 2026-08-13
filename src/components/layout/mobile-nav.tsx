'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { MoreHorizontal, Plus, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { NAV_ITEMS } from './nav';

/**
 * Mobile is designed, not shrunk (CLAUDE.md rule 25). Capture sits in the
 * centre because capture and retrieval are the mobile jobs; curation is a
 * desktop job. Everything is reachable by tapping a visible control.
 */
export function MobileNav() {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);

  const primary = NAV_ITEMS.filter((i) => i.mobilePrimary);
  const rest = NAV_ITEMS.filter((i) => !i.mobilePrimary);

  return (
    <>
      {sheetOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/40"
            onClick={() => setSheetOpen(false)}
          />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t p-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] hairline"
            style={{ background: 'var(--surface)' }}
          >
            <div className="flex items-center justify-between px-3 py-2">
              <p className="text-sm font-medium">More</p>
              <button type="button" onClick={() => setSheetOpen(false)} aria-label="Close">
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <ul>
              {rest.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setSheetOpen(false)}
                    className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm active:bg-black/[0.06]"
                  >
                    <item.icon className="size-5 muted" aria-hidden />
                    <span className="flex-1">{item.label}</span>
                    {item.phase !== null && (
                      <span className="text-xs muted">Phase {item.phase}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t pb-[env(safe-area-inset-bottom)] hairline lg:hidden"
        style={{ background: 'var(--surface)' }}
        aria-label="Primary"
      >
        {primary.slice(0, 2).map((item) => (
          <MobileTab key={item.href} href={item.href} label={item.label} icon={item.icon} active={pathname.startsWith(item.href)} />
        ))}

        <Link
          href="/inbox?capture=1"
          className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2"
          aria-label="Quick capture"
        >
          <span className="flex size-9 items-center justify-center rounded-full bg-indigo-600">
            <Plus className="size-5 text-white" aria-hidden />
          </span>
          <span className="text-[10px] muted">Capture</span>
        </Link>

        {primary.slice(2).map((item) => (
          <MobileTab key={item.href} href={item.href} label={item.label} icon={item.icon} active={pathname.startsWith(item.href)} />
        ))}

        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10px] muted"
        >
          <MoreHorizontal className="size-5" aria-hidden />
          More
        </button>
      </nav>
    </>
  );
}

function MobileTab({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10px]',
        active ? 'text-indigo-600 dark:text-indigo-400' : 'muted',
      )}
    >
      <Icon className="size-5" />
      {label}
    </Link>
  );
}
