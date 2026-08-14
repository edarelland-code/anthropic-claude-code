/**
 * The Resume context, as structured data.
 *
 * This is the whole reason Phase 4 is not a template string. `assembleResumeContext()`
 * produces one of these; the three destination formatters are pure functions of
 * it and nothing else. They cannot query, cannot re-derive, and therefore
 * cannot disagree about what is true — they differ only in what they show and
 * in what order (ARCHITECTURE §10).
 *
 * Everything here is DERIVED, on every generation, from the authoritative
 * records. Nothing is read back from `context_snapshots`: a past export is an
 * audit record of what was handed to Claude, never an input to the next one.
 * The type enforces it — `assembleResumeContext` takes a `TopicContext` and
 * options, and has no way to reach a snapshot.
 */

import type { AvoidItem } from '../domain/current-state';
import type {
  Action,
  ContextDensity,
  Decision,
  FileReference,
  Idea,
  KnowledgeEntry,
  Milestone,
  Prompt,
  PromptVersion,
  ResumeTarget,
  SourceSession,
  Subtopic,
  Topic,
} from '../domain/types';

/** What the Resume is being generated for. */
export interface ResumeScope {
  topic: Topic;
  /** Null for a whole-topic resume. */
  subtopic: Subtopic | null;
}

/**
 * How current the underlying records are.
 *
 * Never blocks generation. A warning is honest; refusing to resume because the
 * work is old would punish exactly the case the product exists for — coming
 * back to something months later.
 */
export const FRESHNESS_LEVELS = ['fresh', 'few_days', 'stale', 'needs_review'] as const;
export type FreshnessLevel = (typeof FRESHNESS_LEVELS)[number];

export const FRESHNESS_LABELS: Record<FreshnessLevel, string> = {
  fresh: 'Fresh',
  few_days: 'A few days old',
  stale: 'Stale',
  needs_review: 'Needs review',
};

export interface FreshnessStatus {
  level: FreshnessLevel;
  /** Days since the most recent meaningful update in scope. */
  days: number;
  topicUpdatedAt: string;
  subtopicUpdatedAt: string | null;
  /** Most recent session per source, so "what has Claude Code been doing" is answerable. */
  lastChatAt: string | null;
  lastCoworkAt: string | null;
  lastCodeAt: string | null;
  /** A sentence, shown verbatim in the preview and in the generated header. */
  message: string;
}

/**
 * A contradiction ContextShelf can detect deterministically.
 *
 * Reported, never resolved. Auto-resolving would mean the system deciding
 * which of two decisions the user meant, which is exactly the judgement it
 * must not make (rule 17).
 */
export interface ResumeConflict {
  kind:
    | 'contradicting_decisions'
    | 'superseded_without_replacement'
    | 'multiple_primary_actions'
    | 'current_state_references_superseded'
    | 'winning_version_missing';
  summary: string;
  /** The records involved, so the preview can link straight to them. */
  recordIds: string[];
}

/** A change worth telling a fresh session about (Phase 4J). */
export interface MeaningfulChange {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  occurredAt: string;
  /**
   * Never flattened together in output (4T).
   *
   * `proposed` is a third state, not a shade of `historical`. A decision an
   * automated delivery suggested has not been reached and has not been
   * changed — labelling it history would tell a session it was already tried.
   */
  state: 'current' | 'historical' | 'proposed';
}

/** A prompt whose exact winning version is being carried across (4G). */
export interface WinningPromptSection {
  promptId: string;
  title: string;
  purpose: string | null;
  versionId: string;
  version: number;
  body: string;
  result: string | null;
  reason: string | null;
  /** Versions that were tried and did not win. Full Audit only. */
  otherVersions: Array<{ version: number; result: string; notes: string | null }>;
}

/** IF I return to X, THEN do Y (4H). */
export interface ResumeTrigger {
  level: 'topic' | 'subtopic';
  scopeName: string;
  ifText: string | null;
  thenText: string | null;
}

/**
 * The single next thing to do.
 *
 * Derived from recorded Actions, never invented. When nothing is recorded,
 * `primary` is null and the formatters say so plainly rather than proposing a
 * plausible task — a made-up next step presented as stored truth is the most
 * damaging thing this system could output.
 */
export interface NextActionSelection {
  primary: Action | null;
  secondary: Action[];
  /** Why this one was chosen, so the ordering is auditable rather than magic. */
  basis: string | null;
}

/** A file or session the work depends on. */
export interface ResumeReference {
  kind: 'file' | 'session';
  id: string;
  label: string;
  detail: string | null;
  /** Set for sessions: a link back to the verbatim original. */
  href: string | null;
}

/** Repository state, for the Claude Code destination (4V). */
export interface CodeContext {
  repoUrl: string | null;
  branch: string | null;
  commitSha: string | null;
  filesChanged: string[];
  buildStatus: string | null;
  testSummary: string | null;
  /** True when a CLAUDE.md reference exists among the file references. */
  hasArchitectureDoc: boolean;
  architectureDocPath: string | null;
}

/**
 * The assembled context. One object, three formatters.
 *
 * Sections are nullable or empty rather than absent, so a formatter never has
 * to guess whether a section was excluded by density or simply had no records —
 * `sectionsIncluded` records the former explicitly.
 */
export interface ResumeContext {
  scope: ResumeScope;
  target: ResumeTarget;
  density: ContextDensity;
  generatedAt: string;

  objective: string | null;
  currentState: string | null;
  /** Topic-level state, when the scope is a subtopic and both are worth showing. */
  parentCurrentState: string | null;

  nextAction: NextActionSelection;
  activeDecisions: Decision[];
  /** Superseded and rejected, kept separate from active (4T). */
  historicalDecisions: Decision[];
  /**
   * Proposed, and therefore not yet true.
   *
   * A Claude Code delivery can put a decision in front of a person but cannot
   * make one, so `proposed` rows exist that are neither current nor history.
   * They get their own section rather than being folded into either: filed
   * under Active they would be acted on, and filed under History they would
   * read as something already rejected. Both would be wrong in a way that
   * costs the next session real work.
   */
  pendingDecisions: Decision[];
  requirements: KnowledgeEntry[];
  constraints: KnowledgeEntry[];
  completedWork: KnowledgeEntry[];
  recentChanges: MeaningfulChange[];
  winningPrompts: WinningPromptSection[];
  blockers: Action[];
  openQuestions: Action[];
  remainingWork: Action[];
  ideas: Idea[];
  milestones: Milestone[];
  references: ResumeReference[];
  avoid: AvoidItem[];
  triggers: ResumeTrigger[];
  subtopics: Subtopic[];
  code: CodeContext | null;

  freshness: FreshnessStatus;
  conflicts: ResumeConflict[];

  /** Which sections this density admitted, in render order. */
  sectionsIncluded: string[];
  /** Sections a denser setting would have added, so the preview can say what is missing. */
  sectionsOmitted: string[];
  /** True when something was capped rather than dropped, so nothing is silently lost (4O). */
  truncations: Array<{ section: string; shown: number; total: number }>;
}

/** Everything the assembler reads. Deliberately no repository, and no snapshot. */
export interface ResumeInput {
  topic: Topic;
  subtopics: Subtopic[];
  entries: KnowledgeEntry[];
  decisions: Decision[];
  ideas: Idea[];
  actions: Action[];
  files: FileReference[];
  sessions: SourceSession[];
  milestones: Milestone[];
  prompts: Array<{
    prompt: Prompt;
    version: PromptVersion | null;
    versions: PromptVersion[];
    reason: string | null;
  }>;
  /** Ids reachable from the scope through `relationships`, bounded (4M). */
  relatedIds?: Set<string>;
}

export interface ResumeOptions {
  target: ResumeTarget;
  density: ContextDensity;
  /** Null for a whole-topic resume. */
  subtopicId?: string | null;
  /** ISO timestamp. Passed in so assembly stays pure and testable. */
  now: string;
  /** Sections the user switched off in the preview. */
  excludeSections?: string[];
}
