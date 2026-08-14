import type { SupabaseClient } from '@supabase/supabase-js';

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
  Relationship,
  SourceSession,
  SourceType,
  Subtopic,
  Topic,
  TopicContext,
  TopicCounts,
  TopicSummary,
  Workspace,
} from '@/lib/domain/types';
import {
  ConflictError,
  type ActionRepository,
  type AuthPort,
  type CreateEntryInput,
  type CreateSubtopicInput,
  type CreateTopicInput,
  type DataContext,
  type DecisionRepository,
  type EntryQuery,
  type FileRepository,
  type IdeaRepository,
  type InboxRepository,
  type KnowledgeRepository,
  type PromptRepository,
  type RelatedRecord,
  type RelationshipRepository,
  type SessionUser,
  type SourceSessionRepository,
  type SubtopicRepository,
  type TopicRepository,
  type UpdateTopicInput,
  type WorkspaceRepository,
} from '@/lib/ports/repositories';

import * as map from './mappers';

type Row = Record<string, unknown>;

/** Phase gate: never silently no-op a write that is not built yet (CLAUDE.md rule 14). */
class NotYetImplemented extends Error {
  constructor(what: string, phase: number) {
    super(`${what} lands in Phase ${phase}. It is not implemented yet.`);
    this.name = 'NotYetImplemented';
  }
}

/**
 * Narrows a single-row result to a plain row. The vendor client types a bare
 * `select('*')` result as `null` without generated generics, so the cast lives
 * here once instead of at every call site.
 */
function unwrap(res: { data: unknown; error: { message: string } | null }, ctx: string): Row {
  if (res.error) throw new Error(`${ctx}: ${res.error.message}`);
  if (res.data === null || res.data === undefined) throw new Error(`${ctx}: no data returned`);
  return res.data as Row;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60);
  return base || 'untitled';
}

// ---------------------------------------------------------------------------

class SupabaseAuth implements AuthPort {
  constructor(private readonly db: SupabaseClient) {}

  async getUser(): Promise<SessionUser | null> {
    const { data, error } = await this.db.auth.getUser();
    if (error || !data.user) return null;
    return {
      id: data.user.id,
      email: data.user.email ?? null,
      displayName: (data.user.user_metadata?.display_name as string | undefined) ?? null,
    };
  }

  async signInWithEmail(email: string, redirectTo: string): Promise<void> {
    const { error } = await this.db.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) throw new Error(error.message);
  }

  async signOut(): Promise<void> {
    await this.db.auth.signOut();
  }
}

class SupabaseWorkspaces implements WorkspaceRepository {
  constructor(private readonly db: SupabaseClient) {}

  async listForCurrentUser(): Promise<Workspace[]> {
    const { data, error } = await this.db.from('workspaces').select('*').order('created_at');
    if (error) throw new Error(`list workspaces: ${error.message}`);
    return (data ?? []).map((r) => map.toWorkspace(r as Row));
  }

  async getDefault(): Promise<Workspace | null> {
    const all = await this.listForCurrentUser();
    return all[0] ?? null;
  }
}

const TOPIC_FIELDS = '*';

class SupabaseTopics implements TopicRepository {
  constructor(private readonly db: SupabaseClient) {}

  async list(workspaceId: string, opts?: { includeArchived?: boolean }): Promise<TopicSummary[]> {
    let q = this.db
      .from('topics')
      .select(TOPIC_FIELDS)
      .eq('workspace_id', workspaceId)
      .is('deleted_at', null)
      .order('pinned', { ascending: false })
      .order('last_meaningful_update_at', { ascending: false });
    if (!opts?.includeArchived) q = q.neq('status', 'archived');

    const { data, error } = await q;
    if (error) throw new Error(`list topics: ${error.message}`);
    const topics = (data ?? []).map((r) => map.toTopic(r as Row));
    if (topics.length === 0) return [];

    const ids = topics.map((t) => t.id);

    // One round trip per related table, then fold in memory. Cheaper than N+1
    // per topic, and simple enough to stay correct.
    const [entries, subtopics, sessions, prompts, decisions, ideas, files, actions] =
      await Promise.all([
        this.db
          .from('knowledge_entries')
          .select('id, topic_id, title, knowledge_type, source_type, occurred_at')
          .in('topic_id', ids)
          .is('deleted_at', null)
          .order('occurred_at', { ascending: false }),
        this.db.from('subtopics').select('id, topic_id').in('topic_id', ids).is('deleted_at', null),
        this.db.from('source_sessions').select('id, topic_id, source_type').in('topic_id', ids),
        this.db.from('prompts').select('id, topic_id').in('topic_id', ids).is('deleted_at', null),
        this.db.from('decisions').select('id, topic_id').in('topic_id', ids).is('deleted_at', null),
        this.db.from('ideas').select('id, topic_id').in('topic_id', ids).is('deleted_at', null),
        this.db.from('file_references').select('id, topic_id').in('topic_id', ids).is('deleted_at', null),
        this.db
          .from('actions')
          .select('id, topic_id, title, kind, status, position')
          .in('topic_id', ids)
          .is('deleted_at', null)
          .in('status', ['open', 'in_progress', 'blocked'])
          .order('position'),
      ]);

    const countBy = (rows: Row[] | null): Map<string, number> => {
      const m = new Map<string, number>();
      for (const r of rows ?? []) {
        const k = String(r.topic_id);
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return m;
    };

    const entryRows = (entries.data ?? []) as Row[];
    const sessionRows = (sessions.data ?? []) as Row[];
    const actionRows = (actions.data ?? []) as Row[];

    const cEntries = countBy(entryRows);
    const cSubtopics = countBy((subtopics.data ?? []) as Row[]);
    const cSessions = countBy(sessionRows);
    const cPrompts = countBy((prompts.data ?? []) as Row[]);
    const cDecisions = countBy((decisions.data ?? []) as Row[]);
    const cIdeas = countBy((ideas.data ?? []) as Row[]);
    const cFiles = countBy((files.data ?? []) as Row[]);
    const cActions = countBy(actionRows);

    const latestByTopic = new Map<string, Row>();
    for (const r of entryRows) {
      const k = String(r.topic_id);
      if (!latestByTopic.has(k)) latestByTopic.set(k, r);
    }

    const nextByTopic = new Map<string, Row>();
    for (const r of actionRows) {
      const k = String(r.topic_id);
      if (r.kind === 'next_step' && !nextByTopic.has(k)) nextByTopic.set(k, r);
    }

    const sourcesByTopic = new Map<string, Set<SourceType>>();
    for (const r of [...entryRows, ...sessionRows]) {
      const k = String(r.topic_id);
      const set = sourcesByTopic.get(k) ?? new Set<SourceType>();
      if (typeof r.source_type === 'string') set.add(r.source_type as SourceType);
      sourcesByTopic.set(k, set);
    }

    return topics.map((topic) => {
      const latest = latestByTopic.get(topic.id);
      const next = nextByTopic.get(topic.id);
      const counts: TopicCounts = {
        subtopics: cSubtopics.get(topic.id) ?? 0,
        entries: cEntries.get(topic.id) ?? 0,
        sessions: cSessions.get(topic.id) ?? 0,
        prompts: cPrompts.get(topic.id) ?? 0,
        decisions: cDecisions.get(topic.id) ?? 0,
        ideas: cIdeas.get(topic.id) ?? 0,
        files: cFiles.get(topic.id) ?? 0,
        openActions: cActions.get(topic.id) ?? 0,
      };
      return {
        topic,
        counts,
        sourceTypes: [...(sourcesByTopic.get(topic.id) ?? [])],
        latestChange: latest
          ? {
              id: String(latest.id),
              title: String(latest.title),
              knowledgeType: latest.knowledge_type as KnowledgeEntry['knowledgeType'],
              occurredAt: String(latest.occurred_at),
            }
          : null,
        nextAction: next
          ? { id: String(next.id), title: String(next.title), kind: next.kind as Action['kind'] }
          : null,
      };
    });
  }

  async getById(id: string): Promise<Topic | null> {
    const { data, error } = await this.db.from('topics').select(TOPIC_FIELDS).eq('id', id).maybeSingle();
    if (error) throw new Error(`get topic: ${error.message}`);
    return data ? map.toTopic(data as unknown as Row) : null;
  }

  async getBySlug(workspaceId: string, slug: string): Promise<Topic | null> {
    const { data, error } = await this.db
      .from('topics')
      .select(TOPIC_FIELDS)
      .eq('workspace_id', workspaceId)
      .eq('slug', slug)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw new Error(`get topic by slug: ${error.message}`);
    return data ? map.toTopic(data as unknown as Row) : null;
  }

  async getContext(topicId: string): Promise<TopicContext | null> {
    const topic = await this.getById(topicId);
    if (!topic) return null;

    const [subtopics, entries, decisions, ideas, actions, files, milestones, sessions, prompts] =
      await Promise.all([
        this.db.from('subtopics').select('*').eq('topic_id', topicId).is('deleted_at', null).order('position'),
        this.db
          .from('knowledge_entries')
          .select('*, entry_subtopics(subtopic_id)')
          .eq('topic_id', topicId)
          .is('deleted_at', null)
          .order('occurred_at', { ascending: false }),
        this.db.from('decisions').select('*').eq('topic_id', topicId).is('deleted_at', null).order('decided_at', { ascending: false }),
        this.db.from('ideas').select('*').eq('topic_id', topicId).is('deleted_at', null).order('created_at', { ascending: false }),
        this.db
          .from('actions')
          .select('*')
          .eq('topic_id', topicId)
          .is('deleted_at', null)
          .in('status', ['open', 'in_progress', 'blocked'])
          .order('position'),
        this.db.from('file_references').select('*').eq('topic_id', topicId).is('deleted_at', null),
        this.db.from('milestones').select('*').eq('topic_id', topicId).is('deleted_at', null),
        this.db.from('source_sessions').select('*').eq('topic_id', topicId).order('occurred_at', { ascending: false }),
        this.db.from('prompts').select('*, prompt_versions(*)').eq('topic_id', topicId).is('deleted_at', null),
      ]);

    const timeline = ((entries.data ?? []) as Row[]).map(map.toEntry);
    const allDecisions = ((decisions.data ?? []) as Row[]).map(map.toDecision);
    const allIdeas = ((ideas.data ?? []) as Row[]).map(map.toIdea);

    const winningPrompts = ((prompts.data ?? []) as Row[])
      .filter((r) => r.is_winning === true)
      .map((r) => {
        const versions = Array.isArray(r.prompt_versions)
          ? (r.prompt_versions as Row[]).map(map.toPromptVersion).sort((a, b) => b.version - a.version)
          : [];
        return { prompt: map.toPrompt(r), version: versions[0] ?? null };
      });

    const subtopicRows = ((subtopics.data ?? []) as Row[]).map(map.toSubtopic);
    const actionRows = ((actions.data ?? []) as Row[]).map(map.toAction);

    return {
      topic,
      subtopics: subtopicRows,
      counts: {
        subtopics: subtopicRows.length,
        entries: timeline.length,
        sessions: (sessions.data ?? []).length,
        prompts: (prompts.data ?? []).length,
        decisions: allDecisions.length,
        ideas: allIdeas.length,
        files: (files.data ?? []).length,
        openActions: actionRows.length,
      },
      // Current State is a read over the same append-only table (ARCHITECTURE §8).
      currentEntries: timeline.filter((e) => e.status === 'active' && e.supersededById === null),
      timeline,
      activeDecisions: allDecisions.filter((d) => d.status === 'active'),
      supersededDecisions: allDecisions.filter((d) => d.status !== 'active'),
      rejectedIdeas: allIdeas.filter((i) => i.status === 'rejected'),
      openActions: actionRows,
      winningPrompts,
      files: ((files.data ?? []) as Row[]).map(map.toFileReference),
      milestones: ((milestones.data ?? []) as Row[]).map(map.toMilestone),
      sessions: ((sessions.data ?? []) as Row[]).map(map.toSourceSession),
    };
  }

  async create(input: CreateTopicInput): Promise<Topic> {
    const { data: userData } = await this.db.auth.getUser();
    if (!userData.user) throw new Error('not signed in');

    const row = unwrap(
      await this.db
        .from('topics')
        .insert({
          workspace_id: input.workspaceId,
          user_id: userData.user.id,
          name: input.name.trim(),
          slug: slugify(input.name),
          description: input.description ?? null,
          goal: input.goal ?? null,
        })
        .select(TOPIC_FIELDS)
        .single(),
      'create topic',
    );
    return map.toTopic(row as Row);
  }

  async update(input: UpdateTopicInput): Promise<Topic> {
    const patch: Row = {};
    if (input.name !== undefined) patch.name = input.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.goal !== undefined) patch.goal = input.goal;
    if (input.currentState !== undefined) patch.current_state = input.currentState;
    if (input.status !== undefined) patch.status = input.status;
    if (input.progress !== undefined) patch.progress = input.progress;
    if (input.pinned !== undefined) patch.pinned = input.pinned;
    if (input.resumeTriggerIf !== undefined) patch.resume_trigger_if = input.resumeTriggerIf;
    if (input.resumeTriggerThen !== undefined) patch.resume_trigger_then = input.resumeTriggerThen;
    // A rename is not progress — only meaningful edits move the freshness clock.
    if (input.meaningful) patch.last_meaningful_update_at = new Date().toISOString();

    // Optimistic concurrency: another device winning means zero rows, not a clobber.
    const { data, error } = await this.db
      .from('topics')
      .update(patch)
      .eq('id', input.id)
      .eq('updated_at', input.expectedUpdatedAt)
      .select(TOPIC_FIELDS)
      .maybeSingle();

    if (error) throw new Error(`update topic: ${error.message}`);
    if (!data) {
      throw new ConflictError(
        'This topic changed on another device. Reload to see the newer version before editing.',
        'topic',
        input.id,
      );
    }
    return map.toTopic(data as unknown as Row);
  }

  async softDelete(id: string, reason?: string): Promise<void> {
    const current = await this.getById(id);
    if (!current) return;
    const { data: userData } = await this.db.auth.getUser();

    const { error } = await this.db
      .from('topics')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(`delete topic: ${error.message}`);

    // Tombstone so deletion stays recoverable (CLAUDE.md rule 5).
    await this.db.from('deletion_log').insert({
      workspace_id: current.workspaceId,
      user_id: userData.user?.id,
      entity_type: 'topic',
      entity_id: id,
      snapshot: current as unknown as Row,
      reason: reason ?? null,
    });
  }

  async restore(id: string): Promise<void> {
    const { error } = await this.db.from('topics').update({ deleted_at: null }).eq('id', id);
    if (error) throw new Error(`restore topic: ${error.message}`);
    await this.db
      .from('deletion_log')
      .update({ restored_at: new Date().toISOString() })
      .eq('entity_id', id)
      .is('restored_at', null);
  }
}

class SupabaseSubtopics implements SubtopicRepository {
  constructor(private readonly db: SupabaseClient) {}

  async listForTopic(topicId: string): Promise<Subtopic[]> {
    const { data, error } = await this.db
      .from('subtopics')
      .select('*')
      .eq('topic_id', topicId)
      .is('deleted_at', null)
      .order('position');
    if (error) throw new Error(`list subtopics: ${error.message}`);
    return (data ?? []).map((r) => map.toSubtopic(r as Row));
  }

  async create(input: CreateSubtopicInput): Promise<Subtopic> {
    const { data: userData } = await this.db.auth.getUser();
    if (!userData.user) throw new Error('not signed in');

    const { data: topicRow, error: topicErr } = await this.db
      .from('topics')
      .select('workspace_id')
      .eq('id', input.topicId)
      .single();
    if (topicErr) throw new Error(`create subtopic: ${topicErr.message}`);

    const row = unwrap(
      await this.db
        .from('subtopics')
        .insert({
          workspace_id: (topicRow as Row).workspace_id,
          topic_id: input.topicId,
          parent_subtopic_id: input.parentSubtopicId ?? null,
          user_id: userData.user.id,
          name: input.name.trim(),
          slug: slugify(input.name),
          description: input.description ?? null,
        })
        .select('*')
        .single(),
      'create subtopic',
    );
    return map.toSubtopic(row as Row);
  }

  async rename(id: string, name: string, expectedUpdatedAt: string): Promise<Subtopic> {
    const { data, error } = await this.db
      .from('subtopics')
      .update({ name: name.trim(), slug: slugify(name) })
      .eq('id', id)
      .eq('updated_at', expectedUpdatedAt)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(`rename subtopic: ${error.message}`);
    if (!data) throw new ConflictError('This subtopic changed on another device.', 'subtopic', id);
    return map.toSubtopic(data as unknown as Row);
  }

  async move(id: string, toTopicId: string, toParentSubtopicId: string | null): Promise<Subtopic> {
    const row = unwrap(
      await this.db
        .from('subtopics')
        .update({ topic_id: toTopicId, parent_subtopic_id: toParentSubtopicId })
        .eq('id', id)
        .select('*')
        .single(),
      'move subtopic',
    );
    return map.toSubtopic(row as Row);
  }

  async archive(id: string): Promise<void> {
    const { error } = await this.db
      .from('subtopics')
      .update({ status: 'archived', archived_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(`archive subtopic: ${error.message}`);
  }

  async restore(id: string): Promise<void> {
    const { error } = await this.db
      .from('subtopics')
      .update({ status: 'active', archived_at: null, deleted_at: null })
      .eq('id', id);
    if (error) throw new Error(`restore subtopic: ${error.message}`);
  }
}

class SupabaseKnowledge implements KnowledgeRepository {
  constructor(private readonly db: SupabaseClient) {}

  async query(q: EntryQuery): Promise<KnowledgeEntry[]> {
    let sel = this.db
      .from('knowledge_entries')
      .select('*, entry_subtopics(subtopic_id)')
      .is('deleted_at', null);

    if (q.topicId) sel = sel.eq('topic_id', q.topicId);
    if (q.workspaceId) sel = sel.eq('workspace_id', q.workspaceId);
    if (q.types?.length) sel = sel.in('knowledge_type', q.types);
    if (q.sourceTypes?.length) sel = sel.in('source_type', q.sourceTypes);
    if (q.currentOnly) sel = sel.eq('status', 'active').is('superseded_by_id', null);
    if (q.since) sel = sel.gte('occurred_at', q.since);
    if (q.until) sel = sel.lte('occurred_at', q.until);

    sel = sel.order('occurred_at', { ascending: false });
    if (q.limit) sel = sel.range(q.offset ?? 0, (q.offset ?? 0) + q.limit - 1);

    const { data, error } = await sel;
    if (error) throw new Error(`query entries: ${error.message}`);
    let rows = (data ?? []).map((r) => map.toEntry(r as Row));
    if (q.subtopicId) rows = rows.filter((e) => e.subtopicIds.includes(q.subtopicId!));
    return rows;
  }

  async getById(id: string): Promise<KnowledgeEntry | null> {
    const { data, error } = await this.db
      .from('knowledge_entries')
      .select('*, entry_subtopics(subtopic_id)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`get entry: ${error.message}`);
    return data ? map.toEntry(data as unknown as Row) : null;
  }

  async create(input: CreateEntryInput): Promise<KnowledgeEntry> {
    const { data: userData } = await this.db.auth.getUser();
    if (!userData.user) throw new Error('not signed in');

    const { data: topicRow, error: topicErr } = await this.db
      .from('topics')
      .select('workspace_id')
      .eq('id', input.topicId)
      .single();
    if (topicErr) throw new Error(`create entry: ${topicErr.message}`);

    const row = unwrap(
      await this.db
        .from('knowledge_entries')
        .insert({
          workspace_id: (topicRow as Row).workspace_id,
          topic_id: input.topicId,
          user_id: userData.user.id,
          knowledge_type: input.knowledgeType,
          title: input.title.trim(),
          content: input.content ?? null,
          source_type: input.sourceType ?? 'manual',
          source_session_id: input.sourceSessionId ?? null,
          source_reference: input.sourceReference ?? null,
          occurred_at: input.occurredAt ?? new Date().toISOString(),
          importance: input.importance ?? 0,
        })
        .select('*')
        .single(),
      'create entry',
    );

    const entryId = String((row as Row).id);
    if (input.subtopicIds?.length) {
      await this.db
        .from('entry_subtopics')
        .insert(input.subtopicIds.map((s) => ({ knowledge_entry_id: entryId, subtopic_id: s })));
    }

    // New knowledge is real progress, so it moves the freshness clock.
    await this.db
      .from('topics')
      .update({ last_meaningful_update_at: new Date().toISOString() })
      .eq('id', input.topicId);

    return { ...map.toEntry(row as Row), subtopicIds: input.subtopicIds ?? [] };
  }

  async edit(input: {
    id: string;
    expectedUpdatedAt: string;
    title?: string;
    content?: string | null;
    knowledgeType?: KnowledgeEntry['knowledgeType'];
    note?: string;
  }): Promise<KnowledgeEntry> {
    const current = await this.getById(input.id);
    if (!current) throw new Error('entry not found');
    const { data: userData } = await this.db.auth.getUser();

    // Snapshot the pre-edit body first. Append-only: never lose the old text.
    const { data: versions } = await this.db
      .from('knowledge_entry_versions')
      .select('version')
      .eq('knowledge_entry_id', input.id)
      .order('version', { ascending: false })
      .limit(1);
    const nextVersion = ((versions?.[0] as Row | undefined)?.version as number | undefined ?? 0) + 1;

    const { error: verErr } = await this.db.from('knowledge_entry_versions').insert({
      knowledge_entry_id: input.id,
      workspace_id: current.workspaceId,
      version: nextVersion,
      title: current.title,
      content: current.content,
      knowledge_type: current.knowledgeType,
      status: current.status,
      edited_by: userData.user?.id ?? null,
      note: input.note ?? null,
    });
    if (verErr) throw new Error(`snapshot entry version: ${verErr.message}`);

    const patch: Row = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.content !== undefined) patch.content = input.content;
    if (input.knowledgeType !== undefined) patch.knowledge_type = input.knowledgeType;

    const { data, error } = await this.db
      .from('knowledge_entries')
      .update(patch)
      .eq('id', input.id)
      .eq('updated_at', input.expectedUpdatedAt)
      .select('*, entry_subtopics(subtopic_id)')
      .maybeSingle();
    if (error) throw new Error(`edit entry: ${error.message}`);
    if (!data) throw new ConflictError('This entry changed on another device.', 'knowledge_entry', input.id);
    return map.toEntry(data as unknown as Row);
  }

  async supersede(input: {
    id: string;
    title: string;
    content?: string | null;
    knowledgeType: KnowledgeEntry['knowledgeType'];
    reason: string;
  }): Promise<KnowledgeEntry> {
    if (!input.reason.trim()) {
      throw new Error('A reason is required to supersede an entry.');
    }
    // Both sides of the supersession are written in one database transaction.
    const { data, error } = await this.db.rpc('supersede_entry', {
      old_entry_id: input.id,
      new_title: input.title,
      new_content: input.content ?? null,
      new_type: input.knowledgeType,
      reason: input.reason,
    });
    if (error) throw new Error(`supersede entry: ${error.message}`);
    const created = await this.getById(String(data));
    if (!created) throw new Error('supersede entry: replacement not found');
    return created;
  }

  async listVersions(entryId: string) {
    const { data, error } = await this.db
      .from('knowledge_entry_versions')
      .select('version, title, content, created_at, note')
      .eq('knowledge_entry_id', entryId)
      .order('version', { ascending: false });
    if (error) throw new Error(`list entry versions: ${error.message}`);
    return (data ?? []).map((r) => {
      const row = r as Row;
      return {
        version: Number(row.version),
        title: String(row.title),
        content: (row.content as string | null) ?? null,
        createdAt: String(row.created_at),
        note: (row.note as string | null) ?? null,
      };
    });
  }

  async softDelete(id: string, reason?: string): Promise<void> {
    const current = await this.getById(id);
    if (!current) return;
    const { data: userData } = await this.db.auth.getUser();
    const { error } = await this.db
      .from('knowledge_entries')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(`delete entry: ${error.message}`);
    await this.db.from('deletion_log').insert({
      workspace_id: current.workspaceId,
      user_id: userData.user?.id,
      entity_type: 'knowledge_entry',
      entity_id: id,
      snapshot: current as unknown as Row,
      reason: reason ?? null,
    });
  }
}

class SupabaseActions implements ActionRepository {
  constructor(private readonly db: SupabaseClient) {}

  async listForTopic(topicId: string, kinds?: Action['kind'][]): Promise<Action[]> {
    let sel = this.db
      .from('actions')
      .select('*')
      .eq('topic_id', topicId)
      .is('deleted_at', null)
      .order('position');
    if (kinds?.length) sel = sel.in('kind', kinds);
    const { data, error } = await sel;
    if (error) throw new Error(`list actions: ${error.message}`);
    return (data ?? []).map((r) => map.toAction(r as Row));
  }

  async create(input: {
    topicId: string;
    subtopicId?: string | null;
    kind: Action['kind'];
    title: string;
    detail?: string | null;
  }): Promise<Action> {
    const { data: userData } = await this.db.auth.getUser();
    if (!userData.user) throw new Error('not signed in');
    const { data: topicRow, error: topicErr } = await this.db
      .from('topics')
      .select('workspace_id')
      .eq('id', input.topicId)
      .single();
    if (topicErr) throw new Error(`create action: ${topicErr.message}`);

    const row = unwrap(
      await this.db
        .from('actions')
        .insert({
          workspace_id: (topicRow as Row).workspace_id,
          topic_id: input.topicId,
          subtopic_id: input.subtopicId ?? null,
          user_id: userData.user.id,
          kind: input.kind,
          title: input.title.trim(),
          detail: input.detail ?? null,
        })
        .select('*')
        .single(),
      'create action',
    );
    return map.toAction(row as Row);
  }

  async setStatus(id: string, status: Action['status']): Promise<Action> {
    const row = unwrap(
      await this.db
        .from('actions')
        .update({
          status,
          resolved_at: status === 'done' || status === 'dropped' ? new Date().toISOString() : null,
        })
        .eq('id', id)
        .select('*')
        .single(),
      'update action',
    );
    return map.toAction(row as Row);
  }
}

// --- Phase 2/3 surfaces: reads work today (the Topic page needs them);
// --- writes are gated rather than faked.

class SupabaseDecisions implements DecisionRepository {
  constructor(private readonly db: SupabaseClient) {}
  async listForTopic(topicId: string): Promise<Decision[]> {
    const { data, error } = await this.db
      .from('decisions')
      .select('*')
      .eq('topic_id', topicId)
      .is('deleted_at', null)
      .order('decided_at', { ascending: false });
    if (error) throw new Error(`list decisions: ${error.message}`);
    return (data ?? []).map((r) => map.toDecision(r as Row));
  }
  async create(): Promise<Decision> {
    throw new NotYetImplemented('Creating decisions', 2);
  }
  async supersede(): Promise<void> {
    throw new NotYetImplemented('Superseding decisions', 2);
  }
}

class SupabaseIdeas implements IdeaRepository {
  constructor(private readonly db: SupabaseClient) {}
  async listForTopic(topicId: string): Promise<Idea[]> {
    const { data, error } = await this.db
      .from('ideas')
      .select('*')
      .eq('topic_id', topicId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`list ideas: ${error.message}`);
    return (data ?? []).map((r) => map.toIdea(r as Row));
  }
  async create(): Promise<Idea> {
    throw new NotYetImplemented('Creating ideas', 2);
  }
  async setStatus(): Promise<Idea> {
    throw new NotYetImplemented('Idea lifecycle changes', 2);
  }
}

class SupabasePrompts implements PromptRepository {
  constructor(private readonly db: SupabaseClient) {}
  async listForTopic(topicId: string): Promise<Array<{ prompt: Prompt; current: PromptVersion | null }>> {
    const { data, error } = await this.db
      .from('prompts')
      .select('*, prompt_versions(*)')
      .eq('topic_id', topicId)
      .is('deleted_at', null);
    if (error) throw new Error(`list prompts: ${error.message}`);
    return (data ?? []).map((r) => {
      const row = r as Row;
      const versions = Array.isArray(row.prompt_versions)
        ? (row.prompt_versions as Row[]).map(map.toPromptVersion).sort((a, b) => b.version - a.version)
        : [];
      return { prompt: map.toPrompt(row), current: versions[0] ?? null };
    });
  }
  async getWithVersions(id: string): Promise<{ prompt: Prompt; versions: PromptVersion[] } | null> {
    const { data, error } = await this.db
      .from('prompts')
      .select('*, prompt_versions(*)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`get prompt: ${error.message}`);
    if (!data) return null;
    const row = data as unknown as Row;
    const versions = Array.isArray(row.prompt_versions)
      ? (row.prompt_versions as Row[]).map(map.toPromptVersion).sort((a, b) => b.version - a.version)
      : [];
    return { prompt: map.toPrompt(row), versions };
  }
  async create(): Promise<{ prompt: Prompt; version: PromptVersion }> {
    throw new NotYetImplemented('Creating prompts', 2);
  }
  async addVersion(): Promise<PromptVersion> {
    throw new NotYetImplemented('Prompt versioning', 2);
  }
  async rateVersion(): Promise<PromptVersion> {
    throw new NotYetImplemented('Prompt rating', 2);
  }
  async markWinning(): Promise<void> {
    throw new NotYetImplemented('Marking winning prompts', 2);
  }
}

class SupabaseFiles implements FileRepository {
  constructor(private readonly db: SupabaseClient) {}
  async listForTopic(topicId: string): Promise<FileReference[]> {
    const { data, error } = await this.db
      .from('file_references')
      .select('*')
      .eq('topic_id', topicId)
      .is('deleted_at', null);
    if (error) throw new Error(`list files: ${error.message}`);
    return (data ?? []).map((r) => map.toFileReference(r as Row));
  }
  async create(): Promise<FileReference> {
    throw new NotYetImplemented('File references', 3);
  }
}

class SupabaseSessions implements SourceSessionRepository {
  constructor(private readonly db: SupabaseClient) {}
  async listForTopic(topicId: string): Promise<SourceSession[]> {
    const { data, error } = await this.db
      .from('source_sessions')
      .select('*')
      .eq('topic_id', topicId)
      .order('occurred_at', { ascending: false });
    if (error) throw new Error(`list sessions: ${error.message}`);
    return (data ?? []).map((r) => map.toSourceSession(r as Row));
  }
  async getById(id: string): Promise<SourceSession | null> {
    const { data, error } = await this.db.from('source_sessions').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`get session: ${error.message}`);
    return data ? map.toSourceSession(data as unknown as Row) : null;
  }
  async create(): Promise<SourceSession> {
    throw new NotYetImplemented('Recording source sessions', 3);
  }
}

class SupabaseInbox implements InboxRepository {
  constructor(private readonly db: SupabaseClient) {}
  async list(workspaceId: string, status?: IngestionRecord['status']): Promise<IngestionRecord[]> {
    let sel = this.db
      .from('ingestion_records')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    if (status) sel = sel.eq('status', status);
    const { data, error } = await sel;
    if (error) throw new Error(`list inbox: ${error.message}`);
    return (data ?? []).map((r) => map.toIngestionRecord(r as Row));
  }
  async capture(): Promise<IngestionRecord> {
    throw new NotYetImplemented('Inbox capture', 3);
  }
  async assign(): Promise<IngestionRecord> {
    throw new NotYetImplemented('Inbox triage', 3);
  }
  async discard(): Promise<void> {
    throw new NotYetImplemented('Inbox triage', 3);
  }
}

/**
 * The knowledge graph (AD-7).
 *
 * Reads resolve the far side of every edge so the UI can render a link without
 * a query per row. Most record types are already resolved by `timeline_events`
 * — reusing it means one projection defines "what is this record called" for
 * both the Timeline and the graph, instead of two lists that drift. Topics,
 * subtopics, and prompt heads are not timeline events, so they resolve directly.
 */
class SupabaseRelationships implements RelationshipRepository {
  constructor(private readonly db: SupabaseClient) {}

  async listFor(entityType: EntityType, entityId: string): Promise<RelatedRecord[]> {
    const { data, error } = await this.db
      .from('relationships')
      .select('*')
      .or(
        `and(from_type.eq.${entityType},from_id.eq.${entityId}),` +
          `and(to_type.eq.${entityType},to_id.eq.${entityId})`,
      )
      .order('created_at', { ascending: false });
    if (error) throw new Error(`list relationships: ${error.message}`);

    const edges = (data ?? []).map((r) => map.toRelationship(r as Row));
    if (!edges.length) return [];

    const wanted = edges.map((e) =>
      e.fromType === entityType && e.fromId === entityId
        ? { type: e.toType, id: e.toId, direction: 'outgoing' as const, edge: e }
        : { type: e.fromType, id: e.fromId, direction: 'incoming' as const, edge: e },
    );
    const ids = [...new Set(wanted.map((w) => w.id))];

    const labels = new Map<string, { title: string; status: string | null }>();
    const absorb = (
      rows: Row[] | null,
      title: (r: Row) => string,
      status: (r: Row) => string | null,
    ) => {
      for (const r of rows ?? []) {
        const id = typeof r.id === 'string' ? r.id : null;
        if (id && !labels.has(id)) labels.set(id, { title: title(r), status: status(r) });
      }
    };

    const [tl, topics, subtopics, prompts] = await Promise.all([
      this.db.from('timeline_events').select('id, title, status').in('id', ids),
      this.db.from('topics').select('id, name, status').in('id', ids).is('deleted_at', null),
      this.db.from('subtopics').select('id, name, status').in('id', ids).is('deleted_at', null),
      this.db.from('prompts').select('id, title, is_winning').in('id', ids).is('deleted_at', null),
    ]);
    const s2 = (v: unknown) => (v == null ? null : String(v));
    absorb(tl.data as Row[] | null, (r) => String(r.title ?? ''), (r) => s2(r.status));
    absorb(topics.data as Row[] | null, (r) => String(r.name ?? ''), (r) => s2(r.status));
    absorb(subtopics.data as Row[] | null, (r) => String(r.name ?? ''), (r) => s2(r.status));
    absorb(prompts.data as Row[] | null, (r) => String(r.title ?? ''), (r) => (r.is_winning ? 'winning' : null));

    return wanted.map((w) => {
      // An edge can outlive the record it points at: a soft delete leaves the
      // relationship in place. Say so rather than rendering a blank row.
      const label = labels.get(w.id);
      return {
        relationshipId: w.edge.id,
        relationshipType: w.edge.relationshipType,
        direction: w.direction,
        entityType: w.type,
        entityId: w.id,
        title: label?.title || '(deleted or unavailable)',
        status: label?.status ?? null,
        note: w.edge.note,
        createdAt: w.edge.createdAt,
      };
    });
  }

  async link(input: {
    fromType: EntityType;
    fromId: string;
    relationshipType: Relationship['relationshipType'];
    toType: EntityType;
    toId: string;
    note?: string | null;
  }): Promise<Relationship> {
    const { data: userData } = await this.db.auth.getUser();
    if (!userData.user) throw new Error('not signed in');
    if (input.fromType === input.toType && input.fromId === input.toId) {
      throw new Error('A record cannot be related to itself.');
    }
    if (input.relationshipType === 'supersedes') {
      // Supersession is owned by supersede_decision() / supersede_entry(),
      // which set the authoritative FK and write this edge themselves. Creating
      // one here would produce an edge with no matching FK behind it.
      throw new Error('Supersession is recorded by superseding, not by linking.');
    }

    const workspaceId = await this.workspaceOf(input.fromType, input.fromId);
    const row = unwrap(
      await this.db
        .from('relationships')
        .insert({
          workspace_id: workspaceId,
          user_id: userData.user.id,
          from_type: input.fromType,
          from_id: input.fromId,
          relationship_type: input.relationshipType,
          to_type: input.toType,
          to_id: input.toId,
          note: input.note ?? null,
        })
        .select('*')
        .single(),
      'create relationship',
    );
    return map.toRelationship(row);
  }

  async unlink(relationshipId: string): Promise<void> {
    // An edge is an assertion about two other records, not history in its own
    // right, so a wrong one is removed rather than tombstoned. Both endpoints
    // are untouched.
    const { error } = await this.db.from('relationships').delete().eq('id', relationshipId);
    if (error) throw new Error(`remove relationship: ${error.message}`);
  }

  /** The workspace a record belongs to, so the edge is scoped like its endpoints. */
  private async workspaceOf(type: EntityType, id: string): Promise<string> {
    const table: Partial<Record<EntityType, string>> = {
      topic: 'topics',
      subtopic: 'subtopics',
      knowledge_entry: 'knowledge_entries',
      decision: 'decisions',
      idea: 'ideas',
      prompt: 'prompts',
      prompt_version: 'prompt_versions',
      file_reference: 'file_references',
      action: 'actions',
      milestone: 'milestones',
      source_session: 'source_sessions',
    };
    const from = table[type];
    if (!from) throw new Error(`unknown entity type ${type}`);
    const { data, error } = await this.db.from(from).select('workspace_id').eq('id', id).single();
    if (error) throw new Error(`resolve workspace: ${error.message}`);
    return String((data as Row).workspace_id);
  }
}

// ---------------------------------------------------------------------------

export function createDataContext(db: SupabaseClient): DataContext {
  return {
    auth: new SupabaseAuth(db),
    workspaces: new SupabaseWorkspaces(db),
    topics: new SupabaseTopics(db),
    subtopics: new SupabaseSubtopics(db),
    knowledge: new SupabaseKnowledge(db),
    decisions: new SupabaseDecisions(db),
    ideas: new SupabaseIdeas(db),
    prompts: new SupabasePrompts(db),
    actions: new SupabaseActions(db),
    files: new SupabaseFiles(db),
    sessions: new SupabaseSessions(db),
    inbox: new SupabaseInbox(db),
    relationships: new SupabaseRelationships(db),
  };
}

export type { Milestone };
