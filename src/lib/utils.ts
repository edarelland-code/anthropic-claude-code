import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export interface Freshness {
  label: string;
  days: number;
  /** True once the context is old enough that it probably needs review. */
  stale: boolean;
}

/** Freshness indicators, per the spec's wording. */
export function freshness(iso: string | null | undefined, now = new Date()): Freshness {
  if (!iso) return { label: 'No activity yet', days: Infinity, stale: true };
  const then = new Date(iso);
  const ms = now.getTime() - then.getTime();
  const days = Math.floor(ms / 86_400_000);

  if (ms < 60_000) return { label: 'Updated just now', days: 0, stale: false };
  if (days === 0) return { label: 'Updated today', days, stale: false };
  if (days === 1) return { label: 'Updated yesterday', days, stale: false };
  if (days < 30) return { label: `Updated ${days} days ago`, days, stale: days >= 14 };
  if (days < 60) return { label: 'Inactive for 30 days', days, stale: true };
  if (days < 365) {
    const months = Math.floor(days / 30);
    return { label: `Inactive for ${months} months`, days, stale: true };
  }
  return { label: 'Inactive for over a year', days, stale: true };
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDayHeading(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/** Group any dated records into descending day buckets for the timeline. */
export function groupByDay<T>(items: T[], getDate: (item: T) => string): Array<{ day: string; items: T[] }> {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const day = getDate(item).slice(0, 10);
    const list = buckets.get(day);
    if (list) list.push(item);
    else buckets.set(day, [item]);
  }
  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, list]) => ({ day, items: list }));
}
