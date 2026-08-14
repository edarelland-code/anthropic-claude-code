/**
 * The selection rules — which records reach a Resume, and in what order.
 *
 * Every function here is pure and deterministic. No scoring, no model, no
 * randomness: the same records and the same options always produce the same
 * context, which is what makes a Resume something a person can learn to trust.
 *
 * These are separated from `assemble.ts` because each one answers a question
 * that is worth being able to test on its own — "what counts as a meaningful
 * change", "which decision contradicts which", "what should be avoided" — and
 * because a single 400-line assembly function is exactly what the brief said
 * not to build.
 */

import { avoidList, type AvoidItem } from '../domain/current-state';
import type {
  Action,
  Decision,
  FileReference,
  Idea,
  KnowledgeEntry,
  SourceSession,
  Subtopic,
  Topic,
} from '../domain/types';

import type {
  CodeContext,
  FreshnessLevel,
  FreshnessStatus,
  MeaningfulChange,
  NextActionSelection,
  ResumeConflict,
  ResumeInput,
  ResumeReference,
  ResumeTrigger,
  WinningPromptSection,
} from './types';

const DAY = 24 * 60 * 60 * 1000;

const daysBetween = (from: string, to: string): number =>
  Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / DAY));

const newestFirst = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

/**
 * How old the work in scope is, from MEANINGFUL activity only.
 *
 * `lastMeaningfulUpdateAt` rather than `updatedAt` (AD-10): renaming a topic
 * yesterday does not make a six-month-old plan current, and a freshness signal
 * that could be fooled by a rename would be worse than none.
 */
export function buildFreshnessStatus(input: {
  topic: Topic;
  subtopic: Subtopic | null;
  sessions: SourceSession[];
  now: string;
}): FreshnessStatus {
  const { topic, subtopic, sessions, now } = input;

  const anchor = subtopic?.lastMeaningfulUpdateAt ?? topic.lastMeaningfulUpdateAt;
  const days = daysBetween(anchor, now);

  const lastOf = (source: SourceSession['sourceType']) =>
    sessions
      .filter((s) => s.sourceType === source)
      .map((s) => s.occurredAt)
      .sort(newestFirst)[0] ?? null;

  // Thresholds chosen once and written down. A week is still the same working
  // context; a month is where a person starts misremembering what was decided;
  // a quarter is where the records need reading before they are trusted.
  const level: FreshnessLevel =
    days <= 2 ? 'fresh' : days <= 7 ? 'few_days' : days <= 30 ? 'stale' : 'needs_review';

  const scopeName = subtopic ? `${topic.name} → ${subtopic.name}` : topic.name;
  const message =
    level === 'fresh'
      ? `${scopeName} was updated ${days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}.`
      : level === 'few_days'
        ? `${scopeName} was last updated ${days} days ago.`
        : level === 'stale'
          ? `${scopeName} has not changed in ${days} days. Check Current State still reflects reality before resuming.`
          : `${scopeName} has not changed in ${days} days. Review Current State and the active decisions before acting on this context.`;

  return {
    level,
    days,
    topicUpdatedAt: topic.lastMeaningfulUpdateAt,
    subtopicUpdatedAt: subtopic?.lastMeaningfulUpdateAt ?? null,
    lastChatAt: lastOf('claude_chat'),
    lastCoworkAt: lastOf('claude_cowork'),
    lastCodeAt: lastOf('claude_code'),
    message,
  };
}

// ---------------------------------------------------------------------------
// Meaningful changes
// ---------------------------------------------------------------------------

/**
 * Knowledge types that represent work happening, rather than work being noted.
 *
 * `progress` and `important_context` are absent deliberately: a Resume has
 * limited room, and "we made progress" displaces a decision or a fix that says
 * what actually changed.
 */
const MEANINGFUL_TYPES = new Set<KnowledgeEntry['knowledgeType']>([
  'decision',
  'implementation',
  'added',
  'removed',
  'refactored',
  'bug',
  'fix',
  'change',
  'milestone',
  'blocker',
  'winning_prompt',
  'requirement',
]);

/**
 * What actually changed, newest first.
 *
 * Not "the last N rows". A Resume filled with quick captures and notes tells a
 * fresh session nothing it can act on, and the Inbox exists precisely so that
 * low-value capture is cheap — which means there is a lot of it.
 *
 * Supersessions count twice over: the replacement is a change, and so is the
 * fact that something was replaced. Both are emitted, labelled `current` and
 * `historical`, so the reader can see the direction of travel.
 */
export function buildRecentMeaningfulChanges(input: {
  entries: KnowledgeEntry[];
  decisions: Decision[];
  limit: number;
}): MeaningfulChange[] {
  const out: MeaningfulChange[] = [];

  for (const e of input.entries) {
    if (!MEANINGFUL_TYPES.has(e.knowledgeType)) continue;
    out.push({
      id: e.id,
      kind: e.knowledgeType,
      title: e.title,
      detail: e.content,
      occurredAt: e.occurredAt,
      state: e.status === 'active' && e.supersededById === null ? 'current' : 'historical',
    });
  }

  for (const d of input.decisions) {
    const superseded = d.supersededById !== null;
    out.push({
      id: d.id,
      kind: superseded ? 'decision_superseded' : 'decision',
      title: d.title,
      detail: superseded ? (d.supersedeReason ?? d.reason) : (d.reason ?? d.decision),
      occurredAt: d.decidedAt,
      state: d.status === 'active' && !superseded ? 'current' : 'historical',
    });
  }

  return out
    .sort((a, b) => {
      const byTime = newestFirst(a.occurredAt, b.occurredAt);
      // A total order: two records stamped in the same transaction share a
      // timestamp, and without the id tiebreak the same query could produce a
      // different Resume on a second run.
      return byTime !== 0 ? byTime : a.id < b.id ? -1 : 1;
    })
    .slice(0, input.limit);
}

// ---------------------------------------------------------------------------
// Avoid list
// ---------------------------------------------------------------------------

const AVOID_PRIORITY: Record<AvoidItem['kind'], number> = {
  superseded_decision: 0,
  rejected_idea: 1,
  rejected_entry: 2,
  superseded_entry: 3,
};

/**
 * What not to repeat, ranked.
 *
 * Delegates to the same `avoidList()` Master Topic Memory uses — two
 * derivations of "what was ruled out" would eventually disagree, and the one a
 * fresh Claude session sees is the one that matters.
 *
 * The ranking exists because Compact has room for five. A superseded decision
 * comes first: it explains why the current direction exists, so it prevents the
 * most expensive mistake — re-litigating something already settled. An item
 * with a recorded reason outranks one without, because "do not do X" without a
 * why invites a fresh session to work out the why for itself, which means
 * trying X.
 *
 * Items with neither a reason nor a rejection are dropped rather than padded
 * in: an avoid entry that cannot say why is noise, and noise in this section is
 * what makes people stop reading it.
 */
export function buildAvoidList(input: {
  entries: KnowledgeEntry[];
  decisions: Decision[];
  ideas: Idea[];
  limit: number;
}): AvoidItem[] {
  return avoidList({ entries: input.entries, decisions: input.decisions, ideas: input.ideas })
    .filter((item) => item.title.trim() !== '')
    .sort((a, b) => {
      const byKind = AVOID_PRIORITY[a.kind] - AVOID_PRIORITY[b.kind];
      if (byKind !== 0) return byKind;
      const aHas = a.reason !== null && a.reason.trim() !== '';
      const bHas = b.reason !== null && b.reason.trim() !== '';
      if (aHas !== bHas) return aHas ? -1 : 1;
      return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
    })
    .slice(0, input.limit);
}

// ---------------------------------------------------------------------------
// Next action
// ---------------------------------------------------------------------------

const ACTION_OPEN = new Set<Action['status']>(['open', 'in_progress', 'blocked']);

/**
 * The single next thing to do — derived, never invented.
 *
 * Order of preference, and each step is a fact rather than a guess:
 *   1. Something already in progress. Finishing beats starting.
 *   2. The first open next step by the position the user arranged them in.
 *   3. Nothing.
 *
 * Blockers are deliberately NOT promoted to primary. A blocker says work is
 * stopped, not what to do about it; presenting "waiting on brand sign-off" as
 * the immediate next action would tell a fresh session to do nothing. They are
 * carried in their own section instead.
 *
 * When nothing is recorded, `primary` is null and stays null. Inferring a
 * plausible task from Current State and presenting it as stored truth is the
 * single most damaging thing this system could do, because it would be
 * indistinguishable from a real one.
 */
export function selectImmediateNextAction(actions: Action[]): NextActionSelection {
  const open = actions.filter((a) => ACTION_OPEN.has(a.status) && a.kind === 'next_step');

  const byPosition = [...open].sort((a, b) =>
    a.position !== b.position ? a.position - b.position : a.createdAt < b.createdAt ? -1 : 1,
  );

  const inProgress = byPosition.find((a) => a.status === 'in_progress') ?? null;
  const primary = inProgress ?? byPosition[0] ?? null;

  return {
    primary,
    secondary: byPosition.filter((a) => a.id !== primary?.id),
    basis:
      primary === null
        ? null
        : inProgress
          ? 'already in progress'
          : 'first open next step, in the order you arranged them',
  };
}

// ---------------------------------------------------------------------------
// Winning prompts
// ---------------------------------------------------------------------------

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3),
  );

/**
 * Winning prompts, resolved to the exact version that won.
 *
 * `relatedTo` drives the Compact rule (4G): at that density a prompt earns its
 * place only when it materially helps the immediate next task, which is decided
 * by term overlap with the next action's title — deterministic, and cheap to
 * verify by reading both strings. At Standard and Full Audit every winner is
 * included and the filter is skipped.
 */
export function buildWinningPromptSection(input: {
  prompts: ResumeInput['prompts'];
  /** When set, keep only prompts whose title or purpose overlaps this text. */
  relatedTo?: string | null;
  includeOtherVersions: boolean;
  limit: number;
}): WinningPromptSection[] {
  const target = input.relatedTo ? words(input.relatedTo) : null;

  return input.prompts
    .filter((p) => p.version !== null)
    .filter((p) => {
      if (!target || target.size === 0) return true;
      const haystack = words(`${p.prompt.title} ${p.prompt.purpose ?? ''}`);
      for (const w of target) if (haystack.has(w)) return true;
      return false;
    })
    .map((p) => ({
      promptId: p.prompt.id,
      title: p.prompt.title,
      purpose: p.prompt.purpose,
      versionId: p.version!.id,
      version: p.version!.version,
      body: p.version!.body,
      result: p.version!.result,
      reason: p.reason,
      otherVersions: input.includeOtherVersions
        ? p.versions
            .filter((v) => v.id !== p.version!.id)
            .map((v) => ({ version: v.version, result: v.result, notes: v.notes }))
        : [],
    }))
    .slice(0, input.limit);
}

// ---------------------------------------------------------------------------
// Conflicts
// ---------------------------------------------------------------------------

const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Contradictions ContextShelf can see without interpreting anything.
 *
 * Reported and never resolved. Choosing between two active decisions is a
 * judgement about intent, and a system that made it silently would be deciding
 * what the user meant — the same line rule 17 draws for duplicates.
 *
 * A Resume still generates. Refusing to export because the records disagree
 * would leave the user with nothing at the moment they most need context; a
 * warning at the top of the document is both honest and useful, because a fresh
 * Claude session can be told to ask rather than pick.
 */
export function detectResumeConflicts(input: {
  topic: Topic;
  subtopic: Subtopic | null;
  decisions: Decision[];
  actions: Action[];
  prompts: ResumeInput['prompts'];
}): ResumeConflict[] {
  const out: ResumeConflict[] = [];

  const active = input.decisions.filter((d) => d.status === 'active' && d.supersededById === null);

  // Two active decisions with the same title cannot both be the direction.
  const byTitle = new Map<string, Decision[]>();
  for (const d of active) {
    const key = normalise(d.title);
    byTitle.set(key, [...(byTitle.get(key) ?? []), d]);
  }
  for (const [, group] of byTitle) {
    if (group.length < 2) continue;
    out.push({
      kind: 'contradicting_decisions',
      summary: `“${group[0]!.title}” exists as ${group.length} separate active decisions. Only one can be the current direction.`,
      recordIds: group.map((d) => d.id),
    });
  }

  // A decision marked superseded with nothing to point at leaves a hole: the
  // reader is told the old direction is dead but not what replaced it.
  for (const d of input.decisions) {
    if (d.status === 'superseded' && d.supersededById === null) {
      out.push({
        kind: 'superseded_without_replacement',
        summary: `“${d.title}” is marked superseded but names no replacement, so the current direction is unstated.`,
        recordIds: [d.id],
      });
    }
  }

  // Several next steps in progress at once — a fresh session cannot tell which
  // one it is continuing.
  const inProgress = input.actions.filter((a) => a.kind === 'next_step' && a.status === 'in_progress');
  if (inProgress.length > 1) {
    out.push({
      kind: 'multiple_primary_actions',
      summary: `${inProgress.length} next steps are marked in progress. Only the first will be offered as the immediate next action.`,
      recordIds: inProgress.map((a) => a.id),
    });
  }

  // A winning selection pointing at a version that is no longer present.
  for (const p of input.prompts) {
    if (p.version === null) {
      out.push({
        kind: 'winning_version_missing',
        summary: `“${p.prompt.title}” has a winning selection whose version is no longer available, so no prompt body can be carried across.`,
        recordIds: [p.prompt.id],
      });
    }
  }

  // Current State still naming something that was superseded or rejected.
  const state = normalise(
    `${input.topic.currentState ?? ''} ${input.subtopic?.currentState ?? ''}`,
  );
  if (state) {
    for (const d of input.decisions) {
      if (d.status === 'active' && d.supersededById === null) continue;
      const title = normalise(d.title);
      if (title.length >= 8 && state.includes(title)) {
        out.push({
          kind: 'current_state_references_superseded',
          summary: `Current State still refers to “${d.title}”, which is ${d.status}. It may describe a direction that has been replaced.`,
          recordIds: [d.id],
        });
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// References and code context
// ---------------------------------------------------------------------------

export function buildReferences(input: {
  files: FileReference[];
  sessions: SourceSession[];
  limit: number;
}): ResumeReference[] {
  const files: ResumeReference[] = input.files.map((f) => ({
    kind: 'file',
    id: f.id,
    label: f.displayName ?? f.path ?? f.url ?? 'Untitled file',
    detail: f.repoUrl ? `${f.repoUrl}${f.branch ? ` · ${f.branch}` : ''}` : (f.url ?? f.path),
    href: f.url,
  }));

  const sessions: ResumeReference[] = [...input.sessions]
    .sort((a, b) => newestFirst(a.occurredAt, b.occurredAt))
    .map((s) => ({
      kind: 'session',
      id: s.id,
      label: s.title ?? 'Source session',
      detail: s.summary,
      // Provenance rather than payload: the transcript is linked, never pasted
      // into the prompt. A Resume that inlined raw sessions would be the
      // "dump the database into a prompt" failure the brief rules out.
      href: `/sources/${s.id}`,
    }));

  return [...files, ...sessions].slice(0, input.limit);
}

/** Repository state for the Claude Code destination, from the newest code session. */
export function buildCodeContext(input: {
  sessions: SourceSession[];
  files: FileReference[];
}): CodeContext | null {
  const codeSessions = input.sessions
    .filter((s) => s.sourceType === 'claude_code' || s.repoUrl !== null || s.commitSha !== null)
    .sort((a, b) => newestFirst(a.occurredAt, b.occurredAt));

  const architectureDoc =
    input.files.find((f) => /(^|\/)CLAUDE\.md$/i.test(f.path ?? '')) ??
    input.files.find((f) => /(^|\/)(ARCHITECTURE|SCHEMA)\.md$/i.test(f.path ?? '')) ??
    null;

  const latest = codeSessions[0];
  if (!latest && !architectureDoc) return null;

  const repoFile = input.files.find((f) => f.repoUrl !== null) ?? null;

  return {
    repoUrl: latest?.repoUrl ?? repoFile?.repoUrl ?? null,
    branch: latest?.branch ?? repoFile?.branch ?? null,
    commitSha: latest?.commitSha ?? repoFile?.commitSha ?? null,
    filesChanged: latest?.filesChanged ?? [],
    buildStatus: latest?.buildStatus ?? null,
    testSummary: latest?.testSummary ?? null,
    hasArchitectureDoc: architectureDoc !== null,
    architectureDocPath: architectureDoc?.path ?? null,
  };
}

// ---------------------------------------------------------------------------
// Resume triggers
// ---------------------------------------------------------------------------

/** Subtopic trigger first when resuming a subtopic — it is the more specific instruction. */
export function buildTriggers(input: { topic: Topic; subtopic: Subtopic | null }): ResumeTrigger[] {
  const out: ResumeTrigger[] = [];
  const has = (a: string | null, b: string | null) => Boolean(a?.trim() || b?.trim());

  if (input.subtopic && has(input.subtopic.resumeTriggerIf, input.subtopic.resumeTriggerThen)) {
    out.push({
      level: 'subtopic',
      scopeName: input.subtopic.name,
      ifText: input.subtopic.resumeTriggerIf,
      thenText: input.subtopic.resumeTriggerThen,
    });
  }
  if (has(input.topic.resumeTriggerIf, input.topic.resumeTriggerThen)) {
    out.push({
      level: 'topic',
      scopeName: input.topic.name,
      ifText: input.topic.resumeTriggerIf,
      thenText: input.topic.resumeTriggerThen,
    });
  }
  return out;
}
