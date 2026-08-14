/**
 * Fixture builders for the Resume test cases.
 *
 * Kept out of the test file so the five scenarios the brief specifies can be
 * read as scenarios rather than as walls of object literals, and so the
 * performance suite can reuse the same shapes at scale.
 */

import type {
  Action,
  Decision,
  FileReference,
  Idea,
  KnowledgeEntry,
  Milestone,
  Prompt,
  PromptVersion,
  SourceSession,
  Subtopic,
  Topic,
} from '../domain/types';
import type { ResumeInput } from './types';

export const NOW = '2026-08-14T12:00:00Z';
const ago = (days: number) => new Date(Date.parse(NOW) - days * 86_400_000).toISOString();

export function topic(over: Partial<Topic> = {}): Topic {
  return {
    id: 't1',
    workspaceId: 'w1',
    name: 'DailyRelay',
    slug: 'dailyrelay',
    description: 'A relay app',
    goal: 'Ship v1 of the launcher',
    currentState: 'Icon geometry approved; nudge testing outstanding.',
    status: 'active',
    progress: 60,
    pinned: false,
    resumeTriggerIf: 'I return to DailyRelay',
    resumeTriggerThen: 'Finish the relay-nudge testing',
    lastMeaningfulUpdateAt: ago(1),
    archivedAt: null,
    createdAt: ago(90),
    updatedAt: ago(1),
    ...over,
  };
}

export function subtopic(over: Partial<Subtopic> = {}): Subtopic {
  return {
    id: 's1',
    workspaceId: 'w1',
    topicId: 't1',
    parentSubtopicId: null,
    name: 'App Icon',
    slug: 'app-icon',
    description: null,
    goal: 'A launcher icon that reads at 16px',
    currentState: 'Slash geometry approved, rendering at 16px still to verify.',
    status: 'active',
    position: 0,
    resumeTriggerIf: 'I return to the App Icon work',
    resumeTriggerThen: 'Render the slash geometry at 16px and check legibility',
    lastMeaningfulUpdateAt: ago(1),
    archivedAt: null,
    createdAt: ago(60),
    updatedAt: ago(1),
    ...over,
  };
}

export function entry(over: Partial<KnowledgeEntry>): KnowledgeEntry {
  return {
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
    occurredAt: ago(2),
    supersededById: null,
    supersedesReason: null,
    importance: 2,
    createdAt: ago(2),
    updatedAt: ago(2),
    ...over,
  };
}

export function decision(over: Partial<Decision>): Decision {
  return {
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
    decidedAt: ago(3),
    supersededById: null,
    supersedeReason: null,
    sourceType: 'manual',
    sourceSessionId: null,
    ...over,
  };
}

export function idea(over: Partial<Idea>): Idea {
  return {
    id: 'i1',
    workspaceId: 'w1',
    topicId: 't1',
    subtopicId: null,
    title: 'Idea',
    idea: null,
    rationale: null,
    status: 'suggested',
    decisionId: null,
    implementationEntryId: null,
    sourceType: 'manual',
    sourceSessionId: null,
    createdAt: ago(5),
    ...over,
  };
}

export function action(over: Partial<Action>): Action {
  return {
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
    createdAt: ago(2),
    ...over,
  };
}

export function session(over: Partial<SourceSession>): SourceSession {
  return {
    id: 'ss1',
    workspaceId: 'w1',
    topicId: 't1',
    sourceType: 'claude_chat',
    title: 'Session',
    externalUrl: null,
    occurredAt: ago(2),
    summary: null,
    rawContent: null,
    repoUrl: null,
    branch: null,
    commitSha: null,
    filesChanged: [],
    filesAdded: [],
    filesRemoved: [],
    buildStatus: null,
    testSummary: null,
    createdAt: ago(2),
    ...over,
  };
}

export function file(over: Partial<FileReference>): FileReference {
  return {
    id: 'f1',
    workspaceId: 'w1',
    topicId: 't1',
    subtopicId: null,
    kind: 'repo_file',
    path: 'src/icon.tsx',
    displayName: null,
    url: null,
    repoUrl: null,
    branch: null,
    commitSha: null,
    createdAt: ago(4),
    ...over,
  };
}

export function promptSet(over: {
  winningVersion?: number;
  title?: string;
  purpose?: string | null;
  reason?: string | null;
} = {}): ResumeInput['prompts'][number] {
  const prompt: Prompt = {
    id: 'p1',
    workspaceId: 'w1',
    topicId: 't1',
    subtopicId: null,
    title: over.title ?? 'Icon generation prompt',
    purpose: over.purpose ?? 'Generate launcher icon candidates',
    sourceType: 'claude_chat',
    currentVersionId: 'pv2',
    isWinning: true,
    createdAt: ago(10),
    updatedAt: ago(4),
  };
  const version = (id: string, n: number, body: string, result: PromptVersion['result']): PromptVersion => ({
    id,
    promptId: 'p1',
    version: n,
    body,
    result,
    rating: null,
    notes: null,
    outputSummary: null,
    createdAt: ago(12 - n),
  });
  const versions = [
    version('pv2', 2, 'VERSION TWO BODY — the one that won', 'worked'),
    version('pv1', 1, 'VERSION ONE BODY — first attempt', 'failed'),
  ];
  const wanted = over.winningVersion ?? 2;
  return {
    prompt,
    version: versions.find((v) => v.version === wanted) ?? null,
    versions,
    reason: over.reason ?? 'best legibility at 16px',
  };
}

export function milestone(over: Partial<Milestone>): Milestone {
  return {
    id: 'm1',
    workspaceId: 'w1',
    topicId: 't1',
    title: 'Milestone',
    detail: null,
    achievedAt: ago(20),
    status: 'achieved',
    ...over,
  };
}

function base(over: Partial<ResumeInput> = {}): ResumeInput {
  return {
    topic: topic(),
    subtopics: [],
    entries: [],
    decisions: [],
    ideas: [],
    actions: [],
    files: [],
    sessions: [],
    milestones: [],
    prompts: [],
    ...over,
  };
}

/**
 * CASE 1 — feature continuation.
 * A superseded decision, a rejected idea, an implementation, a fixed bug, a
 * winning prompt at v2, a live blocker and a next action.
 */
export function caseFeatureContinuation(): ResumeInput {
  return base({
    subtopics: [subtopic()],
    entries: [
      entry({ id: 'e-impl', knowledgeType: 'implementation', title: 'Slash geometry rendered', occurredAt: ago(2) }),
      entry({ id: 'e-fix', knowledgeType: 'fix', title: 'Fixed 15px rendering offset', occurredAt: ago(1) }),
      entry({ id: 'e-req', knowledgeType: 'requirement', title: 'Icon must read at 16px', content: 'Non-negotiable.', occurredAt: ago(30) }),
      entry({ id: 'e-noise', knowledgeType: 'progress', title: 'Chatted about colours', occurredAt: ago(1) }),
    ],
    decisions: [
      decision({
        id: 'd-old',
        title: 'Blue icon',
        decision: 'Use a blue circle',
        status: 'superseded',
        supersededById: 'd-new',
        supersedeReason: 'read as a status dot at 16px',
        decidedAt: ago(20),
      }),
      decision({ id: 'd-new', title: 'Slash geometry', decision: 'Use the slash geometry', reason: 'Legible at 16px', decidedAt: ago(8) }),
    ],
    ideas: [
      idea({ id: 'i-rej', title: 'Overlay a checkmark', rationale: 'reads as "done", not "relay"', status: 'rejected' }),
    ],
    actions: [
      action({ id: 'a-next', title: 'Render the slash geometry at 16px', position: 0 }),
      action({ id: 'a-block', kind: 'blocker', title: 'Waiting on brand sign-off', position: 0 }),
      action({ id: 'a-later', title: 'Export the icon set', position: 1 }),
    ],
    prompts: [promptSet()],
    files: [file({ id: 'f-icon', path: 'src/components/icon.tsx' })],
    sessions: [session({ id: 'ss-chat', title: 'Icon exploration', summary: 'Discussed geometry' })],
  });
}

/**
 * CASE 2 — design evolution across three versions.
 * v1 proposed, v2 rejected, v3 active.
 */
export function caseDesignEvolution(): ResumeInput {
  return base({
    decisions: [
      decision({ id: 'v1', title: 'Version 1 — rounded square', decision: 'Rounded square mark', status: 'superseded', supersededById: 'v3', supersedeReason: 'too generic', decidedAt: ago(40) }),
      decision({ id: 'v2', title: 'Version 2 — checkmark overlay', decision: 'Overlay a checkmark', status: 'rejected', reason: 'reads as "done", not "relay"', decidedAt: ago(30) }),
      decision({ id: 'v3', title: 'Version 3 — slash geometry', decision: 'Slash to arrow to X', reason: 'Legible and distinctive', decidedAt: ago(10) }),
    ],
    entries: [entry({ id: 'e-v3', knowledgeType: 'implementation', title: 'Built version 3', occurredAt: ago(9) })],
    actions: [action({ id: 'a1', title: 'Ship version 3' })],
  });
}

/** CASE 3 — Claude Code continuation, with real repository state. */
export function caseClaudeCode(): ResumeInput {
  return base({
    entries: [
      entry({ id: 'e-bug', knowledgeType: 'bug', title: 'Timeline query returns duplicates', occurredAt: ago(2) }),
      entry({ id: 'e-fix', knowledgeType: 'fix', title: 'Deduplicated the timeline union', occurredAt: ago(1) }),
      entry({ id: 'e-impl', knowledgeType: 'implementation', title: 'Added the search projection', occurredAt: ago(3) }),
    ],
    decisions: [decision({ id: 'd-view', title: 'Use a database view for the Timeline', decision: 'timeline_events is authoritative', reason: 'Application-level merging drifts' })],
    actions: [action({ id: 'a-code', title: 'Add an index for the workspace timeline query' })],
    files: [
      file({ id: 'f-claude', path: 'CLAUDE.md', repoUrl: 'github.com/you/contextshelf', branch: 'main' }),
      file({ id: 'f-repo', path: 'src/lib/adapters/supabase/repositories.ts' }),
    ],
    sessions: [
      session({
        id: 'ss-code',
        sourceType: 'claude_code',
        title: 'Timeline fix',
        repoUrl: 'github.com/you/contextshelf',
        branch: 'phase-4-resume',
        commitSha: 'a1b2c3d4e5f6',
        filesChanged: ['src/lib/adapters/supabase/repositories.ts', 'supabase/migrations/0004_capture.sql'],
        buildStatus: 'passing',
        testSummary: '109 unit tests, 7 SQL suites',
        occurredAt: ago(1),
      }),
    ],
  });
}

/** CASE 4 — stale context: nothing meaningful in over a month. */
export function caseStale(): ResumeInput {
  return base({
    topic: topic({ lastMeaningfulUpdateAt: ago(45) }),
    decisions: [decision({ id: 'd-old', title: 'Use approach A', decision: 'Approach A', decidedAt: ago(60) })],
    actions: [action({ id: 'a1', title: 'Finish approach A' })],
  });
}

/** CASE 5 — two active decisions that cannot both be the direction. */
export function caseConflict(): ResumeInput {
  return base({
    decisions: [
      decision({ id: 'c1', title: 'Icon direction', decision: 'Use the slash geometry', decidedAt: ago(5) }),
      decision({ id: 'c2', title: 'Icon direction', decision: 'Use the rounded square', decidedAt: ago(3) }),
    ],
    actions: [action({ id: 'a1', title: 'Settle the icon direction' })],
  });
}
