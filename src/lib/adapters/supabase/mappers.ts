/**
 * Row → domain mapping. Keeps snake_case and vendor shapes out of the app.
 * Rows are typed loosely here because generated DB types are an adapter
 * implementation detail (CLAUDE.md rule 19); the domain types are the contract.
 */

import type {
  Action,
  Decision,
  FileReference,
  Idea,
  IngestionRecord,
  KnowledgeEntry,
  Milestone,
  Prompt,
  PromptVersion,
  Relationship,
  SourceSession,
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
