import { describe, expect, it } from 'vitest';

import { assembleResumeContext } from './assemble';
import {
  NOW,
  action,
  caseClaudeCode,
  caseConflict,
  caseDesignEvolution,
  caseFeatureContinuation,
  caseStale,
  decision,
  entry,
  idea,
  promptSet,
  subtopic,
  topic,
} from './fixtures';
import { formatForClaudeChat, formatForClaudeCode, formatForCowork } from './format';
import type { ResumeOptions } from './types';

const opts = (over: Partial<ResumeOptions> = {}): ResumeOptions => ({
  target: 'claude_chat',
  density: 'standard',
  now: NOW,
  ...over,
});

/**
 * The properties asserted here are the ones a wrong Resume would violate
 * silently — a superseded decision presented as current, a rejected idea
 * missing from the avoid list, the newest prompt version passed off as the
 * winner, or a next action that nobody ever recorded. Each of those produces a
 * document that reads perfectly and sends a fresh session the wrong way.
 */

describe('CASE 1 — feature continuation', () => {
  const input = caseFeatureContinuation();

  it('Compact carries the current direction, not the replaced one', () => {
    const ctx = assembleResumeContext(input, opts({ density: 'compact' }));
    expect(ctx.activeDecisions.map((d) => d.id)).toEqual(['d-new']);
    expect(ctx.activeDecisions.map((d) => d.id)).not.toContain('d-old');
  });

  it('Compact still carries the avoid list, with reasons', () => {
    // Rule 9: the avoid-list is mandatory in every density, Compact included.
    const ctx = assembleResumeContext(input, opts({ density: 'compact' }));
    const titles = ctx.avoid.map((a) => a.title);
    expect(titles).toContain('Blue icon');
    expect(titles).toContain('Overlay a checkmark');
    expect(ctx.avoid.find((a) => a.title === 'Blue icon')?.reason).toBe('read as a status dot at 16px');
  });

  it('ranks the superseded decision above the rejected idea in Compact', () => {
    const ctx = assembleResumeContext(input, opts({ density: 'compact' }));
    expect(ctx.avoid[0]!.kind).toBe('superseded_decision');
  });

  it('picks one next action and does not promote the blocker to it', () => {
    const ctx = assembleResumeContext(input, opts({ density: 'compact' }));
    expect(ctx.nextAction.primary?.id).toBe('a-next');
    // "Waiting on brand sign-off" is not something to do — it is why nothing
    // is happening. Presenting it as the next action would stall the session.
    expect(ctx.nextAction.primary?.kind).toBe('next_step');
    expect(ctx.blockers.map((b) => b.id)).toEqual(['a-block']);
  });

  it('Compact holds three meaningful changes and drops the chatter', () => {
    const ctx = assembleResumeContext(input, opts({ density: 'compact' }));
    expect(ctx.recentChanges).toHaveLength(3);
    expect(ctx.recentChanges.map((c) => c.title)).not.toContain('Chatted about colours');
  });

  it('Compact keeps the winning prompt only when it relates to the next task', () => {
    // The next action is "Render the slash geometry at 16px" and the prompt is
    // an icon-generation prompt — no shared term, so Compact omits it.
    const compact = assembleResumeContext(input, opts({ density: 'compact' }));
    expect(compact.winningPrompts).toHaveLength(0);

    const related = assembleResumeContext(
      { ...input, actions: [action({ id: 'a-next', title: 'Generate more icon candidates' })] },
      opts({ density: 'compact' }),
    );
    expect(related.winningPrompts).toHaveLength(1);
  });

  it('Standard includes every winning prompt regardless of relatedness', () => {
    const ctx = assembleResumeContext(input, opts({ density: 'standard' }));
    expect(ctx.winningPrompts).toHaveLength(1);
    expect(ctx.winningPrompts[0]!.version).toBe(2);
  });

  it('records what a cap removed rather than dropping it silently', () => {
    const ctx = assembleResumeContext(input, opts({ density: 'compact' }));
    const changes = ctx.truncations.find((t) => t.section === 'recentChanges');
    expect(changes).toBeDefined();
    expect(changes!.total).toBeGreaterThan(changes!.shown);
  });
});

describe('CASE 2 — design evolution', () => {
  const input = caseDesignEvolution();

  it('Current State is version 3, and only version 3', () => {
    const ctx = assembleResumeContext(input, opts());
    expect(ctx.activeDecisions.map((d) => d.id)).toEqual(['v3']);
  });

  it('the rejected version reaches the avoid list with its reason', () => {
    const ctx = assembleResumeContext(input, opts());
    const rejected = ctx.avoid.find((a) => a.title.includes('Version 2'));
    expect(rejected).toBeDefined();
    expect(rejected!.reason).toBe('reads as "done", not "relay"');
  });

  it('Full Audit preserves all three versions, separated by state', () => {
    const ctx = assembleResumeContext(input, opts({ density: 'full_audit' }));
    expect(ctx.activeDecisions.map((d) => d.id)).toEqual(['v3']);
    expect(ctx.historicalDecisions.map((d) => d.id).sort()).toEqual(['v1', 'v2']);
  });

  it('Standard does not render history as if it were current', () => {
    const ctx = assembleResumeContext(input, opts({ density: 'standard' }));
    const md = formatForClaudeChat(ctx).markdown;
    const activeIndex = md.indexOf('Active Decisions — CURRENT');
    expect(activeIndex).toBeGreaterThan(-1);
    const activeBlock = md.slice(activeIndex, md.indexOf('##', activeIndex + 5));
    expect(activeBlock).toContain('Version 3');
    expect(activeBlock).not.toContain('Version 2');
  });
});

describe('CASE 3 — Claude Code continuation', () => {
  const input = caseClaudeCode();

  it('the Code formatter carries repository state', () => {
    const ctx = assembleResumeContext(input, opts({ target: 'claude_code' }));
    const md = formatForClaudeCode(ctx).markdown;
    expect(md).toContain('phase-4-resume');
    expect(md).toContain('a1b2c3d4e5f6');
    expect(md).toContain('passing');
    expect(md).toContain('Immediate Coding Task');
  });

  it('points at CLAUDE.md instead of pasting it', () => {
    const ctx = assembleResumeContext(input, opts({ target: 'claude_code' }));
    const md = formatForClaudeCode(ctx).markdown;
    expect(md).toContain('CLAUDE.md');
    expect(md).toContain('not reproduced here');
  });

  it('the Chat formatter carries no repository detail', () => {
    const ctx = assembleResumeContext(input, opts({ target: 'claude_chat' }));
    const md = formatForClaudeChat(ctx).markdown;
    expect(md).not.toContain('a1b2c3d4e5f6');
    expect(md).not.toContain('phase-4-resume');
    expect(md).not.toContain('## Repository');
  });

  it('code context is only assembled for the code destination', () => {
    expect(assembleResumeContext(input, opts({ target: 'claude_chat' })).code).toBeNull();
    expect(assembleResumeContext(input, opts({ target: 'claude_code' })).code).not.toBeNull();
  });

  it('Cowork distinguishes a reference from a file it can open', () => {
    const ctx = assembleResumeContext(input, opts({ target: 'claude_cowork' }));
    const md = formatForCowork(ctx).markdown;
    expect(md).toContain('Referenced file');
    // Claiming availability ContextShelf cannot verify would send the session
    // hunting for a file that is not there.
    expect(md).toContain('does not know whether the file is present');
  });
});

describe('CASE 4 — stale context', () => {
  const input = caseStale();

  it('still generates', () => {
    const ctx = assembleResumeContext(input, opts());
    expect(formatForClaudeChat(ctx).markdown.length).toBeGreaterThan(200);
  });

  it('warns, with the number of days', () => {
    const ctx = assembleResumeContext(input, opts());
    expect(ctx.freshness.level).toBe('needs_review');
    expect(ctx.freshness.days).toBe(45);
    expect(ctx.freshness.message).toContain('45 days');
    expect(formatForClaudeChat(ctx).markdown).toContain('45 days');
  });

  it('reads freshness from meaningful activity, not any edit', () => {
    // A rename bumps updatedAt but not lastMeaningfulUpdateAt (AD-10). A
    // freshness signal a rename could reset would be worse than none.
    const renamed = { ...input, topic: topic({ lastMeaningfulUpdateAt: input.topic.lastMeaningfulUpdateAt, updatedAt: NOW }) };
    expect(assembleResumeContext(renamed, opts()).freshness.level).toBe('needs_review');
  });
});

describe('CASE 5 — unresolved conflict', () => {
  const input = caseConflict();

  it('reports two active decisions with the same title', () => {
    const ctx = assembleResumeContext(input, opts());
    const conflict = ctx.conflicts.find((c) => c.kind === 'contradicting_decisions');
    expect(conflict).toBeDefined();
    expect(conflict!.recordIds.sort()).toEqual(['c1', 'c2']);
  });

  it('resolves nothing — both survive', () => {
    const ctx = assembleResumeContext(input, opts());
    expect(ctx.activeDecisions.map((d) => d.id).sort()).toEqual(['c1', 'c2']);
  });

  it('exports anyway, with the warning in the document', () => {
    const ctx = assembleResumeContext(input, opts());
    const md = formatForClaudeChat(ctx).markdown;
    expect(md).toContain('Unresolved Context Conflicts');
    expect(md).toContain('rather than choosing for me');
  });

  it('Compact does not raise a warning it has no room to explain', () => {
    expect(assembleResumeContext(input, opts({ density: 'compact' })).conflicts).toHaveLength(0);
  });
});

describe('scope', () => {
  const input = {
    ...caseFeatureContinuation(),
    subtopics: [subtopic(), subtopic({ id: 's2', name: 'Billing', slug: 'billing' })],
    entries: [
      entry({ id: 'e-icon', subtopicIds: ['s1'], knowledgeType: 'implementation', title: 'Icon work' }),
      entry({ id: 'e-bill', subtopicIds: ['s2'], knowledgeType: 'implementation', title: 'Billing work' }),
      entry({ id: 'e-rule', knowledgeType: 'requirement', title: 'Everything must work offline' }),
    ],
    decisions: [
      decision({ id: 'd-icon', subtopicId: 's1', title: 'Icon direction' }),
      decision({ id: 'd-bill', subtopicId: 's2', title: 'Billing provider' }),
      decision({ id: 'd-wide', subtopicId: null, title: 'Cloud is the source of truth' }),
    ],
  };

  it('a subtopic resume excludes unrelated sibling subtopics', () => {
    const ctx = assembleResumeContext(input, opts({ subtopicId: 's1' }));
    const ids = ctx.completedWork.map((e) => e.id);
    expect(ids).toContain('e-icon');
    expect(ids).not.toContain('e-bill');
    expect(ctx.activeDecisions.map((d) => d.id)).not.toContain('d-bill');
  });

  it('a subtopic resume keeps topic-wide decisions and rules that constrain it', () => {
    const ctx = assembleResumeContext(input, opts({ subtopicId: 's1' }));
    expect(ctx.activeDecisions.map((d) => d.id)).toContain('d-wide');
    expect(ctx.requirements.map((e) => e.id)).toContain('e-rule');
  });

  it('a subtopic resume shows both states and both triggers, subtopic first', () => {
    const ctx = assembleResumeContext(input, opts({ subtopicId: 's1' }));
    expect(ctx.currentState).toBe(subtopic().currentState);
    expect(ctx.parentCurrentState).toBe(topic().currentState);
    expect(ctx.triggers.map((t) => t.level)).toEqual(['subtopic', 'topic']);
  });

  it('a relationship pulls a sibling record in, but nothing else does', () => {
    const ctx = assembleResumeContext(
      { ...input, relatedIds: new Set(['e-bill']) },
      opts({ subtopicId: 's1' }),
    );
    expect(ctx.completedWork.map((e) => e.id)).toContain('e-bill');
  });

  it('a topic resume lists its subtopics structurally', () => {
    const ctx = assembleResumeContext(input, opts());
    expect(ctx.subtopics.map((s) => s.id)).toEqual(['s1', 's2']);
    // A subtopic resume is about one thing; listing the siblings there would
    // be the noise the scoping rule exists to remove.
    expect(assembleResumeContext(input, opts({ subtopicId: 's1' })).subtopics).toHaveLength(0);
  });
});

describe('winning prompts', () => {
  it('uses the selected version, never the newest', () => {
    const input = { ...caseFeatureContinuation(), prompts: [promptSet({ winningVersion: 1 })] };
    const ctx = assembleResumeContext(input, opts({ density: 'standard' }));
    expect(ctx.winningPrompts[0]!.version).toBe(1);
    expect(ctx.winningPrompts[0]!.body).toContain('VERSION ONE BODY');

    const md = formatForClaudeChat(ctx).markdown;
    expect(md).toContain('winning version v1');
    expect(md).toContain('VERSION ONE BODY');
    expect(md).not.toContain('VERSION TWO BODY');
  });

  it('Full Audit shows the versions that lost, as history', () => {
    const input = { ...caseFeatureContinuation(), prompts: [promptSet({ winningVersion: 1 })] };
    const ctx = assembleResumeContext(input, opts({ density: 'full_audit' }));
    expect(ctx.winningPrompts[0]!.otherVersions.map((v) => v.version)).toEqual([2]);
    expect(formatForClaudeChat(ctx).markdown).toContain('Other versions tried');
  });

  it('reports a selection whose version is gone rather than substituting', () => {
    const broken = { ...promptSet(), version: null };
    const ctx = assembleResumeContext(
      { ...caseFeatureContinuation(), prompts: [broken] },
      opts({ density: 'standard' }),
    );
    expect(ctx.winningPrompts).toHaveLength(0);
    expect(ctx.conflicts.map((c) => c.kind)).toContain('winning_version_missing');
  });
});

describe('next action', () => {
  it('prefers work already in progress over the first queued step', () => {
    const input = {
      ...caseFeatureContinuation(),
      actions: [
        action({ id: 'a-queued', title: 'Queued first', position: 0 }),
        action({ id: 'a-doing', title: 'Half finished', position: 3, status: 'in_progress' }),
      ],
    };
    const ctx = assembleResumeContext(input, opts());
    expect(ctx.nextAction.primary?.id).toBe('a-doing');
    expect(ctx.nextAction.basis).toBe('already in progress');
  });

  it('says so when nothing is recorded, rather than inventing one', () => {
    const ctx = assembleResumeContext({ ...caseFeatureContinuation(), actions: [] }, opts());
    expect(ctx.nextAction.primary).toBeNull();
    const md = formatForClaudeChat(ctx).markdown;
    expect(md).toContain('No explicit next action is currently recorded');
    expect(md).toContain('Ask what to work on before starting');
  });

  it('Compact carries no secondary queue', () => {
    const ctx = assembleResumeContext(caseFeatureContinuation(), opts({ density: 'compact' }));
    expect(ctx.nextAction.secondary).toHaveLength(0);
  });
});

describe('determinism and instructions', () => {
  it('produces byte-identical output for identical input', () => {
    const input = caseFeatureContinuation();
    const a = formatForClaudeChat(assembleResumeContext(input, opts()));
    const b = formatForClaudeChat(assembleResumeContext(input, opts()));
    expect(a.markdown).toBe(b.markdown);
  });

  it('every density instructs the session not to revive rejected directions', () => {
    for (const density of ['compact', 'standard', 'full_audit'] as const) {
      const ctx = assembleResumeContext(caseFeatureContinuation(), opts({ density }));
      const md = formatForClaudeChat(ctx).markdown;
      expect(md).toContain('Avoid / Do Not Repeat');
      expect(md).toContain('unless new evidence has appeared');
      expect(md).toContain('Treat **Current State** and **Active Decisions** as authoritative');
    }
  });

  it('Compact is materially smaller than Full Audit', () => {
    const input = caseFeatureContinuation();
    const compact = formatForClaudeChat(assembleResumeContext(input, opts({ density: 'compact' })));
    const full = formatForClaudeChat(assembleResumeContext(input, opts({ density: 'full_audit' })));
    expect(compact.size.characters).toBeLessThan(full.size.characters);
    expect(compact.size.approxTokens).toBeGreaterThan(0);
  });

  it('an excluded section disappears from the output', () => {
    const ctx = assembleResumeContext(
      caseFeatureContinuation(),
      opts({ excludeSections: ['winningPrompts'] }),
    );
    expect(ctx.sectionsIncluded).not.toContain('winningPrompts');
    expect(formatForClaudeChat(ctx).markdown).not.toContain('## Winning Prompts');
  });

  it('never presents an idea that was rejected as one still in play', () => {
    const input = {
      ...caseFeatureContinuation(),
      ideas: [
        idea({ id: 'i-live', title: 'Animate the relay', status: 'considering' }),
        idea({ id: 'i-dead', title: 'Overlay a checkmark', status: 'rejected', rationale: 'reads as done' }),
      ],
    };
    const ctx = assembleResumeContext(input, opts({ density: 'standard' }));
    expect(ctx.ideas.map((i) => i.id)).toEqual(['i-live']);
    expect(ctx.avoid.map((a) => a.title)).toContain('Overlay a checkmark');
  });
});
