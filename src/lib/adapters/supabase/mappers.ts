/**
 * Row → domain mapping. Keeps snake_case and vendor shapes out of the app.
 * Rows are typed loosely here because generated DB types are an adapter
 * implementation detail (CLAUDE.md rule 19); the domain types are the contract.
 */

import type {
  Action,
  Decision,
  EntityType,
  FileReference,
  Idea,
  IngestionRecord,
  KnowledgeEntry,
  Milestone,
  Prompt,
  PromptVersion,
  TopicContext,
  RecordState,
  Relationship,
  SearchHit,
  SourceSession,
  SourceType,
  TimelineEvent,
  Subtopic,
  Topic,
  Workspace,
} from '@/lib/domain/types';

type Row = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const nstr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback);
const bool = (v: unknown): boolean => v === true;
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

export function toWorkspace(r: Row): Workspace {
  return {
    id: str(r.id),
    ownerId: str(r.owner_id),
    name: str(r.name),
    slug: str(r.slug),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export function toTopic(r: Row): Topic {
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    name: str(r.name),
    slug: str(r.slug),
    description: nstr(r.description),
    goal: nstr(r.goal),
    currentState: nstr(r.current_state),
    status: (nstr(r.status) ?? 'active') as Topic['status'],
    progress: num(r.progress),
    pinned: bool(r.pinned),
    resumeTriggerIf: nstr(r.resume_trigger_if),
    resumeTriggerThen: nstr(r.resume_trigger_then),
    lastMeaningfulUpdateAt: str(r.last_meaningful_update_at),
    archivedAt: nstr(r.archived_at),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export function toSubtopic(r: Row): Subtopic {
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    topicId: str(r.topic_id),
    parentSubtopicId: nstr(r.parent_subtopic_id),
    name: str(r.name),
    slug: str(r.slug),
    description: nstr(r.description),
    goal: nstr(r.goal),
    currentState: nstr(r.current_state),
    status: (nstr(r.status) ?? 'active') as Subtopic['status'],
    position: num(r.position),
    resumeTriggerIf: nstr(r.resume_trigger_if),
    resumeTriggerThen: nstr(r.resume_trigger_then),
    lastMeaningfulUpdateAt: str(r.last_meaningful_update_at),
    archivedAt: nstr(r.archived_at),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export function toEntry(r: Row): KnowledgeEntry {
  const links = Array.isArray(r.entry_subtopics) ? (r.entry_subtopics as Row[]) : [];
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    topicId: str(r.topic_id),
    subtopicIds: links.map((l) => str(l.subtopic_id)).filter(Boolean),
    knowledgeType: (nstr(r.knowledge_type) ?? 'important_context') as KnowledgeEntry['knowledgeType'],
    status: (nstr(r.status) ?? 'active') as KnowledgeEntry['status'],
    title: str(r.title),
    content: nstr(r.content),
    sourceType: (nstr(r.source_type) ?? 'manual') as KnowledgeEntry['sourceType'],
    sourceSessionId: nstr(r.source_session_id),
    sourceReference: nstr(r.source_reference),
    occurredAt: str(r.occurred_at),
    supersededById: nstr(r.superseded_by_id),
    supersedesReason: nstr(r.supersedes_reason),
    importance: num(r.importance),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export function toDecision(r: Row): Decision {
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    topicId: str(r.topic_id),
    subtopicId: nstr(r.subtopic_id),
    title: str(r.title),
    decision: str(r.decision),
    reason: nstr(r.reason),
    alternatives: strArray(r.alternatives),
    approvedDirection: nstr(r.approved_direction),
    status: (nstr(r.status) ?? 'active') as Decision['status'],
    decidedAt: str(r.decided_at),
    supersededById: nstr(r.superseded_by_id),
    supersedeReason: nstr(r.supersede_reason),
    sourceType: (nstr(r.source_type) ?? 'manual') as Decision['sourceType'],
    sourceSessionId: nstr(r.source_session_id),
  };
}

export function toIdea(r: Row): Idea {
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    topicId: str(r.topic_id),
    subtopicId: nstr(r.subtopic_id),
    title: str(r.title),
    idea: nstr(r.idea),
    rationale: nstr(r.rationale),
    status: (nstr(r.status) ?? 'suggested') as Idea['status'],
    decisionId: nstr(r.decision_id),
    implementationEntryId: nstr(r.implementation_entry_id),
    sourceType: (nstr(r.source_type) ?? 'manual') as Idea['sourceType'],
    sourceSessionId: nstr(r.source_session_id),
    createdAt: str(r.created_at),
  };
}

export function toPrompt(r: Row): Prompt {
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    topicId: str(r.topic_id),
    subtopicId: nstr(r.subtopic_id),
    title: str(r.title),
    purpose: nstr(r.purpose),
    sourceType: (nstr(r.source_type) ?? 'manual') as Prompt['sourceType'],
    currentVersionId: nstr(r.current_version_id),
    isWinning: bool(r.is_winning),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export function toPromptVersion(r: Row): PromptVersion {
  return {
    id: str(r.id),
    promptId: str(r.prompt_id),
    version: num(r.version, 1),
    body: str(r.body),
    result: (nstr(r.result) ?? 'untested') as PromptVersion['result'],
    rating: typeof r.rating === 'number' ? r.rating : null,
    notes: nstr(r.notes),
    outputSummary: nstr(r.output_summary),
    createdAt: str(r.created_at),
  };
}

export function toAction(r: Row): Action {
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    topicId: str(r.topic_id),
    subtopicId: nstr(r.subtopic_id),
    kind: (nstr(r.kind) ?? 'next_step') as Action['kind'],
    status: (nstr(r.status) ?? 'open') as Action['status'],
    title: str(r.title),
    detail: nstr(r.detail),
    position: num(r.position),
    resolvedAt: nstr(r.resolved_at),
    createdAt: str(r.created_at),
  };
}

export function toFileReference(r: Row): FileReference {
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    topicId: str(r.topic_id),
    subtopicId: nstr(r.subtopic_id),
    kind: (nstr(r.kind) ?? 'repo_file') as FileReference['kind'],
    path: nstr(r.path),
    displayName: nstr(r.display_name),
    url: nstr(r.url),
    repoUrl: nstr(r.repo_url),
    branch: nstr(r.branch),
    commitSha: nstr(r.commit_sha),
    createdAt: str(r.created_at),
  };
}

export function toMilestone(r: Row): Milestone {
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    topicId: str(r.topic_id),
    title: str(r.title),
    detail: nstr(r.detail),
    achievedAt: nstr(r.achieved_at),
    status: (nstr(r.status) ?? 'planned') as Milestone['status'],
  };
}

export function toSourceSession(r: Row): SourceSession {
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    topicId: nstr(r.topic_id),
    sourceType: (nstr(r.source_type) ?? 'manual') as SourceSession['sourceType'],
    title: nstr(r.title),
    externalUrl: nstr(r.external_url),
    occurredAt: str(r.occurred_at),
    summary: nstr(r.summary),
    rawContent: nstr(r.raw_content),
    repoUrl: nstr(r.repo_url),
    branch: nstr(r.branch),
    commitSha: nstr(r.commit_sha),
    filesChanged: strArray(r.files_changed),
    filesAdded: strArray(r.files_added),
    filesRemoved: strArray(r.files_removed),
    buildStatus: nstr(r.build_status),
    testSummary: nstr(r.test_summary),
    createdAt: str(r.created_at),
  };
}

export function toIngestionRecord(r: Row): IngestionRecord {
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    adapterId: nstr(r.adapter_id),
    sourceType: (nstr(r.source_type) ?? 'manual') as IngestionRecord['sourceType'],
    contentType: str(r.content_type) || 'text',
    rawContent: nstr(r.raw_content),
    sourceHint: nstr(r.source_hint),
    suggestedTopicId: nstr(r.suggested_topic_id),
    topicId: nstr(r.topic_id),
    subtopicId: nstr(r.subtopic_id),
    status: (nstr(r.status) ?? 'unsorted') as IngestionRecord['status'],
    error: nstr(r.error),
    createdSourceSessionId: nstr(r.created_source_session_id),
    createdEntryIds: strArray(r.created_entry_ids),
    createdAt: str(r.created_at),
    processedAt: nstr(r.processed_at),
  };
}

export function toRelationship(r: Row): Relationship {
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    fromType: str(r.from_type) as Relationship['fromType'],
    fromId: str(r.from_id),
    relationshipType: str(r.relationship_type) as Relationship['relationshipType'],
    toType: str(r.to_type) as Relationship['toType'],
    toId: str(r.to_id),
    note: nstr(r.note),
    createdAt: str(r.created_at),
  };
}

export function toTimelineEvent(r: Row): TimelineEvent {
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    topicId: str(r.topic_id),
    subtopicIds: Array.isArray(r.subtopic_ids) ? (r.subtopic_ids as string[]) : [],
    entityType: str(r.entity_type) as TimelineEvent['entityType'],
    kind: str(r.kind),
    title: str(r.title),
    summary: nstr(r.summary),
    sourceType: nstr(r.source_type) as TimelineEvent['sourceType'],
    status: nstr(r.status),
    supersededById: nstr(r.superseded_by_id),
    occurredAt: str(r.occurred_at),
    createdAt: str(r.created_at),
  };
}

/**
 * A row of the `search_documents` projection.
 *
 * `rank` is computed by the query rather than stored, so it arrives alongside
 * the projected columns; a hit read outside a ranked query reports 0.
 */
export function toSearchHit(r: Row): SearchHit {
  return {
    entityType: (nstr(r.entity_type) ?? 'knowledge_entry') as EntityType,
    id: str(r.entity_id),
    workspaceId: str(r.workspace_id),
    topicId: nstr(r.topic_id),
    subtopicId: nstr(r.subtopic_id),
    title: str(r.title) || 'Untitled',
    snippet: nstr(r.snippet),
    sourceType: nstr(r.source_type) as SourceType | null,
    kind: str(r.kind),
    status: nstr(r.status),
    recordState: (nstr(r.record_state) ?? 'current') as RecordState,
    occurredAt: str(r.occurred_at),
    rank: num(r.rank),
  };
}

/** A `deletion_log` tombstone, with a label recovered from its snapshot. */
export function toDeletedRecord(r: Row): {
  id: string;
  workspaceId: string;
  entityType: EntityType;
  entityId: string;
  title: string;
  reason: string | null;
  deletedAt: string;
  restoredAt: string | null;
} {
  const snapshot = (r.snapshot ?? {}) as Row;
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    entityType: (nstr(r.entity_type) ?? 'knowledge_entry') as EntityType,
    entityId: str(r.entity_id),
    // The snapshot is the whole row, so the label survives even though the
    // live record is hidden from every list query.
    title: nstr(snapshot.title) ?? nstr(snapshot.name) ?? nstr(snapshot.display_name) ?? 'Untitled',
    reason: nstr(r.reason),
    deletedAt: str(r.created_at),
    restoredAt: nstr(r.restored_at),
  };
}

/**
 * Resolves each prompt to the EXACT version that won.
 *
 * Pure, and separated from the query that feeds it so the rule can be tested
 * without a database — because the rule is easy to get wrong in a way nothing
 * else catches. The first version of this sorted the versions descending and
 * took the first, which is the NEWEST, and every caller downstream believed it:
 * Master Topic Memory rendered the wrong body, and a Resume export would have
 * pasted a later failed experiment into a fresh Claude session under a heading
 * saying it worked.
 *
 * `prompts.is_winning` is deliberately not consulted. It is a derived boolean
 * meaning "this prompt has a winner somewhere"; the selection rows say which
 * one, and they are the append-only source of truth (rule 9a).
 *
 * A prompt with no selection is omitted. A selection pointing at a version
 * that is not present yields `version: null` rather than a substitute — a
 * missing winner is reported, never quietly replaced.
 */
export function toWinningPrompts(
  promptRows: Row[],
  winningRows: Row[],
): TopicContext['winningPrompts'] {
  const selections = new Map<string, Row>();
  for (const row of winningRows) selections.set(str(row.prompt_id), row);

  const out: TopicContext['winningPrompts'] = [];
  for (const row of promptRows) {
    const selection = selections.get(str(row.id));
    if (!selection) continue;

    const versions = Array.isArray(row.prompt_versions)
      ? (row.prompt_versions as Row[]).map(toPromptVersion).sort((a, b) => b.version - a.version)
      : [];

    out.push({
      prompt: toPrompt(row),
      version: versions.find((v) => v.id === str(selection.prompt_version_id)) ?? null,
      versions,
      reason: nstr(selection.reason),
    });
  }
  return out;
}

/**
 * A `context_snapshots` row as a Resume export record.
 *
 * `inputs` carries everything the columns do not: size, the sections that were
 * rendered, the record ids that went into them, freshness and conflict counts.
 * A jsonb bag is right here precisely because none of it is ever queried or
 * joined on — it is evidence about one export, read back only by the history
 * screen.
 */
export function toResumeExport(r: Row): {
  id: string;
  workspaceId: string;
  topicId: string;
  subtopicId: string | null;
  target: 'claude_chat' | 'claude_cowork' | 'claude_code';
  density: 'compact' | 'standard' | 'full_audit';
  generatedAt: string;
  body: string;
  meta: Record<string, unknown>;
} {
  return {
    id: str(r.id),
    workspaceId: str(r.workspace_id),
    topicId: str(r.topic_id),
    subtopicId: nstr(r.subtopic_id),
    target: (nstr(r.target) ?? 'claude_chat') as 'claude_chat' | 'claude_cowork' | 'claude_code',
    density: (nstr(r.density) ?? 'standard') as 'compact' | 'standard' | 'full_audit',
    generatedAt: str(r.generated_at),
    body: str(r.body),
    meta: (r.inputs ?? {}) as Record<string, unknown>,
  };
}
