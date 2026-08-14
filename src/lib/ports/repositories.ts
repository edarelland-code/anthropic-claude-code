/**
 * Repository ports.
 *
 * CLAUDE.md rule 18: these interfaces name no vendor. `app/` and `components/`
 * depend on this file; only `src/lib/adapters/**` implements it. Swapping the
 * database means writing one new adapter directory and changing nothing else.
 */

import type {
  Action,
  ActionKind,
  ConflictProposal,
  Decision,
  DecisionStatus,
  DeletableEntityType,
  DuplicateProposal,
  EntityType,
  FileReference,
  Idea,
  IdeaStatus,
  IngestionRecord,
  IngestionStatus,
  KnowledgeEntry,
  KnowledgeType,
  Prompt,
  PromptVersion,
  Relationship,
  RelationshipType,
  SearchHit,
  SearchQuery,
  SourceSession,
  SourceType,
  TimelineEvent,
  TimelineQuery,
  Subtopic,
  Topic,
  TopicContext,
  TopicStatus,
  TopicSummary,
  Workspace,
} from '../domain/types';

export interface SessionUser {
  id: string;
  email: string | null;
  displayName: string | null;
}

/** Raised when an optimistic-concurrency update loses (ARCHITECTURE §4.4). */
export class ConflictError extends Error {
  constructor(
    message: string,
    readonly entity: string,
    readonly id: string,
  ) {
    super(message);
    this.name = 'ConflictError';
  }
}

export interface AuthPort {
  getUser(): Promise<SessionUser | null>;
  signInWithEmail(email: string, redirectTo: string): Promise<void>;
  signOut(): Promise<void>;
}

export interface WorkspaceRepository {
  listForCurrentUser(): Promise<Workspace[]>;
  getDefault(): Promise<Workspace | null>;
}

export interface CreateTopicInput {
  workspaceId: string;
  name: string;
  description?: string | null;
  goal?: string | null;
}

export interface UpdateTopicInput {
  id: string;
  /** The updatedAt the client read. Optimistic concurrency; see ARCHITECTURE §4. */
  expectedUpdatedAt: string;
  name?: string;
  description?: string | null;
  goal?: string | null;
  currentState?: string | null;
  status?: TopicStatus;
  progress?: number;
  pinned?: boolean;
  resumeTriggerIf?: string | null;
  resumeTriggerThen?: string | null;
  /** True when the edit represents real progress, not a cosmetic change. */
  meaningful?: boolean;
}

export interface TopicRepository {
  list(workspaceId: string, opts?: { includeArchived?: boolean }): Promise<TopicSummary[]>;
  getById(id: string): Promise<Topic | null>;
  getBySlug(workspaceId: string, slug: string): Promise<Topic | null>;
  /** Everything the Topic page and Resume assembler need, in one read. */
  getContext(topicId: string): Promise<TopicContext | null>;
  create(input: CreateTopicInput): Promise<Topic>;
  update(input: UpdateTopicInput): Promise<Topic>;
  /** Soft delete + tombstone. Never a hard DELETE. */
  softDelete(id: string, reason?: string): Promise<void>;
  restore(id: string): Promise<void>;
}

export interface CreateSubtopicInput {
  topicId: string;
  name: string;
  parentSubtopicId?: string | null;
  description?: string | null;
}

export interface SubtopicRepository {
  listForTopic(topicId: string): Promise<Subtopic[]>;
  create(input: CreateSubtopicInput): Promise<Subtopic>;
  rename(id: string, name: string, expectedUpdatedAt: string): Promise<Subtopic>;
  move(id: string, toTopicId: string, toParentSubtopicId: string | null): Promise<Subtopic>;
  archive(id: string): Promise<void>;
  restore(id: string): Promise<void>;
}

export interface CreateEntryInput {
  topicId: string;
  subtopicIds?: string[];
  knowledgeType: KnowledgeType;
  title: string;
  content?: string | null;
  sourceType?: SourceType;
  sourceSessionId?: string | null;
  sourceReference?: string | null;
  occurredAt?: string;
  importance?: number;
}

export interface EntryQuery {
  topicId?: string;
  subtopicId?: string;
  workspaceId?: string;
  /** Every Layer 2 entry produced by one Layer 1 session. */
  sourceSessionId?: string;
  types?: KnowledgeType[];
  sourceTypes?: SourceType[];
  /** Current State when true: active + not superseded. */
  currentOnly?: boolean;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export interface KnowledgeRepository {
  query(q: EntryQuery): Promise<KnowledgeEntry[]>;
  getById(id: string): Promise<KnowledgeEntry | null>;
  create(input: CreateEntryInput): Promise<KnowledgeEntry>;
  /**
   * Writes a version row, then updates the entry. The previous body is always
   * recoverable (CLAUDE.md rule 5).
   */
  edit(input: {
    id: string;
    expectedUpdatedAt: string;
    title?: string;
    content?: string | null;
    knowledgeType?: KnowledgeType;
    note?: string;
  }): Promise<KnowledgeEntry>;
  /**
   * Appends a replacement and links the old one. `reason` is required —
   * CLAUDE.md rule 7.
   */
  supersede(input: {
    id: string;
    title: string;
    content?: string | null;
    knowledgeType: KnowledgeType;
    reason: string;
  }): Promise<KnowledgeEntry>;
  listVersions(entryId: string): Promise<
    Array<{ version: number; title: string; content: string | null; createdAt: string; note: string | null }>
  >;
  softDelete(id: string, reason?: string): Promise<void>;
}

export interface DecisionRepository {
  listForTopic(topicId: string): Promise<Decision[]>;
  getById(id: string): Promise<Decision | null>;
  create(input: {
    topicId: string;
    subtopicId?: string | null;
    title: string;
    decision: string;
    reason?: string | null;
    alternatives?: string[];
    approvedDirection?: string | null;
    status?: DecisionStatus;
    sourceType?: SourceType;
    sourceSessionId?: string | null;
  }): Promise<Decision>;
  /**
   * Moves a decision between the states a user can choose. `superseded` is not
   * one of them — that state exists only as the result of `supersede()`, which
   * also sets the pointer the ledger reads.
   */
  setStatus(id: string, status: DecisionStatus): Promise<Decision>;
  /** `reason` is required — CLAUDE.md rule 7, enforced here and in the database. */
  supersede(input: { id: string; newDecisionId: string; reason: string }): Promise<void>;
}

export interface IdeaRepository {
  listForTopic(topicId: string): Promise<Idea[]>;
  create(input: {
    topicId: string;
    subtopicId?: string | null;
    title: string;
    idea?: string | null;
    rationale?: string | null;
    /** Where in the lifecycle it starts. Defaults to `suggested`. */
    status?: IdeaStatus;
    sourceType?: SourceType;
    sourceSessionId?: string | null;
  }): Promise<Idea>;
  getById(id: string): Promise<Idea | null>;
  /**
   * Moves an idea through its lifecycle. `note` is APPENDED to the rationale,
   * never substituted for it — a rejected idea has to keep both why it was
   * suggested and why it was turned down, or the avoid-list loses half its
   * value (rule 9).
   */
  setStatus(id: string, status: IdeaStatus, note?: string): Promise<Idea>;
  /** Records that an idea became a decision, without copying either into the other. */
  linkDecision(ideaId: string, decisionId: string | null): Promise<Idea>;
}

export interface PromptRepository {
  listForTopic(topicId: string): Promise<Array<{ prompt: Prompt; current: PromptVersion | null }>>;
  getWithVersions(id: string): Promise<{ prompt: Prompt; versions: PromptVersion[] } | null>;
  create(input: {
    topicId: string;
    subtopicId?: string | null;
    title: string;
    body: string;
    purpose?: string | null;
    sourceType?: SourceType;
  }): Promise<{ prompt: Prompt; version: PromptVersion }>;
  /** Appends a new version. Never mutates an existing one (CLAUDE.md rule 6). */
  addVersion(input: {
    promptId: string;
    body: string;
    notes?: string | null;
    result?: PromptVersion['result'];
  }): Promise<PromptVersion>;
  /**
   * Appends an outcome. Never mutates the version — re-rating adds a row, so a
   * changed judgement is history rather than an overwrite (migration 0002 §4).
   */
  rateVersion(input: {
    versionId: string;
    result: PromptVersion['result'];
    rating?: number;
    notes?: string | null;
    outputSummary?: string | null;
  }): Promise<PromptVersion>;
  /**
   * Designates the exact winning version, or clears it with `versionId: null`.
   *
   * Source of truth is the append-only selection history; `prompts.is_winning`
   * is derived from it by a trigger and must never be written directly.
   */
  markWinning(input: { promptId: string; versionId: string | null; reason?: string | null }): Promise<void>;
  /** The winning version and its exact body — what "Copy Winning Prompt" copies. */
  getWinning(promptId: string): Promise<{
    versionId: string;
    version: number;
    body: string;
    reason: string | null;
    selectedAt: string;
  } | null>;
  /** Every winning designation this prompt has had, newest first. */
  winningHistory(promptId: string): Promise<
    Array<{ versionId: string | null; reason: string | null; createdAt: string }>
  >;
}

export interface ActionRepository {
  listForTopic(topicId: string, kinds?: ActionKind[]): Promise<Action[]>;
  create(input: {
    topicId: string;
    subtopicId?: string | null;
    kind: ActionKind;
    title: string;
    detail?: string | null;
  }): Promise<Action>;
  setStatus(id: string, status: Action['status']): Promise<Action>;
}

export interface FileRepository {
  listForTopic(topicId: string): Promise<FileReference[]>;
  listForWorkspace(workspaceId: string, kinds?: FileReference['kind'][]): Promise<FileReference[]>;
  create(input: {
    topicId: string;
    subtopicId?: string | null;
    kind: FileReference['kind'];
    path?: string | null;
    url?: string | null;
    displayName?: string | null;
    repoUrl?: string | null;
    branch?: string | null;
    commitSha?: string | null;
    sourceSessionId?: string | null;
  }): Promise<FileReference>;
}

export interface SourceSessionRepository {
  listForTopic(topicId: string): Promise<SourceSession[]>;
  listForWorkspace(workspaceId: string, limit?: number): Promise<SourceSession[]>;
  getById(id: string): Promise<SourceSession | null>;
  create(input: Omit<SourceSession, 'id' | 'createdAt'> & { id?: string }): Promise<SourceSession>;
}

/** A confirmed segment, on its way to becoming a knowledge entry. */
export interface ConfirmedSegment {
  knowledgeType: KnowledgeType;
  title: string;
  content?: string | null;
  sourceReference?: string | null;
  occurredAt?: string | null;
  /** Below 1 only when the user accepted a suggestion rather than typing it. */
  confidence?: number | null;
}

export interface InboxRepository {
  list(workspaceId: string, statuses?: IngestionStatus[]): Promise<IngestionRecord[]>;
  getById(id: string): Promise<IngestionRecord | null>;
  countsByStatus(workspaceId: string): Promise<Record<string, number>>;

  /**
   * Quick Capture: one step.
   *
   * Everything except the content is optional, and the primary flow supplies
   * none of it. The Inbox exists so capture never interrupts what the user was
   * doing — asking for a topic at this moment would defeat the feature.
   */
  capture(input: {
    workspaceId: string;
    rawContent: string;
    sourceType?: SourceType;
    contentType?: string;
    adapterId?: string | null;
    sourceHint?: string | null;
    topicId?: string | null;
  }): Promise<IngestionRecord>;

  /**
   * Files a captured item, writing the Inbox record, the Layer 1 session and
   * every confirmed entry in one transaction.
   *
   * `segments` are CONFIRMED. Suggestions never reach this method — they are
   * resolved to a typed value in the UI, by a person, first.
   */
  process(input: {
    id: string;
    topicId: string;
    subtopicId?: string | null;
    segments: ConfirmedSegment[];
    title?: string | null;
    occurredAt?: string | null;
    externalUrl?: string | null;
  }): Promise<IngestionRecord>;

  /** Files a fresh import in one call, without an Inbox round trip. */
  ingest(input: {
    workspaceId: string;
    adapterId: string;
    sourceType: SourceType;
    contentType?: string;
    raw: string;
    payload?: Record<string, unknown> | null;
    title?: string | null;
    occurredAt?: string | null;
    externalUrl?: string | null;
    topicId?: string | null;
    subtopicId?: string | null;
    segments: ConfirmedSegment[];
    code?: Record<string, unknown> | null;
  }): Promise<IngestionRecord>;

  setStatus(id: string, status: IngestionStatus): Promise<IngestionRecord>;
}

/**
 * Universal search.
 *
 * Backed by the `search_documents` projection, which is `security_invoker` —
 * row-level security on the twelve underlying tables, not this repository,
 * decides what a caller can see. Ranking is `ts_rank_cd` plus recency: entirely
 * deterministic, with no model anywhere in the path.
 */
export interface SearchRepository {
  query(q: SearchQuery): Promise<SearchHit[]>;
  /** Totals per type filter, for the counts beside each chip. */
  countsByType(q: SearchQuery): Promise<Record<string, number>>;
}

/**
 * Duplicate and conflict detection.
 *
 * Every method here READS. Nothing in this interface can merge, link or
 * supersede anything — acting on a proposal is a separate, explicit call the
 * user triggers (rule 17).
 */
export interface ProposalRepository {
  /** Candidates matching text that may not have been written yet. */
  duplicatesForText(input: {
    workspaceId: string;
    title: string;
    content?: string | null;
    /** Excluded from its own results. */
    excludeEntryId?: string;
  }): Promise<DuplicateProposal[]>;
  /** A transcript or capture that appears to have been imported before. */
  duplicateSources(input: {
    workspaceId: string;
    raw?: string | null;
    externalUrl?: string | null;
    commitSha?: string | null;
  }): Promise<DuplicateProposal[]>;
  /** Active decisions in one topic that appear to contradict each other. */
  conflictingDecisions(topicId: string): Promise<ConflictProposal[]>;
}

/** A tombstone, with enough of the row to recognise what it was. */
export interface DeletedRecord {
  id: string;
  workspaceId: string;
  entityType: EntityType;
  entityId: string;
  title: string;
  reason: string | null;
  deletedAt: string;
  restoredAt: string | null;
}

/**
 * Soft delete and recovery.
 *
 * Both calls go through the database's own allowlist. `entityType` is a
 * `DeletableEntityType` here so the compiler refuses `prompt_version` before
 * the database has to — but the database refusing it is the guarantee, and this
 * type only keeps the UI from offering a button that would raise.
 */
export interface RecycleRepository {
  list(workspaceId: string, includeRestored?: boolean): Promise<DeletedRecord[]>;
  softDelete(entityType: DeletableEntityType, entityId: string, reason?: string | null): Promise<string>;
  restore(deletionLogId: string): Promise<string>;
}

/**
 * The unified Timeline.
 *
 * Backed by the `timeline_events` projection, so ordering and filtering happen
 * once in the database rather than by merging eight collections in the app.
 * The projection is security_invoker, so row-level security on the underlying
 * tables — not this repository — decides what a caller can see.
 */
export interface TimelineRepository {
  query(q: TimelineQuery): Promise<TimelineEvent[]>;
  /** Totals per filter group, for the counts beside each filter chip. */
  countsByKind(q: Pick<TimelineQuery, 'workspaceId' | 'topicId' | 'subtopicId'>): Promise<Record<string, number>>;
}

/** One end of a relationship, resolved enough to render without a second query. */
export interface RelatedRecord {
  relationshipId: string;
  relationshipType: RelationshipType;
  /** 'outgoing' when the subject is the `from` side, 'incoming' when it is the `to` side. */
  direction: 'outgoing' | 'incoming';
  entityType: EntityType;
  entityId: string;
  title: string;
  /** Null when the far side was soft-deleted; the edge survives, the label does not. */
  status: string | null;
  note: string | null;
  createdAt: string;
}

/**
 * The knowledge graph (AD-7).
 *
 * Supersession is NOT written through here. `superseded_by_id` on the row is
 * authoritative for status, and `supersede_decision()` / `supersede_entry()`
 * record the matching graph edge themselves. Writing one here as well would
 * create a second path to the same fact, and the two would eventually disagree.
 */
export interface RelationshipRepository {
  /** Every edge touching a record, in both directions, with the far side resolved. */
  listFor(entityType: EntityType, entityId: string): Promise<RelatedRecord[]>;
  link(input: {
    fromType: EntityType;
    fromId: string;
    relationshipType: RelationshipType;
    toType: EntityType;
    toId: string;
    note?: string | null;
  }): Promise<Relationship>;
  unlink(relationshipId: string): Promise<void>;
}

/** The single object handed to Server Components. */
export interface DataContext {
  auth: AuthPort;
  workspaces: WorkspaceRepository;
  topics: TopicRepository;
  subtopics: SubtopicRepository;
  knowledge: KnowledgeRepository;
  decisions: DecisionRepository;
  ideas: IdeaRepository;
  prompts: PromptRepository;
  actions: ActionRepository;
  files: FileRepository;
  sessions: SourceSessionRepository;
  inbox: InboxRepository;
  relationships: RelationshipRepository;
  timeline: TimelineRepository;
  search: SearchRepository;
  proposals: ProposalRepository;
  recycle: RecycleRepository;
}
