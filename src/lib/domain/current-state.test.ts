import { describe, expect, it } from 'vitest';

import { avoidList, currentEntries, history, resolveCurrentVersion } from './current-state';
import type { Decision, Idea, KnowledgeEntry } from './types';

function entry(over: Partial<KnowledgeEntry> & { id: string; title: string }): KnowledgeEntry {
  return {
    workspaceId: 'ws',
    topicId: 'topic',
    subtopicIds: [],
    knowledgeType: 'idea',
    status: 'active',
    content: null,
    sourceType: 'claude_chat',
    sourceSessionId: null,
    sourceReference: null,
    occurredAt: '2026-08-01T00:00:00Z',
    supersededById: null,
    supersedesReason: null,
    importance: 0,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...over,
  };
}

// The brief's own example: blue icon proposed, checkmark rejected,
// slash geometry approved.
const APP_ICON: KnowledgeEntry[] = [
  entry({
    id: 'v1',
    title: 'Blue icon concept',
    occurredAt: '2026-08-03T00:00:00Z',
    status: 'superseded',
    supersededById: 'v3',
    supersedesReason: 'Did not read at 16px',
  }),
  entry({
    id: 'v2',
    title: 'Checkmark concept',
    occurredAt: '2026-08-04T00:00:00Z',
    status: 'rejected',
    knowledgeType: 'rejected_idea',
    content: 'Too generic — every productivity app uses one',
  }),
  entry({
    id: 'v3',
    title: 'Slash to arrow to X geometry',
    occurredAt: '2026-08-05T00:00:00Z',
    knowledgeType: 'decision',
  }),
];

describe('currentEntries', () => {
  it('shows only the version in force', () => {
    expect(currentEntries(APP_ICON).map((e) => e.id)).toEqual(['v3']);
  });

  it('excludes superseded and rejected entries alike', () => {
    const ids = currentEntries(APP_ICON).map((e) => e.id);
    expect(ids).not.toContain('v1');
    expect(ids).not.toContain('v2');
  });
});

describe('history', () => {
  it('preserves every version, newest first', () => {
    expect(history(APP_ICON).map((e) => e.id)).toEqual(['v3', 'v2', 'v1']);
  });

  it('never drops a row that Current State filtered out', () => {
    // The guarantee the whole product rests on.
    expect(history(APP_ICON)).toHaveLength(APP_ICON.length);
  });

  it('does not mutate its input', () => {
    const before = APP_ICON.map((e) => e.id);
    history(APP_ICON);
    expect(APP_ICON.map((e) => e.id)).toEqual(before);
  });
});

describe('avoidList', () => {
  const decisions: Decision[] = [
    {
      id: 'd1',
      workspaceId: 'ws',
      topicId: 'topic',
      subtopicId: null,
      title: 'Ship a checkmark mark',
      decision: 'Use a checkmark',
      reason: 'Familiar',
      alternatives: [],
      approvedDirection: null,
      status: 'superseded',
      decidedAt: '2026-08-04T00:00:00Z',
      supersededById: 'd2',
      supersedeReason: 'Indistinguishable from competitors',
      sourceType: 'claude_chat',
      sourceSessionId: null,
    },
  ];

  const ideas: Idea[] = [
    {
      id: 'i1',
      workspaceId: 'ws',
      topicId: 'topic',
      subtopicId: null,
      title: 'Animated splash screen',
      idea: null,
      rationale: 'Adds startup latency for no retention gain',
      status: 'rejected',
      decisionId: null,
      implementationEntryId: null,
      sourceType: 'claude_chat',
      sourceSessionId: null,
      createdAt: '2026-08-02T00:00:00Z',
    },
  ];

  it('collects every direction already set aside', () => {
    const items = avoidList({ entries: APP_ICON, decisions, ideas });
    expect(items.map((i) => i.title).sort()).toEqual([
      'Animated splash screen',
      'Blue icon concept',
      'Checkmark concept',
      'Ship a checkmark mark',
    ]);
  });

  it('carries the reason, which is the point of the list', () => {
    const items = avoidList({ entries: APP_ICON, decisions, ideas });
    expect(items.find((i) => i.title === 'Blue icon concept')?.reason).toBe(
      'Did not read at 16px',
    );
    expect(items.find((i) => i.title === 'Ship a checkmark mark')?.reason).toBe(
      'Indistinguishable from competitors',
    );
  });

  it('never includes the direction that is currently in force', () => {
    const items = avoidList({ entries: APP_ICON, decisions, ideas });
    expect(items.map((i) => i.title)).not.toContain('Slash to arrow to X geometry');
  });

  it('is empty when nothing has been rejected', () => {
    expect(avoidList({ entries: [entry({ id: 'a', title: 'A' })], decisions: [], ideas: [] })).toEqual([]);
  });
});

describe('resolveCurrentVersion', () => {
  it('follows a supersession chain to the version in force', () => {
    expect(resolveCurrentVersion(APP_ICON, 'v1')?.id).toBe('v3');
  });

  it('returns the entry itself when nothing superseded it', () => {
    expect(resolveCurrentVersion(APP_ICON, 'v3')?.id).toBe('v3');
  });

  it('degrades instead of hanging on a corrupt cycle', () => {
    const cyclic = [
      entry({ id: 'a', title: 'A', supersededById: 'b' }),
      entry({ id: 'b', title: 'B', supersededById: 'a' }),
    ];
    expect(resolveCurrentVersion(cyclic, 'a')).not.toBeNull();
  });

  it('stops at the last known entry when the chain points outside the set', () => {
    const dangling = [entry({ id: 'a', title: 'A', supersededById: 'missing' })];
    expect(resolveCurrentVersion(dangling, 'a')?.id).toBe('a');
  });

  it('returns null for an unknown id', () => {
    expect(resolveCurrentVersion(APP_ICON, 'nope')).toBeNull();
  });
});
