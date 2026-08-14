/**
 * Master Topic Memory — the assembled answer to "what is true about this topic
 * right now, and what has already been ruled out".
 *
 * A pure function over rows that have already been read (CLAUDE.md rule 22).
 * It reaches for no database, so the guarantees below are testable without one,
 * and Phase 4's Resume assembler can reuse it unchanged.
 *
 * It is DERIVED and disposable (AD-8). Nothing here is stored: every field is
 * recomputed from the append-only tables on each read, so the memory cannot
 * drift from the records it summarises, and there is no second copy to keep in
 * step. `context_snapshots` exists to persist a rendering of this when Phase 4
 * needs one; it is not a source.
 *
 * The central rule it implements is CLAUDE.md rule 8: Current State is a read
 * over the same rows the Timeline reads, never a separate store. A superseded
 * decision does not disappear — it moves from `activeDecisions` to `avoid`,
 * carrying the reason it was replaced.
 */

import { avoidList, type AvoidItem } from '../domain/current-state';
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

export interface WinningPrompt {
  promptId: string;
  title: string;
  /** The exact version that won — not necessarily the latest. */
  versionId: string;
  version: number;
  body: string;
  reason: string | null;
}

export interface MasterTopicMemory {
  topic: { id: string; name: string; purpose: string | null; status: Topic['status']; progress: number };
  currentObjective: string | null;
  currentState: string | null;
  /** Decided and still standing: `active` and not replaced by anything newer. */
  activeDecisions: Decision[];
  /** Rules that outlive a single decision, recorded as requirements. */
  permanentRules: KnowledgeEntry[];
  requirements: KnowledgeEntry[];
  implemented: KnowledgeEntry[];
  removedOrRejected: AvoidItem[];
  lessonsLearned: KnowledgeEntry[];
  winningPrompts: WinningPrompt[];
  blockers: Action[];
  openQuestions: Action[];
  remainingWork: Action[];
  nextAction: Action | null;
  recentHistory: KnowledgeEntry[];
  subtopics: Subtopic[];
  files: FileReference[];
  sources: SourceSession[];
  milestones: Milestone[];
  ideasInFlight: Idea[];
  /** True when there is nothing to say yet — the UI shows guidance, not an empty shell. */
  isEmpty: boolean;
}

export interface MemoryInput {
  topic: Topic;
  subtopics?: Subtopic[];
  entries?: KnowledgeEntry[];
  decisions?: Decision[];
  ideas?: Idea[];
  prompts?: Array<{ prompt: Prompt; versions: PromptVersion[]; winningVersionId?: string | null; winningReason?: string | null }>;
  actions?: Action[];
  files?: FileReference[];
  sessions?: SourceSession[];
  milestones?: Milestone[];
  /** How many recent entries to carry. Recent history is context, not an archive. */
  recentLimit?: number;
}

const byRecency = <T extends { occurredAt?: string; createdAt?: string }>(a: T, b: T) => {
  const at = a.occurredAt ?? a.createdAt ?? '';
  const bt = b.occurredAt ?? b.createdAt ?? '';
  return at < bt ? 1 : at > bt ? -1 : 0;
};

/** Current State: active, and not replaced by anything newer (rule 8). */
const isCurrent = (e: KnowledgeEntry) => e.status === 'active' && e.supersededById === null;

export function assembleMemory(input: MemoryInput): MasterTopicMemory {
  const entries = input.entries ?? [];
  const decisions = input.decisions ?? [];
  const ideas = input.ideas ?? [];
  const actions = input.actions ?? [];
  const current = entries.filter(isCurrent);
  const ofType = (...types: KnowledgeEntry['knowledgeType'][]) =>
    current.filter((e) => types.includes(e.knowledgeType)).sort(byRecency);

  const openActions = actions.filter((a) => a.status !== 'done' && a.status !== 'dropped');

  // Next action is a choice, not a list: the first open next-step by position,
  // which is the order the user arranged them in.
  const nextAction =
    openActions.filter((a) => a.kind === 'next_step').sort((a, b) => a.position - b.position)[0] ?? null;

  const winningPrompts: WinningPrompt[] = (input.prompts ?? [])
    .map(({ prompt, versions, winningVersionId, winningReason }) => {
      if (!winningVersionId) return null;
      const version = versions.find((v) => v.id === winningVersionId);
      if (!version) return null;
      return {
        promptId: prompt.id,
        title: prompt.title,
        versionId: version.id,
        version: version.version,
        body: version.body,
        reason: winningReason ?? null,
      };
    })
    .filter((p): p is WinningPrompt => p !== null);

  const memory: MasterTopicMemory = {
    topic: {
      id: input.topic.id,
      name: input.topic.name,
      purpose: input.topic.description,
      status: input.topic.status,
      progress: input.topic.progress,
    },
    currentObjective: input.topic.goal,
    currentState: input.topic.currentState,

    // Rule 8 in one line, and the same predicate the Timeline filters on.
    activeDecisions: decisions
      .filter((d) => d.status === 'active' && d.supersededById === null)
      .sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1)),

    permanentRules: ofType('important_context'),
    requirements: ofType('requirement'),
    implemented: ofType('implementation', 'added', 'refactored', 'fix'),

    // The avoid-list is why rejected work is never deleted: it is what stops a
    // fresh session re-proposing something already ruled out (rule 9).
    removedOrRejected: avoidList({ entries, decisions, ideas }),

    lessonsLearned: ofType('research', 'change', 'removed'),
    winningPrompts,
    blockers: openActions.filter((a) => a.kind === 'blocker'),
    openQuestions: openActions.filter((a) => a.kind === 'question'),
    remainingWork: openActions.filter((a) => a.kind === 'next_step').sort((a, b) => a.position - b.position),
    nextAction,
    recentHistory: [...entries].sort(byRecency).slice(0, input.recentLimit ?? 10),
    subtopics: input.subtopics ?? [],
    files: input.files ?? [],
    sources: input.sessions ?? [],
    milestones: input.milestones ?? [],
    ideasInFlight: ideas.filter((i) => i.status === 'suggested' || i.status === 'considering' || i.status === 'approved'),
    isEmpty: false,
  };

  memory.isEmpty =
    !memory.currentObjective &&
    !memory.currentState &&
    memory.activeDecisions.length === 0 &&
    memory.recentHistory.length === 0 &&
    memory.remainingWork.length === 0 &&
    memory.winningPrompts.length === 0;

  return memory;
}
