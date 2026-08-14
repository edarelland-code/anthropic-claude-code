import { describe, expect, it } from 'vitest';

import type {
  Action,
  Decision,
  Idea,
  KnowledgeEntry,
  Prompt,
  PromptVersion,
  Topic,
} from '../domain/types';
import { assembleMemory } from './memory';

const topic = (over: Partial<Topic> = {}): Topic => ({
  id: 't1',
  workspaceId: 'w1',
  name: 'DailyRelay',
  slug: 'dailyrelay',
  description: 'A relay app',
  goal: 'Ship v1',
  currentState: 'Icon work in progress',
  status: 'active',
  progress: 40,
  pinned: false,
  resumeTriggerIf: null,
  resumeTriggerThen: null,
  lastMeaningfulUpdateAt: '2026-08-01T00:00:00Z',
  archivedAt: null,
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
  ...over,
});

const entry = (over: Partial<KnowledgeEntry>): KnowledgeEntry => ({
  id: 'e1',
  workspaceId: 'w1',
  topicId: 't1',
  subtopicIds: [],
  knowledgeType: 'progress',
  status: 'active',
  title: 'Entry',
  content: null,
  sourceType: 'manual',
  sourceSessionId: null,
  sourceReference: null,
  occurredAt: '2026-08-01T00:00:00Z',
  supersededById: null,
  supersedesReason: null,
  importance: 3,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
  ...over,
});

const decision = (over: Partial<Decision>): Decision => ({
  id: 'd1',
  workspaceId: 'w1',
  topicId: 't1',
  subtopicId: null,
  title: 'Decision',
  decision: 'Do the thing',
  reason: null,
  alternatives: [],
  approvedDirection: null,
  status: 'active',
  decidedAt: '2026-08-01T00:00:00Z',
  supersededById: null,
  supersedeReason: null,
  sourceType: 'manual',
  sourceSessionId: null,
  ...over,
});

const action = (over: Partial<Action>): Action => ({
  id: 'a1',
  workspaceId: 'w1',
  topicId: 't1',
  subtopicId: null,
  kind: 'next_step',
  status: 'open',
  title: 'Do this',
  detail: null,
  position: 0,
  resolvedAt: null,
  createdAt: '2026-08-01T00:00:00Z',
  ...over,
});

describe('assembleMemory', () => {
  it('uses the active decision and keeps the superseded one as an avoid item', () => {
    // The brief's own example: blue icon, then a checkmark rejected, then the
    // slash geometry approved. Current State must show only the last one.
    const d1 = decision({
      id: 'd1',
      title: 'Blue icon',
      status: 'superseded',
      supersededById: 'd3',
      supersedeReason: 'read as a status dot at 16px',
    });
    const d3 = decision({ id: 'd3', title: 'Slash geometry', status: 'active' });

    const memory = assembleMemory({ topic: topic(), decisions: [d1, d3] });

    expect(memory.activeDecisions.map((d) => d.id)).toEqual(['d3']);
    expect(memory.removedOrRejected.map((a) => a.title)).toContain('Blue icon');
    const superseded = memory.removedOrRejected.find((a) => a.title === 'Blue icon');
    expect(superseded?.reason).toBe('read as a status dot at 16px');
  });

  it('never counts a superseded entry as current, but keeps it in history', () => {
    const old = entry({ id: 'e1', title: 'v1', status: 'superseded', supersededById: 'e2' });
    const now = entry({ id: 'e2', title: 'v2', knowledgeType: 'implementation' });

    const memory = assembleMemory({ topic: topic(), entries: [old, now] });

    expect(memory.implemented.map((e) => e.id)).toEqual(['e2']);
    expect(memory.recentHistory.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  });

  it('treats an active entry that points at a replacement as not current', () => {
    // Status and pointer must agree; a stale pointer alone is enough to exclude.
    const e = entry({ id: 'e1', knowledgeType: 'requirement', supersededById: 'e9' });
    const memory = assembleMemory({ topic: topic(), entries: [e] });
    expect(memory.requirements).toHaveLength(0);
  });

  it('surfaces the exact winning version, not the latest one', () => {
    const prompt: Prompt = {
      id: 'p1',
      workspaceId: 'w1',
      topicId: 't1',
      subtopicId: null,
      title: 'Icon prompt',
      purpose: null,
      sourceType: 'claude_code',
      currentVersionId: 'v3',
      isWinning: true,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    };
    const v = (id: string, version: number, body: string): PromptVersion => ({
      id,
      promptId: 'p1',
      version,
      body,
      result: 'untested',
      rating: null,
      notes: null,
      outputSummary: null,
      createdAt: '2026-08-01T00:00:00Z',
    });

    const memory = assembleMemory({
      topic: topic(),
      prompts: [
        {
          prompt,
          versions: [v('v1', 1, 'first try'), v('v2', 2, 'the one that won'), v('v3', 3, 'a later experiment')],
          winningVersionId: 'v2',
          winningReason: 'best 16px render',
        },
      ],
    });

    expect(memory.winningPrompts).toHaveLength(1);
    // v3 is current; v2 is the winner. Copying the latest would copy the wrong text.
    const won = memory.winningPrompts[0]!;
    expect(won.versionId).toBe('v2');
    expect(won.version).toBe(2);
    expect(won.body).toBe('the one that won');
    expect(won.reason).toBe('best 16px render');
  });

  it('omits a prompt whose winning version is not among those loaded', () => {
    const prompt: Prompt = {
      id: 'p1', workspaceId: 'w1', topicId: 't1', subtopicId: null, title: 'P',
      purpose: null, sourceType: 'manual', currentVersionId: null, isWinning: true,
      createdAt: '', updatedAt: '',
    };
    const memory = assembleMemory({
      topic: topic(),
      prompts: [{ prompt, versions: [], winningVersionId: 'missing' }],
    });
    expect(memory.winningPrompts).toHaveLength(0);
  });

  it('picks the next action by position, ignoring done and dropped work', () => {
    const memory = assembleMemory({
      topic: topic(),
      actions: [
        action({ id: 'a3', title: 'Third', position: 2 }),
        action({ id: 'a1', title: 'Already done', position: 0, status: 'done' }),
        action({ id: 'a2', title: 'Second', position: 1 }),
        action({ id: 'a4', title: 'Blocked on brand', kind: 'blocker' }),
        action({ id: 'a5', title: 'Which icon set?', kind: 'question' }),
      ],
    });

    expect(memory.nextAction?.title).toBe('Second');
    expect(memory.remainingWork.map((a) => a.id)).toEqual(['a2', 'a3']);
    expect(memory.blockers.map((a) => a.id)).toEqual(['a4']);
    expect(memory.openQuestions.map((a) => a.id)).toEqual(['a5']);
  });

  it('carries rejected ideas into the avoid-list with their reasoning', () => {
    const idea: Idea = {
      id: 'i1', workspaceId: 'w1', topicId: 't1', subtopicId: null,
      title: 'Overlay a checkmark', idea: null,
      rationale: 'reads as "done", not "relay"',
      status: 'rejected', decisionId: null, implementationEntryId: null,
      sourceType: 'claude_chat', sourceSessionId: null, createdAt: '2026-08-01T00:00:00Z',
    };
    const memory = assembleMemory({ topic: topic(), ideas: [idea] });
    const avoided = memory.removedOrRejected.find((a) => a.title === 'Overlay a checkmark');
    expect(avoided).toBeDefined();
    expect(avoided?.reason).toBe('reads as "done", not "relay"');
    expect(memory.ideasInFlight).toHaveLength(0);
  });

  it('reports emptiness so a new topic shows guidance rather than empty sections', () => {
    const bare = assembleMemory({ topic: topic({ goal: null, currentState: null }) });
    expect(bare.isEmpty).toBe(true);

    const withWork = assembleMemory({ topic: topic({ goal: null, currentState: null }), actions: [action({})] });
    expect(withWork.isEmpty).toBe(false);
  });

  it('orders recent history newest first and respects the limit', () => {
    const memory = assembleMemory({
      topic: topic(),
      entries: [
        entry({ id: 'old', occurredAt: '2026-01-01T00:00:00Z' }),
        entry({ id: 'new', occurredAt: '2026-08-10T00:00:00Z' }),
        entry({ id: 'mid', occurredAt: '2026-05-01T00:00:00Z' }),
      ],
      recentLimit: 2,
    });
    expect(memory.recentHistory.map((e) => e.id)).toEqual(['new', 'mid']);
  });
});
