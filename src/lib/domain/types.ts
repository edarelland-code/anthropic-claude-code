/**
 * Hand-written, vendor-neutral domain model.
 *
 * CLAUDE.md rule 19: these types are NOT generated from the database vendor.
 * Generated types are an adapter implementation detail. Everything in `app/`
 * and `components/` speaks this vocabulary and nothing else.
 */

export const SOURCE_TYPES = [
  'claude_chat',
  'claude_cowork',
  'claude_code',
  'manual',
  'file',
  'url',
  'imported_transcript',
  'api',
  'mcp',
  'browser_extension',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const KNOWLEDGE_TYPES = [
  'progress',
  'implementation',
  'decision',
  'idea',
  'suggestion',
  'prompt',
  'winning_prompt',
  'failed_prompt',
  'requirement',
  'change',
  'added',
  'removed',
  'refactored',
  'bug',
  'fix',
  'research',
  'file',
  'link',
  'blocker',
  'question',
  'next_step',
  'milestone',
  'rejected_idea',
  'important_context',
] as const;
export type KnowledgeType = (typeof KNOWLEDGE_TYPES)[number];

export const ENTRY_STATUSES = [
  'active',
  'superseded',
  'rejected',
  'replaced',
  'deprecated',
  'archived',
] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

export const TOPIC_STATUSES = ['active', 'paused', 'blocked', 'completed', 'archived'] as const;
export type TopicStatus = (typeof TOPIC_STATUSES)[number];

export const IDEA_STATUSES = [
  'suggested',
  'considering',
  'approved',
  'implemented',
  'deferred',
  'rejected',
] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

/**
 * `reversed` is a legacy value kept so existing rows stay readable; new writes
 * use `rejected` for a direction that was turned down. `superseded` means
 * something newer replaced it, which is a different fact and must not be
 * conflated with rejection — the avoid-list depends on telling them apart.
 */
export const DECISION_STATUSES = [
  'proposed',
  'active',
  'superseded',
  'rejected',
  'deprecated',
  'archived',
  'reversed',
] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

/** The statuses a user can choose. `superseded` is only ever set by superseding. */
export const SELECTABLE_DECISION_STATUSES = [
  'proposed',
  'active',
  'rejected',
  'deprecated',
  'archived',
] as const satisfies readonly DecisionStatus[];

export const PROMPT_RESULTS = [
  'untested',
  'worked',
  'partially_worked',
  'failed',
  'superseded',
] as const;
export type PromptResult = (typeof PROMPT_RESULTS)[number];

export const ACTION_KINDS = ['next_step', 'blocker', 'question'] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export const ACTION_STATUSES = ['open', 'in_progress', 'blocked', 'done', 'dropped'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const CONTEXT_DENSITIES = ['compact', 'standard', 'full_audit'] as const;
export type ContextDensity = (typeof CONTEXT_DENSITIES)[number];

export const RESUME_TARGETS = ['claude_chat', 'claude_cowork', 'claude_code'] as const;
export type ResumeTarget = (typeof RESUME_TARGETS)[number];

/**
 * `discarded` is a legacy value kept so existing rows stay readable, exactly as
 * `reversed` is on DecisionStatus. New writes use `archived`, which files an
 * item away without implying the capture was worthless.
 */
export const INGESTION_STATUSES = [
  'unsorted',
  'needs_review',
  'classified',
  'partially_processed',
  'processed',
  'archived',
  'failed',
  'discarded',
] as const;
export type IngestionStatus = (typeof INGESTION_STATUSES)[number];

/** How each Inbox state reads to a person, and what it is waiting for. */
export const INGESTION_STATUS_LABELS: Record<IngestionStatus, string> = {
  unsorted: 'New',
  needs_review: 'Needs review',
  classified: 'Categorized',
  partially_processed: 'Partly processed',
  processed: 'Processed',
  archived: 'Archived',
  failed: 'Failed',
  discarded: 'Discarded',
};

/** The states an item is still waiting on a person for. */
export const OPEN_INGESTION_STATUSES = [
  'unsorted',
  'needs_review',
  'classified',
  'partially_processed',
] as const satisfies readonly IngestionStatus[];

export const ENTITY_TYPES = [
  'topic',
  'subtopic',
  'knowledge_entry',
  'decision',
  'idea',
  'prompt',
  'prompt_version',
  'file_reference',
  'action',
  'milestone',
  'source_session',
  'ingestion_record',
  'context_snapshot',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/**
 * The record types a user may delete.
 *
 * Mirrors the allowlist inside `soft_delete_record()` (migration 0004 §6). The
 * database is authoritative — it refuses anything outside its own CASE — and
 * this list exists so the UI never offers a Delete button that is going to
 * raise. Append-only history, Layer 1 evidence, inbox records and derived
 * snapshots are absent on purpose.
 */
export const DELETABLE_ENTITY_TYPES = [
  'topic',
  'subtopic',
  'knowledge_entry',
  'decision',
  'idea',
  'prompt',
  'file_reference',
  'action',
  'milestone',
] as const satisfies readonly EntityType[];
export type DeletableEntityType = (typeof DELETABLE_ENTITY_TYPES)[number];

export function isDeletable(t: EntityType): t is DeletableEntityType {
  return (DELETABLE_ENTITY_TYPES as readonly EntityType[]).includes(t);
}

export const RELATIONSHIP_TYPES = [
  'produced',
  'resulted_in',
  'supersedes',
  'resolves',
  'caused',
  'belongs_to',
  'relates_to',
  'duplicates',
  'contradicts',
  'implements',
  'derived_from',
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface Workspace {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface Topic {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description: string | null;
  goal: string | null;
  currentState: string | null;
  status: TopicStatus;
  progress: number;
  pinned: boolean;
  resumeTriggerIf: string | null;
  resumeTriggerThen: string | null;
  /** Deliberately distinct from updatedAt — a rename is not progress. */
  lastMeaningfulUpdateAt: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Subtopic {
  id: string;
  workspaceId: string;
  topicId: string;
  parentSubtopicId: string | null;
  name: string;
  slug: string;
  description: string | null;
  goal: string | null;
  currentState: string | null;
  status: TopicStatus;
  position: number;
  resumeTriggerIf: string | null;
  resumeTriggerThen: string | null;
  lastMeaningfulUpdateAt: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Layer 1: verbatim evidence. Written once, never edited. */
export interface SourceSession {
  id: string;
  workspaceId: string;
  topicId: string | null;
  sourceType: SourceType;
  title: string | null;
  externalUrl: string | null;
  occurredAt: string;
  summary: string | null;
  rawContent: string | null;
  repoUrl: string | null;
  branch: string | null;
  commitSha: string | null;
  filesChanged: string[];
  filesAdded: string[];
  filesRemoved: string[];
  buildStatus: string | null;
  testSummary: string | null;
  createdAt: string;
}

/** Layer 2: the typed, statused, queryable knowledge atom. */
export interface KnowledgeEntry {
  id: string;
  workspaceId: string;
  topicId: string;
  subtopicIds: string[];
  knowledgeType: KnowledgeType;
  status: EntryStatus;
  title: string;
  content: string | null;
  sourceType: SourceType;
  sourceSessionId: string | null;
  sourceReference: string | null;
  occurredAt: string;
  supersededById: string | null;
  supersedesReason: string | null;
  importance: number;
  createdAt: string;
  updatedAt: string;
}

export interface Decision {
  id: string;
  workspaceId: string;
  topicId: string;
  subtopicId: string | null;
  title: string;
  decision: string;
  reason: string | null;
  alternatives: string[];
  approvedDirection: string | null;
  status: DecisionStatus;
  decidedAt: string;
  supersededById: string | null;
  supersedeReason: string | null;
  sourceType: SourceType;
  sourceSessionId: string | null;
}

export interface Idea {
  id: string;
  workspaceId: string;
  topicId: string;
  subtopicId: string | null;
  title: string;
  idea: string | null;
  rationale: string | null;
  status: IdeaStatus;
  decisionId: string | null;
  implementationEntryId: string | null;
  sourceType: SourceType;
  sourceSessionId: string | null;
  createdAt: string;
}

export interface Prompt {
  id: string;
  workspaceId: string;
  topicId: string;
  subtopicId: string | null;
  title: string;
  purpose: string | null;
  sourceType: SourceType;
  currentVersionId: string | null;
  isWinning: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PromptVersion {
  id: string;
  promptId: string;
  version: number;
  body: string;
  result: PromptResult;
  rating: number | null;
  notes: string | null;
  outputSummary: string | null;
  createdAt: string;
}

export interface FileReference {
  id: string;
  workspaceId: string;
  topicId: string;
  subtopicId: string | null;
  kind: 'repo_file' | 'upload' | 'url';
  path: string | null;
  displayName: string | null;
  url: string | null;
  repoUrl: string | null;
  branch: string | null;
  commitSha: string | null;
  createdAt: string;
}

export interface Action {
  id: string;
  workspaceId: string;
  topicId: string;
  subtopicId: string | null;
  kind: ActionKind;
  status: ActionStatus;
  title: string;
  detail: string | null;
  position: number;
  resolvedAt: string | null;
  createdAt: string;
}

export interface Milestone {
  id: string;
  workspaceId: string;
  topicId: string;
  title: string;
  detail: string | null;
  achievedAt: string | null;
  status: 'planned' | 'achieved' | 'missed' | 'dropped';
}

export interface Relationship {
  id: string;
  workspaceId: string;
  fromType: EntityType;
  fromId: string;
  relationshipType: RelationshipType;
  toType: EntityType;
  toId: string;
  note: string | null;
  createdAt: string;
}

export interface IngestionRecord {
  id: string;
  workspaceId: string;
  adapterId: string | null;
  sourceType: SourceType;
  contentType: string;
  rawContent: string | null;
  sourceHint: string | null;
  suggestedTopicId: string | null;
  topicId: string | null;
  subtopicId: string | null;
  status: IngestionStatus;
  error: string | null;
  /** Layer 1 written by this import, if it produced one. */
  createdSourceSessionId: string | null;
  createdEntryIds: string[];
  createdAt: string;
  processedAt: string | null;
}

/** Counts shown on a Topic card. */
export interface TopicCounts {
  subtopics: number;
  entries: number;
  sessions: number;
  prompts: number;
  decisions: number;
  ideas: number;
  files: number;
  openActions: number;
}

export interface TopicSummary {
  topic: Topic;
  counts: TopicCounts;
  /** Distinct source types that have contributed — drives the source badges. */
  sourceTypes: SourceType[];
  latestChange: Pick<KnowledgeEntry, 'id' | 'title' | 'knowledgeType' | 'occurredAt'> | null;
  nextAction: Pick<Action, 'id' | 'title' | 'kind'> | null;
}

/** Everything the Topic page and the Resume assembler need, in one read. */
export interface TopicContext {
  topic: Topic;
  subtopics: Subtopic[];
  counts: TopicCounts;
  /** status = 'active' AND supersededById = null — Current State (ARCHITECTURE §8). */
  currentEntries: KnowledgeEntry[];
  /** Everything, in chronological order — History. */
  timeline: KnowledgeEntry[];
  activeDecisions: Decision[];
  supersededDecisions: Decision[];
  rejectedIdeas: Idea[];
  openActions: Action[];
  winningPrompts: Array<{ prompt: Prompt; version: PromptVersion | null }>;
  files: FileReference[];
  milestones: Milestone[];
  sessions: SourceSession[];
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/**
 * One row of the unified Timeline.
 *
 * Read from the `timeline_events` view, which projects every record type into
 * this shape. It is derived and holds nothing of its own — the underlying row
 * is always authoritative, and `entityType` + `id` locate it.
 */
export interface TimelineEvent {
  id: string;
  workspaceId: string;
  topicId: string;
  /** An entry can sit under several subtopics; typed records carry at most one. */
  subtopicIds: string[];
  entityType: EntityType;
  /** knowledge_type, action kind, file kind, or a literal like 'decision'. */
  kind: string;
  title: string;
  summary: string | null;
  sourceType: SourceType | null;
  status: string | null;
  supersededById: string | null;
  occurredAt: string;
  createdAt: string;
}

/** Filters the Timeline page and the Topic page timeline both use. */
export interface TimelineQuery {
  workspaceId?: string;
  topicId?: string;
  subtopicId?: string;
  entityTypes?: EntityType[];
  kinds?: string[];
  sourceTypes?: SourceType[];
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

/**
 * Named filter groups, as they appear in the UI.
 *
 * These map a user-facing word onto the `kind` values the projection emits, so
 * the page never hard-codes database vocabulary.
 */
export const TIMELINE_FILTERS = {
  all: [],
  decisions: ['decision'],
  ideas: ['idea', 'suggestion', 'rejected_idea'],
  prompts: ['prompt', 'winning_prompt', 'failed_prompt'],
  implementations: ['implementation', 'added', 'refactored'],
  changes: ['change', 'removed'],
  bugs: ['bug'],
  fixes: ['fix'],
  files: ['file', 'link', 'repo_file', 'upload', 'url'],
  blockers: ['blocker'],
  milestones: ['milestone'],
  progress: ['progress'],
  research: ['research'],
} as const satisfies Record<string, readonly string[]>;

export type TimelineFilterKey = keyof typeof TIMELINE_FILTERS;

// ---------------------------------------------------------------------------
// Search (Phase 3)
// ---------------------------------------------------------------------------

/**
 * Whether a hit is still true.
 *
 * The distinction matters more here than anywhere else in the product. A search
 * that returns a superseded decision without saying so is worse than one that
 * returns nothing: it hands back an answer that was deliberately replaced.
 *
 * `snapshot` is its own state rather than a flavour of `historical` because a
 * saved Master Topic Memory is derived and disposable (AD-8). It is evidence of
 * what the memory said at a moment, never a second Current State.
 */
export const RECORD_STATES = ['current', 'historical', 'snapshot'] as const;
export type RecordState = (typeof RECORD_STATES)[number];

export const RECORD_STATE_LABELS: Record<RecordState, string> = {
  current: 'Current',
  historical: 'History',
  snapshot: 'Saved snapshot',
};

/**
 * One search hit, read from the `search_documents` projection.
 *
 * Holds nothing of its own: `entityType` + `id` locate the authoritative row,
 * and the projection is `security_invoker`, so row-level security on the
 * underlying tables — not this type — decides what a caller can see.
 */
export interface SearchHit {
  entityType: EntityType;
  id: string;
  workspaceId: string;
  topicId: string | null;
  subtopicId: string | null;
  title: string;
  snippet: string | null;
  sourceType: SourceType | null;
  /** knowledge_type, action kind, file kind, or a literal like 'decision'. */
  kind: string;
  status: string | null;
  recordState: RecordState;
  occurredAt: string;
  /** Postgres `ts_rank_cd`. Deterministic: the same query always ranks the same. */
  rank: number;
}

export interface SearchQuery {
  workspaceId: string;
  /** Raw user input. Parsed by `websearch_to_tsquery`, so quotes and OR work. */
  text: string;
  entityTypes?: EntityType[];
  kinds?: string[];
  sourceTypes?: SourceType[];
  topicId?: string;
  recordStates?: RecordState[];
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

/** Named filter groups for the search page, in the order they are shown. */
export const SEARCH_TYPE_FILTERS = {
  all: [],
  topics: ['topic', 'subtopic'],
  knowledge: ['knowledge_entry'],
  decisions: ['decision'],
  ideas: ['idea'],
  prompts: ['prompt', 'prompt_version'],
  sources: ['source_session'],
  files: ['file_reference'],
  work: ['action', 'milestone'],
  inbox: ['ingestion_record'],
  snapshots: ['context_snapshot'],
} as const satisfies Record<string, readonly EntityType[]>;

export type SearchTypeFilterKey = keyof typeof SEARCH_TYPE_FILTERS;

// ---------------------------------------------------------------------------
// Duplicate and conflict proposals (Phase 3)
// ---------------------------------------------------------------------------

/**
 * A PROPOSAL, never a verdict (CLAUDE.md rule 17).
 *
 * Nothing in the system acts on one of these. It is rendered next to the
 * record it concerns with the choices spelled out, and the user picks. There is
 * deliberately no "auto-merge above 0.95" path — misfiling silently is worse
 * than an extra decision.
 */
export interface DuplicateProposal {
  /** 'exact' when the content fingerprints match; 'similar' from trigram distance. */
  basis: 'exact' | 'similar' | 'same_source';
  entityType: EntityType;
  candidateId: string;
  candidateTitle: string;
  candidateOccurredAt: string;
  /** 0–1. Reported so the user can weigh it, never so code can act on it. */
  similarity: number;
  reason: string;
}

/** Two active decisions that cannot both be true. Proposed, never applied. */
export interface ConflictProposal {
  decisionId: string;
  decisionTitle: string;
  conflictsWithId: string;
  conflictsWithTitle: string;
  similarity: number;
  reason: string;
}
