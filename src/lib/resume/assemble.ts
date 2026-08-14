/**
 * The Resume assembler (ARCHITECTURE §10, CLAUDE.md rule 22).
 *
 * Pure: `(ResumeInput, ResumeOptions) => ResumeContext`. It reaches for no
 * database, no clock and no network — `now` is passed in — so the guarantees
 * that matter are testable without any of them:
 *
 *   * a superseded record never appears as current
 *   * a rejected direction always reaches the avoid list
 *   * the winning prompt is the version that won, not the newest
 *   * a next action is never invented when none is recorded
 *
 * It is an EXPORT of current truth, not a memory of its own. There is no
 * parameter through which a previous `context_snapshots` row could reach it,
 * which is what keeps Resume History an audit record rather than a second
 * source (the user's rule, and AD-8).
 */

import type { Action, Decision, Idea, KnowledgeEntry, Subtopic } from '../domain/types';

import {
  buildAvoidList,
  buildCodeContext,
  buildFreshnessStatus,
  buildRecentMeaningfulChanges,
  buildReferences,
  buildTriggers,
  buildWinningPromptSection,
  detectResumeConflicts,
  selectImmediateNextAction,
} from './select';
import type { ResumeContext, ResumeInput, ResumeOptions } from './types';

/**
 * How much of each section a density admits.
 *
 * One table rather than conditionals scattered through the assembly, so
 * "what does Compact include" is answerable by reading eleven lines instead of
 * tracing a function.
 */
const CAPS = {
  compact: {
    decisions: 5,
    // Requirements need their own cap, not just constraints. A mature topic
    // accumulates dozens of them, and an uncapped section turned a "compact"
    // export into 3,800 tokens on the large fixture — four times its intent,
    // which would have made the density a label rather than a guarantee.
    requirements: 5,
    blockers: 5,
    constraints: 3,
    avoid: 5,
    changes: 3,
    secondaryActions: 0,
    prompts: 1,
    references: 0,
    completed: 0,
    ideas: 0,
    milestones: 0,
    promptsRelatedOnly: true,
    includeHistoricalDecisions: false,
    includeOtherVersions: false,
  },
  standard: {
    decisions: Number.POSITIVE_INFINITY,
    requirements: 20,
    blockers: Number.POSITIVE_INFINITY,
    constraints: Number.POSITIVE_INFINITY,
    avoid: 10,
    changes: 10,
    secondaryActions: 4,
    prompts: 5,
    references: 12,
    completed: 8,
    ideas: 5,
    milestones: 0,
    promptsRelatedOnly: false,
    includeHistoricalDecisions: false,
    includeOtherVersions: false,
  },
  full_audit: {
    decisions: Number.POSITIVE_INFINITY,
    requirements: Number.POSITIVE_INFINITY,
    blockers: Number.POSITIVE_INFINITY,
    constraints: Number.POSITIVE_INFINITY,
    avoid: Number.POSITIVE_INFINITY,
    changes: 50,
    secondaryActions: Number.POSITIVE_INFINITY,
    prompts: Number.POSITIVE_INFINITY,
    references: Number.POSITIVE_INFINITY,
    completed: Number.POSITIVE_INFINITY,
    ideas: Number.POSITIVE_INFINITY,
    milestones: Number.POSITIVE_INFINITY,
    promptsRelatedOnly: false,
    includeHistoricalDecisions: true,
    includeOtherVersions: true,
  },
} as const;

/** Render order. A section absent from a density never appears in the output. */
const SECTION_ORDER = [
  'objective',
  'currentState',
  'nextAction',
  'activeDecisions',
  'requirements',
  'completedWork',
  'recentChanges',
  'winningPrompts',
  'blockers',
  'openQuestions',
  'ideas',
  'milestones',
  'references',
  'historicalDecisions',
  'avoid',
  'triggers',
] as const;

const DENSITY_SECTIONS: Record<ResumeOptions['density'], readonly string[]> = {
  compact: [
    'objective',
    'currentState',
    'nextAction',
    'activeDecisions',
    'requirements',
    'recentChanges',
    'winningPrompts',
    'blockers',
    'avoid',
    'triggers',
  ],
  standard: [
    'objective',
    'currentState',
    'nextAction',
    'activeDecisions',
    'requirements',
    'completedWork',
    'recentChanges',
    'winningPrompts',
    'blockers',
    'openQuestions',
    'ideas',
    'references',
    'avoid',
    'triggers',
  ],
  full_audit: [...SECTION_ORDER],
};

const isCurrentEntry = (e: KnowledgeEntry) => e.status === 'active' && e.supersededById === null;
const openAction = (a: Action) => a.status !== 'done' && a.status !== 'dropped';

/**
 * Restricts the records to the requested scope.
 *
 * A subtopic Resume is not simply "the subtopic's rows". Work inside a subtopic
 * is still governed by the topic's goal, its permanent rules and any decision
 * taken project-wide, and a fresh session that never saw those would
 * cheerfully violate them. So subtopic scope keeps:
 *
 *   * everything tagged to the subtopic
 *   * topic-level requirements and important context — the constraints
 *   * decisions with no subtopic of their own — those are project-wide
 *   * anything reachable through a relationship edge from the scope (4M)
 *
 * Sibling subtopics are excluded unless a relationship connects them, which is
 * what stops a Resume for the app icon carrying the billing work.
 */
function inScope<T extends { subtopicId?: string | null; id: string }>(
  rows: T[],
  subtopicId: string | null,
  relatedIds: Set<string> | undefined,
  keepUnscoped: boolean,
): T[] {
  if (!subtopicId) return rows;
  return rows.filter((r) => {
    if (r.subtopicId === subtopicId) return true;
    if (relatedIds?.has(r.id)) return true;
    return keepUnscoped && (r.subtopicId === null || r.subtopicId === undefined);
  });
}

function entriesInScope(
  entries: KnowledgeEntry[],
  subtopicId: string | null,
  relatedIds: Set<string> | undefined,
): KnowledgeEntry[] {
  if (!subtopicId) return entries;
  return entries.filter(
    (e) =>
      e.subtopicIds.includes(subtopicId) ||
      relatedIds?.has(e.id) ||
      // Topic-level rules bind the subtopic too.
      ((e.knowledgeType === 'requirement' || e.knowledgeType === 'important_context') &&
        e.subtopicIds.length === 0),
  );
}

export function assembleResumeContext(
  input: ResumeInput,
  options: ResumeOptions,
): ResumeContext {
  const caps = CAPS[options.density];
  const subtopic: Subtopic | null =
    input.subtopics.find((s) => s.id === options.subtopicId) ?? null;
  const subtopicId = subtopic?.id ?? null;

  const entries = entriesInScope(input.entries, subtopicId, input.relatedIds);
  const decisions = inScope<Decision>(input.decisions, subtopicId, input.relatedIds, true);
  const ideas = inScope<Idea>(input.ideas, subtopicId, input.relatedIds, false);
  const actions = inScope<Action>(input.actions, subtopicId, input.relatedIds, false);

  const current = entries.filter(isCurrentEntry);
  const ofType = (...types: KnowledgeEntry['knowledgeType'][]) =>
    current
      .filter((e) => types.includes(e.knowledgeType))
      .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));

  const activeDecisions = decisions
    .filter((d) => d.status === 'active' && d.supersededById === null)
    .sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1))
    .slice(0, caps.decisions);

  const historicalDecisions = caps.includeHistoricalDecisions
    ? decisions
        .filter((d) => !(d.status === 'active' && d.supersededById === null))
        .sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1))
    : [];

  const open = actions.filter(openAction);
  const nextAction = selectImmediateNextAction(open);

  const winningPrompts = buildWinningPromptSection({
    prompts: input.prompts,
    relatedTo: caps.promptsRelatedOnly ? (nextAction.primary?.title ?? null) : null,
    includeOtherVersions: caps.includeOtherVersions,
    limit: caps.prompts,
  });

  const freshness = buildFreshnessStatus({
    topic: input.topic,
    subtopic,
    sessions: input.sessions,
    now: options.now,
  });

  // Compact skips the conflict scan: it is a fast continuation, and a warning
  // it has no room to explain is worse than none. Standard and Full Audit run
  // it, as specified.
  const conflicts =
    options.density === 'compact'
      ? []
      : detectResumeConflicts({
          topic: input.topic,
          subtopic,
          decisions,
          actions: open,
          prompts: input.prompts,
        });

  const allRequirements = ofType('requirement');
  const requirements = allRequirements.slice(0, caps.requirements);
  const constraints = ofType('important_context').slice(0, caps.constraints);
  const completedWork = ofType('implementation', 'added', 'refactored', 'fix').slice(
    0,
    caps.completed,
  );

  const recentChanges = buildRecentMeaningfulChanges({
    entries,
    decisions,
    limit: caps.changes,
  });

  const avoid = buildAvoidList({ entries, decisions, ideas, limit: caps.avoid });

  const references =
    caps.references > 0
      ? buildReferences({
          files: inScope(input.files, subtopicId, input.relatedIds, false),
          sessions: input.sessions,
          limit: caps.references,
        })
      : [];

  const excluded = new Set(options.excludeSections ?? []);
  const sectionsIncluded = DENSITY_SECTIONS[options.density].filter((s) => !excluded.has(s));
  const sectionsOmitted = SECTION_ORDER.filter((s) => !sectionsIncluded.includes(s));

  // Anything capped is recorded rather than quietly dropped, so the preview can
  // say what is not shown and offer a denser setting (4O).
  const truncations: ResumeContext['truncations'] = [];
  const note = (section: string, shown: number, total: number) => {
    if (total > shown) truncations.push({ section, shown, total });
  };
  note('activeDecisions', activeDecisions.length, decisions.filter((d) => d.status === 'active' && d.supersededById === null).length);
  note('avoid', avoid.length, buildAvoidList({ entries, decisions, ideas, limit: Number.POSITIVE_INFINITY }).length);
  note('recentChanges', recentChanges.length, buildRecentMeaningfulChanges({ entries, decisions, limit: Number.POSITIVE_INFINITY }).length);
  note('winningPrompts', winningPrompts.length, input.prompts.filter((p) => p.version !== null).length);
  note('completedWork', completedWork.length, ofType('implementation', 'added', 'refactored', 'fix').length);
  note('requirements', requirements.length, allRequirements.length);
  note('blockers', Math.min(caps.blockers, open.filter((a) => a.kind === 'blocker').length), open.filter((a) => a.kind === 'blocker').length);

  return {
    scope: { topic: input.topic, subtopic },
    target: options.target,
    density: options.density,
    generatedAt: options.now,

    objective: subtopic?.goal ?? input.topic.goal,
    currentState: subtopic?.currentState ?? input.topic.currentState,
    // Both states are shown for a subtopic resume, because the topic's state is
    // often what explains why the subtopic's state is where it is.
    parentCurrentState: subtopic ? input.topic.currentState : null,

    nextAction: {
      primary: nextAction.primary,
      secondary: nextAction.secondary.slice(0, caps.secondaryActions),
      basis: nextAction.basis,
    },
    activeDecisions,
    historicalDecisions,
    requirements,
    constraints,
    completedWork,
    recentChanges,
    winningPrompts,
    blockers: open.filter((a) => a.kind === 'blocker').slice(0, caps.blockers),
    openQuestions: open.filter((a) => a.kind === 'question'),
    remainingWork: open
      .filter((a) => a.kind === 'next_step')
      .sort((a, b) => a.position - b.position),
    ideas:
      caps.ideas > 0
        ? ideas
            .filter((i) => i.status !== 'rejected' && i.status !== 'deferred')
            .slice(0, caps.ideas)
        : [],
    milestones: caps.milestones > 0 ? input.milestones : [],
    references,
    avoid,
    triggers: buildTriggers({ topic: input.topic, subtopic }),
    subtopics: subtopic ? [] : input.subtopics,
    code: options.target === 'claude_code'
      ? buildCodeContext({ sessions: input.sessions, files: input.files })
      : null,

    freshness,
    conflicts,
    sectionsIncluded,
    sectionsOmitted,
    truncations,
  };
}
