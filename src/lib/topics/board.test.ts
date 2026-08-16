import { describe, expect, it } from 'vitest';

import type { Topic, TopicStatus, TopicSummary } from '@/lib/domain/types';
import {
  BOARD_COLUMNS,
  BOARD_SECTIONS,
  EMPTY,
  buildBoard,
  compactActivity,
  deriveCompleted,
  deriveNextAction,
  deriveUnfinished,
} from '@/lib/topics/board';

/** Indexing a section array is possibly-undefined under strict mode; assert once. */
function sectionOf(sections: ReturnType<typeof buildBoard>, key = 'active') {
  const found = sections.find((s) => s.section.key === key);
  if (!found) throw new Error(`no ${key} section`);
  return found;
}

/** Same reason: rows[0] is possibly-undefined under strict mode. */
function firstRow(section: ReturnType<typeof sectionOf>) {
  const row = section.rows[0];
  if (!row) throw new Error('section has no rows');
  return row;
}

const NOW = new Date('2026-08-15T12:00:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

function topic(over: Partial<Topic> = {}): Topic {
  return {
    id: 't1',
    workspaceId: 'w',
    name: 'DailyRelay',
    slug: 'dailyrelay',
    description: 'Today-first task app.',
    goal: 'Stop forgetting tasks.',
    currentState: 'A working React app exists.',
    status: 'active',
    progress: 0,
    pinned: false,
    resumeTriggerIf: null,
    resumeTriggerThen: null,
    lastMeaningfulUpdateAt: ago(1),
    archivedAt: null,
    createdAt: ago(30),
    updatedAt: ago(1),
    ...over,
  };
}

function summary(over: Partial<TopicSummary> = {}, t: Partial<Topic> = {}): TopicSummary {
  return {
    topic: topic(t),
    counts: {
      subtopics: 0,
      entries: 0,
      sessions: 0,
      prompts: 0,
      decisions: 0,
      ideas: 0,
      files: 0,
      openActions: 0,
    },
    sourceTypes: [],
    latestChange: null,
    nextAction: null,
    board: { completed: [], unfinished: [], ideas: [] },
    ...over,
  };
}

describe('column and section definition', () => {
  it('has exactly the seven requested columns, in order', () => {
    expect(BOARD_COLUMNS.map((c) => c.label)).toEqual([
      'Project',
      'What it is',
      'Last known state',
      'What appears completed',
      'What remains unfinished',
      'Best next action',
      'Last activity',
    ]);
  });

  it('carries no confidence column', () => {
    expect(BOARD_COLUMNS.some((c) => /confidence/i.test(c.label))).toBe(false);
  });

  it('column widths total 100 percent, so every section lays out identically', () => {
    expect(BOARD_COLUMNS.reduce((n, c) => n + c.width, 0)).toBe(100);
  });

  it('maps display sections onto canonical topic statuses only', () => {
    const canonical: TopicStatus[] = ['active', 'paused', 'blocked', 'completed', 'archived'];
    for (const s of BOARD_SECTIONS) {
      for (const st of s.statuses) expect(canonical).toContain(st);
    }
  });

  it('gives every canonical status a home so no topic can vanish', () => {
    const covered = BOARD_SECTIONS.flatMap((s) => s.statuses);
    for (const st of ['active', 'paused', 'blocked', 'completed', 'archived'] as TopicStatus[]) {
      expect(covered).toContain(st);
    }
  });
});

describe('what it is', () => {
  it('uses the description', () => {
    const active = sectionOf(buildBoard([summary()], { now: NOW }));
    expect(firstRow(active).what).toBe('Today-first task app.');
  });

  it('falls back to the goal when there is no description', () => {
    const active = sectionOf(buildBoard([summary({}, { description: null })], { now: NOW }));
    expect(firstRow(active).what).toBe('Stop forgetting tasks.');
  });

  it('shows the em dash when neither exists', () => {
    const active = sectionOf(buildBoard([summary({}, { description: null, goal: null })], { now: NOW }));
    expect(firstRow(active).what).toBe(EMPTY);
  });
});

describe('last known state', () => {
  it('uses the authoritative Current State verbatim', () => {
    const active = sectionOf(buildBoard([summary({}, { currentState: 'Phase 6 complete.' })], { now: NOW }));
    expect(firstRow(active).state).toBe('Phase 6 complete.');
  });

  it('shows the em dash when there is no Current State', () => {
    const active = sectionOf(buildBoard([summary({}, { currentState: null })], { now: NOW }));
    expect(firstRow(active).state).toBe(EMPTY);
  });
});

describe('what appears completed', () => {
  it('assembles from explicit structured evidence', () => {
    const s = summary({ board: { completed: ['Quick add implemented', 'Nudges shipped'], unfinished: [], ideas: [] } });
    expect(deriveCompleted(s)).toBe('Quick add implemented. Nudges shipped.');
  });

  it('is the em dash when nothing explicit is recorded, however full the prose', () => {
    const s = summary({}, { currentState: 'We finished absolutely everything and shipped it.' });
    expect(deriveCompleted(s)).toBe(EMPTY);
  });

  it('does not double a title that already ends in punctuation', () => {
    const s = summary({ board: { completed: ['Done already.'], unfinished: [], ideas: [] } });
    expect(deriveCompleted(s)).toBe('Done already.');
  });
});

describe('what remains unfinished', () => {
  it('assembles from unresolved records', () => {
    const s = summary({ board: { completed: [], unfinished: ['Verify nudges', 'Confirm schema'], ideas: [] } });
    expect(deriveUnfinished(s)).toBe('Verify nudges. Confirm schema.');
  });

  it('is the em dash when nothing is unresolved', () => {
    expect(deriveUnfinished(summary())).toBe(EMPTY);
  });
});

describe('best next action', () => {
  it('uses an explicit next_step', () => {
    const s = summary({ nextAction: { id: 'a', title: 'Restore repo access', kind: 'next_step' } });
    expect(deriveNextAction(s)).toBe('Restore repo access');
  });

  it('does NOT promote an open question', () => {
    const s = summary({ nextAction: { id: 'a', title: 'Did Phase 1 finish?', kind: 'question' } });
    expect(deriveNextAction(s)).toBe(EMPTY);
  });

  it('does NOT promote a blocker', () => {
    const s = summary({ nextAction: { id: 'a', title: 'Zapier quota exceeded', kind: 'blocker' } });
    expect(deriveNextAction(s)).toBe(EMPTY);
  });

  it('is the em dash when there is no next step at all', () => {
    expect(deriveNextAction(summary())).toBe(EMPTY);
  });
});

describe('last activity', () => {
  it('renders friendly labels', () => {
    expect(compactActivity(ago(0), NOW)).toBe('Today');
    expect(compactActivity(ago(1), NOW)).toBe('Yesterday');
    expect(compactActivity(ago(3), NOW)).toBe('3 days ago');
    expect(compactActivity(ago(120), NOW)).toMatch(/\w+ \d+, \d{4}/);
  });

  it('is the em dash when unknown', () => {
    expect(compactActivity(null, NOW)).toBe(EMPTY);
  });

  it('reads the meaningful timestamp, not updatedAt', () => {
    const s = summary({}, { lastMeaningfulUpdateAt: ago(3), updatedAt: ago(0) });
    const active = sectionOf(buildBoard([s], { now: NOW }));
    expect(firstRow(active).activity).toBe('3 days ago');
  });
});

describe('sections', () => {
  const mixed = [
    summary({}, { id: 'a', name: 'A', status: 'active', lastMeaningfulUpdateAt: ago(5) }),
    summary({}, { id: 'p', name: 'P', status: 'paused' }),
    summary({}, { id: 'b', name: 'B', status: 'blocked' }),
    summary({}, { id: 'c', name: 'C', status: 'completed' }),
    summary({}, { id: 'r', name: 'R', status: 'archived' }),
  ];

  it('renders every section even when empty', () => {
    const sections = buildBoard(mixed, { now: NOW });
    expect(sections.map((s) => s.section.key)).toEqual(BOARD_SECTIONS.map((s) => s.key));
  });

  it('leaves probably-complete empty because no canonical status maps to it', () => {
    const sections = buildBoard(mixed, { now: NOW });
    expect(sections.find((s) => s.section.key === 'probably_complete')?.rows).toEqual([]);
  });

  it('routes each status to its own section', () => {
    const sections = buildBoard(mixed, { now: NOW });
    const at = (k: string) => sections.find((s) => s.section.key === k)?.rows.map((r) => r.project);
    expect(at('active')).toEqual(['A']);
    expect(at('paused')).toEqual(['P']);
    expect(at('needs_review')).toEqual(['B']);
    expect(at('complete')).toEqual(['C']);
    expect(at('archived')).toEqual(['R']);
  });

  it('links a topic row to its topic page', () => {
    const active = sectionOf(buildBoard([summary({}, { id: 'xyz' })], { now: NOW }));
    expect(firstRow(active).href).toBe('/topics/xyz');
  });
});

describe('ideas', () => {
  const withIdeas = summary({
    board: {
      completed: [],
      unfinished: [],
      ideas: [
        { id: 'i1', title: 'Real Estate Wholesaling', body: 'Flip contracts.', rationale: null, status: 'suggested', updatedAt: ago(2) },
        { id: 'i2', title: 'Shipped thing', body: null, rationale: null, status: 'implemented', updatedAt: ago(2) },
        { id: 'i3', title: 'Ruled out', body: null, rationale: 'No.', status: 'rejected', updatedAt: ago(2) },
      ],
    },
  });

  it('shows only ideas that have not been acted on', () => {
    const ideas = sectionOf(buildBoard([withIdeas], { now: NOW }), 'ideas');
    expect(ideas.rows.map((r) => r.project)).toEqual(['Real Estate Wholesaling']);
  });

  it('never lets an idea appear as a project row in a status section', () => {
    const sections = buildBoard([withIdeas], { now: NOW });
    for (const s of sections) {
      if (s.section.key === 'ideas') continue;
      expect(s.rows.every((r) => r.kind === 'topic')).toBe(true);
    }
  });

  it('never lets a topic appear in the ideas section', () => {
    const ideas = sectionOf(buildBoard([withIdeas], { now: NOW }), 'ideas');
    expect(ideas.rows.every((r) => r.kind === 'idea')).toBe(true);
  });

  it('leaves completed, unfinished and next action as em dashes rather than guessing', () => {
    const ideas = sectionOf(buildBoard([withIdeas], { now: NOW }), 'ideas');
    const row = firstRow(ideas);
    expect([row.completed, row.unfinished, row.next]).toEqual([EMPTY, EMPTY, EMPTY]);
  });

  it('sends an idea row to the existing Ideas page', () => {
    const ideas = sectionOf(buildBoard([withIdeas], { now: NOW }), 'ideas');
    expect(firstRow(ideas).href).toBe('/ideas');
  });
});

describe('sorting', () => {
  const rows = [
    summary({}, { id: '1', name: 'Zebra', status: 'active', lastMeaningfulUpdateAt: ago(10) }),
    summary({}, { id: '2', name: 'Apple', status: 'active', lastMeaningfulUpdateAt: ago(1) }),
    summary({}, { id: '3', name: 'Mango', status: 'active', lastMeaningfulUpdateAt: ago(5) }),
  ];

  it('defaults to newest meaningful activity first', () => {
    const active = sectionOf(buildBoard(rows, { now: NOW }));
    expect(active.rows.map((r) => r.project)).toEqual(['Apple', 'Mango', 'Zebra']);
  });

  it('sorts by project name on request', () => {
    const active = sectionOf(buildBoard(rows, { sort: 'project', now: NOW }));
    expect(active.rows.map((r) => r.project)).toEqual(['Apple', 'Mango', 'Zebra']);
  });

  it('breaks ties by name so the order is total', () => {
    const same = [
      summary({}, { id: '1', name: 'Beta', lastMeaningfulUpdateAt: ago(2) }),
      summary({}, { id: '2', name: 'Alpha', lastMeaningfulUpdateAt: ago(2) }),
    ];
    const active = sectionOf(buildBoard(same, { now: NOW }));
    expect(active.rows.map((r) => r.project)).toEqual(['Alpha', 'Beta']);
  });
});

describe('search and filter', () => {
  const rows = [
    summary({}, { id: '1', name: 'Pigeon', description: 'Golf hats.', currentState: null }),
    summary({}, { id: '2', name: 'DailyRelay', description: 'Task app.', currentState: 'Relay behaviour works.' }),
  ];

  it('matches on name', () => {
    const active = sectionOf(buildBoard(rows, { query: 'pigeon', now: NOW }));
    expect(active.rows.map((r) => r.project)).toEqual(['Pigeon']);
  });

  it('matches on description', () => {
    const active = sectionOf(buildBoard(rows, { query: 'golf', now: NOW }));
    expect(active.rows.map((r) => r.project)).toEqual(['Pigeon']);
  });

  it('matches on current state', () => {
    const active = sectionOf(buildBoard(rows, { query: 'relay behaviour', now: NOW }));
    expect(active.rows.map((r) => r.project)).toEqual(['DailyRelay']);
  });

  it('matches on goal', () => {
    const active = sectionOf(buildBoard([summary({}, { goal: 'Win more bids' })], { query: 'win more', now: NOW }));
    expect(active.rows).toHaveLength(1);
  });

  it('filters to a single status section', () => {
    const sections = buildBoard(rows, { status: 'active', now: NOW });
    expect(sections).toHaveLength(1);
    expect(sections.map((x) => x.section.key)).toEqual(['active']);
  });

  it('keeps every section for the all filter', () => {
    expect(buildBoard(rows, { status: 'all', now: NOW })).toHaveLength(BOARD_SECTIONS.length);
  });
});

describe('scale', () => {
  it('handles 200 topics without special casing', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      summary({}, { id: `t${i}`, name: `Topic ${i}`, lastMeaningfulUpdateAt: ago(i % 40) }),
    );
    const active = sectionOf(buildBoard(many, { now: NOW }));
    expect(active.rows).toHaveLength(200);
    const times = active.rows.map((r) => Date.parse(String(r.activityAt)));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});
