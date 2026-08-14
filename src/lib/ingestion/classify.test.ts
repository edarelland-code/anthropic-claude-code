import { describe, expect, it } from 'vitest';

import type { Topic } from '@/lib/domain/types';

import { suggestKnowledgeType, suggestSource, suggestTopic } from './classify';

const topic = (over: Partial<Topic>): Topic => ({
  id: 't1',
  workspaceId: 'w1',
  name: 'DailyRelay',
  slug: 'dailyrelay',
  description: null,
  goal: null,
  currentState: null,
  status: 'active',
  progress: 0,
  pinned: false,
  resumeTriggerIf: null,
  resumeTriggerThen: null,
  lastMeaningfulUpdateAt: '2026-08-01T00:00:00Z',
  archivedAt: null,
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
  ...over,
});

/**
 * The property under test throughout this file is honesty, not accuracy.
 *
 * A suggestion is allowed to be wrong — a person is going to look at it. What it
 * is not allowed to do is present itself as certain, arrive without its
 * reasoning, or change between identical runs.
 */
describe('suggestKnowledgeType', () => {
  it('suggests from phrasing and shows what it matched', () => {
    const s = suggestKnowledgeType('We decided to go with the slash geometry.');
    expect(s?.value).toBe('decision');
    expect(s?.basis.join(' ')).toContain('we decided');
  });

  it('never claims certainty', () => {
    // Phrase matching is evidence about wording, not about meaning. A number
    // near 1 would read as understanding this method does not have.
    const s = suggestKnowledgeType(
      'We decided to go with it, we will use the slash, and we chose to settle on that.',
    );
    expect(s!.confidence).toBeLessThanOrEqual(0.75);
    expect(s!.confidence).toBeGreaterThan(0);
  });

  it('returns null rather than a bad default', () => {
    expect(suggestKnowledgeType('The weather is pleasant today.')).toBeNull();
    expect(suggestKnowledgeType('')).toBeNull();
  });

  it('always carries a basis when it suggests anything', () => {
    for (const text of ['blocked on the API', 'fixed the crash', 'what if we tried amber']) {
      const s = suggestKnowledgeType(text);
      expect(s).not.toBeNull();
      expect(s!.basis.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic', () => {
    const text = 'We decided to ship, though it is blocked on the brand review.';
    expect(suggestKnowledgeType(text)).toEqual(suggestKnowledgeType(text));
  });
});

describe('suggestTopic', () => {
  const topics = [
    topic({ id: 't1', name: 'DailyRelay', slug: 'dailyrelay', lastMeaningfulUpdateAt: '2026-01-01T00:00:00Z' }),
    topic({ id: 't2', name: 'Invoice tooling', slug: 'invoice-tooling', lastMeaningfulUpdateAt: '2026-08-10T00:00:00Z' }),
  ];

  it('prefers a name mentioned in the text over the most recent topic', () => {
    const s = suggestTopic('The dailyrelay icon needs work', topics);
    expect(s?.value.id).toBe('t1');
    expect(s?.basis.join(' ')).toContain('dailyrelay');
  });

  it('falls back to recency, and says so at low confidence', () => {
    const s = suggestTopic('Some unrelated note about nothing in particular', topics);
    expect(s?.value.id).toBe('t2');
    expect(s!.confidence).toBeLessThanOrEqual(0.2);
    expect(s!.basis.join(' ')).toContain('most recently');
  });

  it('suggests nothing when there are no topics', () => {
    expect(suggestTopic('anything', [])).toBeNull();
  });

  it('does not match on stop words', () => {
    // "the" and "app" are in every second sentence; matching on them would
    // make the suggestion meaningless while still looking like evidence.
    const s = suggestTopic('the app is fine', [topic({ id: 't3', name: 'The App', slug: 'the-app' })]);
    expect(s!.confidence).toBeLessThanOrEqual(0.2);
  });
});

describe('suggestSource', () => {
  it('reads structure, not vocabulary', () => {
    const chat = suggestSource('User: hello\nAssistant: hi there');
    expect(chat?.value).toBe('claude_chat');

    const code = suggestSource('commit a1b2c3d4e5f\ndiff --git a/x b/x');
    expect(code?.value).toBe('claude_code');
  });

  it('returns null when the text says nothing, which means manual', () => {
    // rule 11: unknown provenance is 'manual', not a guessed source.
    expect(suggestSource('Just a note to myself.')).toBeNull();
  });
});
