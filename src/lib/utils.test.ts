import { describe, expect, it } from 'vitest';

import { freshness, groupByDay } from './utils';

const NOW = new Date('2026-08-13T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe('freshness', () => {
  it('labels recent activity without marking it stale', () => {
    const twoHoursAgo = new Date(NOW.getTime() - 2 * 3_600_000).toISOString();
    expect(freshness(NOW.toISOString(), NOW)).toMatchObject({ label: 'Updated just now' });
    expect(freshness(twoHoursAgo, NOW)).toMatchObject({ label: 'Updated today', stale: false });
    expect(freshness(daysAgo(1), NOW)).toMatchObject({ label: 'Updated yesterday', stale: false });
    expect(freshness(daysAgo(8), NOW)).toMatchObject({ label: 'Updated 8 days ago', stale: false });
  });

  it('flags context that probably needs review', () => {
    expect(freshness(daysAgo(20), NOW).stale).toBe(true);
    expect(freshness(daysAgo(35), NOW)).toMatchObject({ label: 'Inactive for 30 days', stale: true });
    expect(freshness(daysAgo(400), NOW).label).toBe('Inactive for over a year');
  });

  it('treats a topic with no activity as stale rather than fresh', () => {
    expect(freshness(null, NOW)).toMatchObject({ label: 'No activity yet', stale: true });
  });
});

describe('groupByDay', () => {
  it('buckets by day, newest day first', () => {
    const entries = [
      { id: 'a', at: '2026-08-05T09:00:00Z' },
      { id: 'b', at: '2026-08-05T18:00:00Z' },
      { id: 'c', at: '2026-08-08T10:00:00Z' },
    ];
    const grouped = groupByDay(entries, (e) => e.at);
    expect(grouped.map((g) => g.day)).toEqual(['2026-08-08', '2026-08-05']);
    expect(grouped[1]?.items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('returns nothing for an empty history', () => {
    expect(groupByDay([], () => '')).toEqual([]);
  });
});
