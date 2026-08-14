import { describe, expect, it } from 'vitest';

import { assembleResumeContext } from './assemble';
import { NOW, action, decision, entry, idea, promptSet, session, subtopic, topic, file } from './fixtures';
import { formatResume } from './format';
import type { ResumeInput, ResumeOptions } from './types';

/**
 * Resume assembly at realistic and unrealistic volume.
 *
 * Assembly is pure, so this measures exactly what it claims to: the selection
 * and formatting work, with no database, no network and no clock. The
 * repository side is bounded separately — `getContext` batches every record
 * type in parallel, `listWithVersions` replaced the per-prompt N+1, and the
 * relationship traversal walks one frontier per query to a fixed depth.
 *
 * The assertions are shape assertions, not stopwatch assertions where a
 * stopwatch would be meaningless. What must hold at any size:
 *
 *   * Compact does not grow with the topic. If it did, the density would be a
 *     label rather than a guarantee, and a "fast continuation" would quietly
 *     become a 40,000-token paste.
 *   * Full Audit grows, but bounded — no unbounded traversal, no raw
 *     transcripts.
 *   * Nothing is dropped without being recorded in `truncations`.
 *
 * A generous wall-clock ceiling is included because a pathological regression —
 * an accidental O(n²) in the sort or the avoid-list — should fail rather than
 * merely get slower.
 */

const opts = (over: Partial<ResumeOptions> = {}): ResumeOptions => ({
  target: 'claude_chat',
  density: 'standard',
  now: NOW,
  ...over,
});

const iso = (daysAgo: number) => new Date(Date.parse(NOW) - daysAgo * 86_400_000).toISOString();

/** A topic at the size the brief specifies for LARGE. */
function largeTopic(): ResumeInput {
  const types = ['implementation', 'added', 'removed', 'refactored', 'bug', 'fix', 'progress', 'requirement'] as const;

  return {
    topic: topic(),
    subtopics: Array.from({ length: 12 }, (_, i) =>
      subtopic({ id: `s${i}`, name: `Area ${i}`, slug: `area-${i}` }),
    ),
    entries: Array.from({ length: 500 }, (_, i) =>
      entry({
        id: `e${i}`,
        knowledgeType: types[i % types.length]!,
        title: `Entry ${i} covering the relay work`,
        content: `Body for entry ${i}. `.repeat(8),
        occurredAt: iso(i % 300),
        subtopicIds: i % 3 === 0 ? [`s${i % 12}`] : [],
        status: i % 11 === 0 ? 'superseded' : 'active',
        supersededById: i % 11 === 0 ? `e${i + 1}` : null,
        supersedesReason: i % 11 === 0 ? `replaced by a better approach at step ${i}` : null,
      }),
    ),
    decisions: Array.from({ length: 100 }, (_, i) =>
      decision({
        id: `d${i}`,
        title: `Decision ${i}`,
        decision: `We will do approach ${i}`,
        reason: `Because of constraint ${i}`,
        status: i % 4 === 0 ? 'superseded' : 'active',
        supersededById: i % 4 === 0 ? `d${i + 1}` : null,
        supersedeReason: i % 4 === 0 ? `approach ${i} did not scale` : null,
        decidedAt: iso(i * 2),
        subtopicId: i % 5 === 0 ? `s${i % 12}` : null,
      }),
    ),
    ideas: Array.from({ length: 100 }, (_, i) =>
      idea({
        id: `i${i}`,
        title: `Idea ${i}`,
        rationale: `Reasoning for idea ${i}`,
        status: i % 3 === 0 ? 'rejected' : 'suggested',
        createdAt: iso(i),
      }),
    ),
    actions: Array.from({ length: 60 }, (_, i) =>
      action({
        id: `a${i}`,
        kind: i % 5 === 0 ? 'blocker' : i % 7 === 0 ? 'question' : 'next_step',
        title: `Task ${i}`,
        position: i,
        status: i % 9 === 0 ? 'done' : 'open',
      }),
    ),
    files: Array.from({ length: 40 }, (_, i) => file({ id: `f${i}`, path: `src/module-${i}.ts` })),
    sessions: Array.from({ length: 30 }, (_, i) =>
      session({
        id: `ss${i}`,
        title: `Session ${i}`,
        summary: `Summary ${i}`,
        // Raw transcripts are large on purpose: a Resume must never inline
        // them, and a fixture without them could not prove that.
        rawContent: 'User: a long transcript line that goes on. '.repeat(200),
        occurredAt: iso(i * 3),
        sourceType: i % 3 === 0 ? 'claude_code' : 'claude_chat',
      }),
    ),
    milestones: [],
    prompts: Array.from({ length: 100 }, (_, i) => {
      const set = promptSet({ title: `Prompt ${i}`, winningVersion: i % 2 === 0 ? 1 : 2 });
      return {
        ...set,
        prompt: { ...set.prompt, id: `p${i}` },
        versions: set.versions.map((v) => ({ ...v, id: `${v.id}-${i}` })),
        version: set.version ? { ...set.version, id: `${set.version.id}-${i}` } : null,
      };
    }),
  };
}

function measure(input: ResumeInput, options: ResumeOptions) {
  const started = performance.now();
  const ctx = assembleResumeContext(input, options);
  const formatted = formatResume(ctx);
  return { ms: performance.now() - started, ctx, formatted };
}

describe('assembly at scale', () => {
  const large = largeTopic();

  it('has the specified volume', () => {
    expect(large.entries).toHaveLength(500);
    expect(large.decisions).toHaveLength(100);
    expect(large.ideas).toHaveLength(100);
    expect(large.prompts).toHaveLength(100);
    // 100 prompts × 2 versions.
    expect(large.prompts.flatMap((p) => p.versions)).toHaveLength(200);
  });

  it('Compact stays compact regardless of topic size', () => {
    const small = measure({ ...large, entries: large.entries.slice(0, 5), decisions: large.decisions.slice(0, 2) }, opts({ density: 'compact' }));
    const big = measure(large, opts({ density: 'compact' }));

    expect(big.ctx.activeDecisions.length).toBeLessThanOrEqual(5);
    expect(big.ctx.recentChanges).toHaveLength(3);
    expect(big.ctx.avoid.length).toBeLessThanOrEqual(5);
    expect(big.ctx.references).toHaveLength(0);

    // The guarantee that makes Compact a density rather than a label: a topic
    // 100× larger produces an export of the same order.
    expect(big.formatted.size.approxTokens).toBeLessThan(2_000);
    expect(big.formatted.size.approxTokens).toBeLessThan(small.formatted.size.approxTokens * 4);
  });

  it('Standard is bounded too', () => {
    const { ctx, formatted } = measure(large, opts({ density: 'standard' }));
    expect(ctx.recentChanges.length).toBeLessThanOrEqual(10);
    expect(ctx.references.length).toBeLessThanOrEqual(12);
    expect(ctx.winningPrompts.length).toBeLessThanOrEqual(5);
    expect(formatted.size.approxTokens).toBeLessThan(12_000);
  });

  it('Full Audit grows but never inlines a raw transcript', () => {
    const { formatted } = measure(large, opts({ density: 'full_audit' }));
    // The fixture's transcripts are ~8,600 characters each. If any were
    // inlined the export would be enormous and this would catch it.
    expect(formatted.markdown).not.toContain('a long transcript line that goes on. User:');
    expect(formatted.size.characters).toBeLessThan(400_000);
  });

  it('says what it left out at every density', () => {
    for (const density of ['compact', 'standard'] as const) {
      const { ctx } = measure(large, opts({ density }));
      expect(ctx.truncations.length).toBeGreaterThan(0);
      for (const t of ctx.truncations) expect(t.total).toBeGreaterThan(t.shown);
    }
  });

  it('completes well inside a ceiling that would catch a quadratic regression', () => {
    for (const density of ['compact', 'standard', 'full_audit'] as const) {
      const { ms } = measure(large, opts({ density }));
      expect(ms).toBeLessThan(1_000);
    }
  });

  it('subtopic scope does not walk the whole topic', () => {
    const { ctx } = measure(large, opts({ subtopicId: 's3', density: 'standard' }));
    const foreign = ctx.completedWork.filter(
      (e) => e.subtopicIds.length > 0 && !e.subtopicIds.includes('s3'),
    );
    expect(foreign).toHaveLength(0);
  });

  it('is deterministic at scale, including tie-broken ordering', () => {
    // Every entry in this fixture shares a timestamp with several others, so
    // without the id tiebreak the same query would order differently between
    // runs and paging would repeat or drop rows.
    const a = measure(large, opts({ density: 'full_audit' }));
    const b = measure(large, opts({ density: 'full_audit' }));
    expect(a.formatted.markdown).toBe(b.formatted.markdown);
  });

  it('all three destinations stay bounded on the same large topic', () => {
    for (const target of ['claude_chat', 'claude_cowork', 'claude_code'] as const) {
      const { formatted } = measure(large, opts({ target, density: 'standard' }));
      expect(formatted.size.approxTokens).toBeGreaterThan(0);
      expect(formatted.size.approxTokens).toBeLessThan(12_000);
    }
  });
});
