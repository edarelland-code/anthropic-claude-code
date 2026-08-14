import { describe, expect, it } from 'vitest';

import { assembleResumeContext } from './assemble';
import { NOW, action, decision, entry, session, topic } from './fixtures';
import { formatResume } from './format';
import type { ResumeInput, ResumeOptions } from './types';

/**
 * The Phase 5 → Phase 4 regression: what a Claude Code delivery does to the
 * next Resume.
 *
 * This is the test the whole pipeline exists to pass. Automating capture is
 * worth nothing if the Resume that a fresh session reads afterwards is still
 * describing the state before the work happened — it would be worse than
 * nothing, because it would be confidently wrong.
 *
 * The story: before ingestion the immediate next action is X. A session then
 * reports X finished, Y started, a feature implemented, a bug found and fixed,
 * tests passing, on a named commit — and proposes one decision. Afterwards:
 *
 *   * Y is the immediate next action and X is not
 *   * the implementation, the bug and the fix are all present
 *   * build, test, repository, branch and commit reflect the latest session
 *   * the proposed decision is visible but is NOT active
 */

const ago = (days: number) => new Date(Date.parse(NOW) - days * 86_400_000).toISOString();

const opts = (over: Partial<ResumeOptions> = {}): ResumeOptions => ({
  target: 'claude_code',
  density: 'standard',
  now: NOW,
  ...over,
});

/** The topic as it stood before the session ran. */
function before(): ResumeInput {
  return {
    topic: topic({ currentState: 'Export path half-built.' }),
    subtopics: [],
    entries: [],
    decisions: [
      decision({
        id: 'd-live',
        title: 'Receipts are ids, not objects',
        decision: 'The endpoint returns ids and the client re-reads',
        status: 'active',
      }),
    ],
    ideas: [],
    actions: [action({ id: 'a-x', title: 'Wire the export button', status: 'open', position: 1 })],
    files: [],
    sessions: [],
    milestones: [],
    prompts: [],
  };
}

/** The same topic after one delivery through `/api/ingest`. */
function after(): ResumeInput {
  const start = before();
  return {
    ...start,
    entries: [
      entry({
        id: 'e-impl',
        knowledgeType: 'implementation',
        title: 'Export button wired to the receipt view',
        sourceType: 'claude_code',
        sourceSessionId: 'ss-1',
        occurredAt: ago(0),
      }),
      entry({
        id: 'e-bug',
        knowledgeType: 'bug',
        title: 'Clipboard rejected without a user gesture on Firefox',
        sourceType: 'claude_code',
        sourceSessionId: 'ss-1',
        occurredAt: ago(0),
      }),
      entry({
        id: 'e-fix',
        knowledgeType: 'fix',
        title: 'Select the text as a fallback and record either way',
        sourceType: 'claude_code',
        sourceSessionId: 'ss-1',
        occurredAt: ago(0),
      }),
    ],
    decisions: [
      ...start.decisions,
      decision({
        id: 'd-proposed',
        title: 'Drop the legacy exporter',
        decision: 'Remove src/legacy-export.ts entirely',
        reason: 'Nothing has imported it since the rewrite.',
        status: 'proposed',
        sourceType: 'claude_code',
        sourceSessionId: 'ss-1',
        decidedAt: ago(0),
      }),
    ],
    // X is closed because the delivery NAMED it. Y is new and open.
    actions: [
      action({ id: 'a-x', title: 'Wire the export button', status: 'done', position: 1 }),
      action({ id: 'a-y', title: 'Render the receipt ids', status: 'open', position: 2 }),
    ],
    sessions: [
      session({
        id: 'ss-1',
        sourceType: 'claude_code',
        title: 'Export button + receipt view',
        repoUrl: 'https://github.com/you/dailyrelay',
        branch: 'phase-5-ingestion',
        commitSha: '9f2c1ab7de34',
        filesChanged: ['src/export.ts'],
        buildStatus: 'passed',
        testSummary: '197 passed, 0 failed',
        occurredAt: ago(0),
      }),
    ],
  };
}

describe('the next action moves', () => {
  it('is X before the session', () => {
    const ctx = assembleResumeContext(before(), opts());
    expect(ctx.nextAction.primary?.title).toBe('Wire the export button');
  });

  it('is Y afterwards, and X is gone from the open work', () => {
    const ctx = assembleResumeContext(after(), opts());
    expect(ctx.nextAction.primary?.title).toBe('Render the receipt ids');
    expect(ctx.nextAction.secondary.map((a) => a.title)).not.toContain('Wire the export button');
    expect(ctx.remainingWork.map((a) => a.title)).not.toContain('Wire the export button');
  });

  it('does not present the finished action anywhere as still to do', () => {
    const { markdown } = formatResume(assembleResumeContext(after(), opts()));
    const outstanding = markdown.slice(markdown.indexOf('Immediate Next'));
    expect(outstanding).not.toMatch(/Outstanding Work[\s\S]*Wire the export button/);
  });
});

describe('the work itself lands', () => {
  it('carries the implementation, the bug and the fix', () => {
    const { markdown } = formatResume(assembleResumeContext(after(), opts()));
    expect(markdown).toContain('Export button wired to the receipt view');
    expect(markdown).toContain('Clipboard rejected without a user gesture on Firefox');
    expect(markdown).toContain('Select the text as a fallback');
  });

  it('reports repository, branch, commit, build and tests from the latest session', () => {
    const { markdown } = formatResume(assembleResumeContext(after(), opts()));
    expect(markdown).toContain('https://github.com/you/dailyrelay');
    expect(markdown).toContain('phase-5-ingestion');
    expect(markdown).toContain('9f2c1ab7de34');
    expect(markdown).toContain('**Build:** passed');
    expect(markdown).toContain('**Tests:** 197 passed, 0 failed');
  });

  it('had none of that to report before the session', () => {
    const { markdown } = formatResume(assembleResumeContext(before(), opts()));
    expect(markdown).not.toContain('9f2c1ab7de34');
    expect(markdown).not.toContain('**Build:**');
  });
});

describe('a proposed decision is not a decision', () => {
  it('never appears among the active ones', () => {
    const ctx = assembleResumeContext(after(), opts());
    expect(ctx.activeDecisions.map((d) => d.id)).toEqual(['d-live']);
    expect(ctx.pendingDecisions.map((d) => d.id)).toEqual(['d-proposed']);
  });

  it('is not filed as history either — it was never in force', () => {
    const ctx = assembleResumeContext(after(), opts({ density: 'full_audit' }));
    expect(ctx.historicalDecisions.map((d) => d.id)).not.toContain('d-proposed');
  });

  it('is labelled as awaiting review, and the session is told not to build on it', () => {
    const { markdown } = formatResume(assembleResumeContext(after(), opts()));
    expect(markdown).toContain('AWAITING REVIEW, NOT IN FORCE');
    expect(markdown).toContain('Drop the legacy exporter');
    expect(markdown).toMatch(/Do NOT treat them as decided/);
    // The label sits above the proposal and below the active list, so a reader
    // scanning downward cannot reach the proposal without the warning.
    expect(markdown.indexOf('Active Decisions — CURRENT')).toBeLessThan(
      markdown.indexOf('AWAITING REVIEW'),
    );
    expect(markdown.indexOf('AWAITING REVIEW')).toBeLessThan(
      markdown.indexOf('Drop the legacy exporter'),
    );
  });

  it('never reaches the avoid list — nobody turned it down', () => {
    // The sharpest failure this pipeline can produce. `avoidList` used to treat
    // every non-active decision as one that had been evaluated and set aside,
    // which was safe while every decision had been decided by a person. A
    // proposal on the avoid list tells the next session to refuse a direction
    // nobody has even looked at yet.
    const ctx = assembleResumeContext(after(), opts());
    expect(ctx.avoid.map((a) => a.title)).not.toContain('Drop the legacy exporter');

    const { markdown } = formatResume(ctx);
    const avoidSection = markdown.slice(markdown.indexOf('Avoid / Do Not Repeat'));
    expect(avoidSection).not.toContain('Drop the legacy exporter');
  });

  it('is labelled proposed, not historical, among recent changes', () => {
    const ctx = assembleResumeContext(after(), opts());
    const change = ctx.recentChanges.find((c) => c.title === 'Drop the legacy exporter');
    expect(change?.state).toBe('proposed');

    const { markdown } = formatResume(ctx);
    expect(markdown).not.toMatch(/Drop the legacy exporter _\(historical\)_/);
    expect(markdown).toMatch(/Drop the legacy exporter _\(proposed — not approved\)_/);
  });

  it('still puts a genuinely rejected decision on the avoid list', () => {
    // The fix must not have widened into "decisions never reach the avoid
    // list". A rejection is exactly what the avoid list is for.
    const input = after();
    input.decisions = [
      ...input.decisions,
      decision({
        id: 'd-rejected',
        title: 'Ship without a receipt view',
        decision: 'Return ids only and stop there',
        reason: 'Users could not tell whether anything had been recorded.',
        status: 'rejected',
      }),
    ];
    const ctx = assembleResumeContext(input, opts());
    expect(ctx.avoid.map((a) => a.title)).toContain('Ship without a receipt view');
  });

  it('says where it came from, so nobody mistakes it for their own note', () => {
    const { markdown } = formatResume(assembleResumeContext(after(), opts()));
    expect(markdown).toContain('proposed by a Claude Code session');
  });

  it('reaches every density — a proposal nobody sees never happens', () => {
    for (const density of ['compact', 'standard', 'full_audit'] as const) {
      const { markdown } = formatResume(assembleResumeContext(after(), opts({ density })));
      expect(markdown, density).toContain('Drop the legacy exporter');
      expect(markdown, density).toContain('AWAITING REVIEW');
    }
  });

  it('reaches every destination too', () => {
    for (const target of ['claude_chat', 'claude_cowork', 'claude_code'] as const) {
      const { markdown } = formatResume(assembleResumeContext(after(), opts({ target })));
      expect(markdown, target).toContain('AWAITING REVIEW, NOT IN FORCE');
    }
  });
});

describe('what the delivery did not touch', () => {
  it('leaves Current State exactly as the person wrote it', () => {
    // The session reported a great deal of progress. Current State is a
    // judgement and stays a judgement — nothing in the delivery may edit it.
    const ctx = assembleResumeContext(after(), opts());
    expect(ctx.currentState).toBe('Export path half-built.');
  });

  it('leaves the existing active decision in force and unedited', () => {
    const ctx = assembleResumeContext(after(), opts());
    expect(ctx.activeDecisions[0]?.decision).toBe(
      'The endpoint returns ids and the client re-reads',
    );
    expect(ctx.activeDecisions[0]?.supersededById).toBeNull();
  });
});
