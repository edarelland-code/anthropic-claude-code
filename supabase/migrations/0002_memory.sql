-- ContextShelf — Phase 2 (Memory)
--
-- Additive only. This migration creates no table, drops nothing, and rewrites
-- no existing row: Phase 0 already modelled decisions, ideas, prompts,
-- prompt_versions, relationships, and context_snapshots, and Phase 1 applied
-- them. What was missing was three decision states, the integrity that makes
-- CLAUDE.md rule 7 a database guarantee rather than a convention, and a
-- projection to read the Timeline from.
--
-- Contents:
--   1. decision_status gains 'proposed', 'rejected', 'archived'
--   2. supersede_decision() — transactional, reason mandatory
--   3. A CHECK so a superseded decision cannot exist without its reason
--   4. timeline_events — a security_invoker view over eight record types
--   5. Indexes for timeline ordering
--
-- Safe to run against a database holding production data. Every statement is
-- guarded (IF NOT EXISTS / CREATE OR REPLACE) so re-running is a no-op.

-- ---------------------------------------------------------------------------
-- 1. Decision states
--
-- The Phase 0 enum had active/superseded/reversed/deprecated. The Decision
-- Ledger needs a state before a decision is settled ('proposed'), a state for a
-- direction that was considered and turned down ('rejected' — distinct from
-- superseded, which means "replaced by a newer decision"), and a terminal
-- filing state ('archived').
--
-- 'reversed' is kept rather than removed. Dropping an enum value is destructive
-- and would break any row already using it; rule 5 says nothing is ever
-- destroyed. It stays as a legacy value that new writes do not produce.
-- ---------------------------------------------------------------------------

alter type decision_status add value if not exists 'proposed';
alter type decision_status add value if not exists 'rejected';
alter type decision_status add value if not exists 'archived';

-- ---------------------------------------------------------------------------
-- 2 & 3. Supersession integrity for decisions
--
-- knowledge_entries got this in Phase 1 via supersede_entry(). Decisions had
-- the columns but neither a function nor a constraint, so nothing stopped a
-- decision being superseded with a null reason — the exact failure rule 7
-- exists to prevent, and the one that makes "why did we change our mind"
-- unanswerable later.
-- ---------------------------------------------------------------------------

-- Existing rows are not rewritten. If any superseded decision predates this
-- constraint and lacks a reason, NOT VALID lets the constraint bind all future
-- writes without failing the migration; the row is then visible for repair
-- rather than silently blocking deployment.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'decisions'::regclass and conname = 'decisions_supersede_reason_required'
  ) then
    alter table decisions
      add constraint decisions_supersede_reason_required
      check (superseded_by_id is null or btrim(coalesce(supersede_reason, '')) <> '')
      not valid;
  end if;
end $$;

-- Validate separately: it succeeds when no offending row exists, and leaves the
-- constraint enforcing new writes either way.
do $$
begin
  alter table decisions validate constraint decisions_supersede_reason_required;
exception
  when check_violation then
    raise notice 'decisions_supersede_reason_required left NOT VALID: pre-existing rows lack a reason';
end $$;

/**
 * Replace one decision with another, preserving both.
 *
 * Mirrors supersede_entry(): security invoker, so RLS decides what the caller
 * may touch; transactional, so there is no window in which both decisions are
 * active; and it refuses to run without a reason.
 *
 * Both decisions must already exist — this links, it does not create. That
 * differs from supersede_entry(), which creates the replacement, because a
 * decision carries fields (alternatives, approved_direction) that cannot be
 * derived from the row it replaces.
 */
-- Parameters carry a p_ prefix because `decisions` has its own `reason`
-- column: an unprefixed parameter makes `supersede_reason = reason` ambiguous
-- and the function fails at run time, not at creation. supersede_entry() never
-- hit this because knowledge_entries has no column of that name.
--
-- Dropped first so a later change to a parameter NAME re-applies cleanly;
-- CREATE OR REPLACE cannot rename parameters.
drop function if exists supersede_decision(uuid, uuid, text);
create function supersede_decision(
  p_old_decision_id uuid,
  p_new_decision_id uuid,
  p_reason text
) returns void language plpgsql security invoker as $$
declare
  old_row decisions%rowtype;
  new_row decisions%rowtype;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    -- CLAUDE.md rule 7: "why did we change our mind" is the product.
    raise exception 'a supersede reason is required';
  end if;

  if p_old_decision_id = p_new_decision_id then
    raise exception 'a decision cannot supersede itself';
  end if;

  select * into old_row from decisions where id = p_old_decision_id for update;
  if not found then
    raise exception 'decision % not found', p_old_decision_id;
  end if;

  select * into new_row from decisions where id = p_new_decision_id for update;
  if not found then
    raise exception 'decision % not found', p_new_decision_id;
  end if;

  -- Crossing workspaces here would let a decision in one workspace point at a
  -- row in another, which RLS on the individual tables would not catch.
  if old_row.workspace_id <> new_row.workspace_id then
    raise exception 'decisions belong to different workspaces';
  end if;

  if old_row.superseded_by_id is not null then
    raise exception 'decision % is already superseded', p_old_decision_id;
  end if;

  update decisions
     set status = 'superseded',
         superseded_by_id = p_new_decision_id,
         supersede_reason = p_reason
   where id = p_old_decision_id;

  update decisions
     set status = 'active'
   where id = p_new_decision_id
     and status = 'proposed';

  -- The FK above is authoritative for status. This row makes the same fact
  -- reachable from the relationship graph (AD-7), matching what
  -- supersede_entry() already does for knowledge entries.
  insert into relationships (
    workspace_id, user_id, from_type, from_id, relationship_type, to_type, to_id, note
  ) values (
    old_row.workspace_id, auth.uid(), 'decision', p_new_decision_id,
    'supersedes', 'decision', p_old_decision_id, p_reason
  ) on conflict do nothing;

  update topics set last_meaningful_update_at = now() where id = old_row.topic_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4. timeline_events
--
-- The Timeline is a projection, never a store. A materialised copy would be a
-- second source of truth and would drift from the rows it summarises; this view
-- cannot, because it holds nothing.
--
-- security_invoker = true is load-bearing. A view runs as its OWNER by default,
-- which would read straight past the row-level security on every table below
-- and expose one workspace's history to another. With it set, each underlying
-- table's policy is evaluated as the caller. supabase/tests/04_timeline.test.sql
-- asserts this rather than trusting it.
--
-- subtopic_ids is an array because a knowledge entry can belong to several
-- subtopics through entry_subtopics, while the other record types carry a
-- single nullable subtopic_id. Filtering is `$1 = any(subtopic_ids)` for all of
-- them, so callers do not special-case entries.
--
-- Soft-deleted rows are excluded. They remain recoverable through deletion_log
-- (rule 5); the Timeline shows what exists, not what was withdrawn.
-- ---------------------------------------------------------------------------

create or replace view timeline_events with (security_invoker = true) as

  -- Knowledge entries
  select
    e.id,
    e.workspace_id,
    e.topic_id,
    coalesce(
      (select array_agg(es.subtopic_id) from entry_subtopics es where es.knowledge_entry_id = e.id),
      '{}'::uuid[]
    )                                             as subtopic_ids,
    'knowledge_entry'::entity_type                as entity_type,
    e.knowledge_type::text                        as kind,
    e.title,
    e.content                                     as summary,
    e.source_type,
    e.status::text                                as status,
    e.superseded_by_id,
    e.occurred_at                                 as occurred_at,
    e.created_at
  from knowledge_entries e
  where e.deleted_at is null

  union all

  -- Decisions
  select
    d.id, d.workspace_id, d.topic_id,
    case when d.subtopic_id is null then '{}'::uuid[] else array[d.subtopic_id] end,
    'decision'::entity_type,
    'decision',
    d.title,
    coalesce(d.decision, d.reason),
    d.source_type,
    d.status::text,
    d.superseded_by_id,
    d.decided_at,
    d.created_at
  from decisions d
  where d.deleted_at is null

  union all

  -- Ideas
  select
    i.id, i.workspace_id, i.topic_id,
    case when i.subtopic_id is null then '{}'::uuid[] else array[i.subtopic_id] end,
    'idea'::entity_type,
    'idea',
    i.title,
    coalesce(i.idea, i.rationale),
    i.source_type,
    i.status::text,
    null::uuid,
    i.created_at,
    i.created_at
  from ideas i
  where i.deleted_at is null

  union all

  -- Prompt versions. Every version is an event: "which prompt worked, and
  -- when" is unanswerable if only the current one appears.
  select
    pv.id, pv.workspace_id, p.topic_id,
    case when p.subtopic_id is null then '{}'::uuid[] else array[p.subtopic_id] end,
    'prompt_version'::entity_type,
    case when p.is_winning and p.current_version_id = pv.id then 'winning_prompt' else 'prompt' end,
    p.title || ' (v' || pv.version || ')',
    coalesce(pv.output_summary, pv.notes, left(pv.body, 280)),
    p.source_type,
    pv.result::text,
    null::uuid,
    pv.created_at,
    pv.created_at
  from prompt_versions pv
  join prompts p on p.id = pv.prompt_id
  where p.deleted_at is null

  union all

  -- Actions: next steps, blockers, questions
  select
    a.id, a.workspace_id, a.topic_id,
    case when a.subtopic_id is null then '{}'::uuid[] else array[a.subtopic_id] end,
    'action'::entity_type,
    a.kind::text,
    a.title,
    a.detail,
    null::source_type,
    a.status::text,
    null::uuid,
    a.created_at,
    a.created_at
  from actions a
  where a.deleted_at is null

  union all

  -- Milestones
  select
    m.id, m.workspace_id, m.topic_id, '{}'::uuid[],
    'milestone'::entity_type,
    'milestone',
    m.title,
    m.detail,
    null::source_type,
    coalesce(m.status, 'achieved'),
    null::uuid,
    coalesce(m.achieved_at, m.created_at),
    m.created_at
  from milestones m
  where m.deleted_at is null

  union all

  -- Files and references
  select
    f.id, f.workspace_id, f.topic_id,
    case when f.subtopic_id is null then '{}'::uuid[] else array[f.subtopic_id] end,
    'file_reference'::entity_type,
    f.kind::text,
    coalesce(f.display_name, f.path, f.url, 'file'),
    coalesce(f.path, f.url),
    null::source_type,
    'active',
    null::uuid,
    coalesce(f.last_seen_at, f.created_at),
    f.created_at
  from file_references f
  where f.deleted_at is null

  union all

  -- Source sessions: the Layer 1 evidence a topic's knowledge came from
  select
    s.id, s.workspace_id, s.topic_id, '{}'::uuid[],
    'source_session'::entity_type,
    'session',
    coalesce(s.title, 'Session'),
    s.summary,
    s.source_type,
    'active',
    null::uuid,
    s.occurred_at,
    s.created_at
  from source_sessions s
  where s.topic_id is not null;

comment on view timeline_events is
  'Chronological projection over every Phase 2 record type. security_invoker: RLS on the underlying tables is authoritative.';

-- 0001 granted on "all tables in schema public" before this view existed, so
-- it needs its own grant. anon stays revoked, as everywhere else.
grant select on timeline_events to authenticated, service_role;
revoke all on timeline_events from anon;

-- ---------------------------------------------------------------------------
-- 5. Indexes for the projection
--
-- knowledge_entries, decisions, and source_sessions already carry the
-- topic-scoped ordering indexes they need. These fill the gaps, and add the
-- workspace-scoped equivalents the cross-topic /timeline page reads.
-- ---------------------------------------------------------------------------

create index if not exists ideas_topic_created_idx
  on ideas (topic_id, created_at desc) where deleted_at is null;
create index if not exists ideas_workspace_created_idx
  on ideas (workspace_id, created_at desc) where deleted_at is null;

create index if not exists decisions_workspace_decided_idx
  on decisions (workspace_id, decided_at desc) where deleted_at is null;

create index if not exists actions_topic_created_idx
  on actions (topic_id, created_at desc) where deleted_at is null;
create index if not exists actions_workspace_created_idx
  on actions (workspace_id, created_at desc) where deleted_at is null;

create index if not exists milestones_topic_achieved_idx
  on milestones (topic_id, achieved_at desc) where deleted_at is null;
create index if not exists milestones_workspace_achieved_idx
  on milestones (workspace_id, achieved_at desc) where deleted_at is null;

create index if not exists file_references_topic_created_idx
  on file_references (topic_id, created_at desc) where deleted_at is null;

create index if not exists prompt_versions_created_idx
  on prompt_versions (prompt_id, created_at desc);
create index if not exists prompt_versions_workspace_created_idx
  on prompt_versions (workspace_id, created_at desc);

-- Supersession lookups run in both directions: "what replaced this" is the FK,
-- "what did this replace" is a scan without these.
create index if not exists decisions_superseded_by_idx
  on decisions (superseded_by_id) where superseded_by_id is not null;
create index if not exists knowledge_entries_superseded_by_idx
  on knowledge_entries (superseded_by_id) where superseded_by_id is not null;

-- The relationship graph is already indexed from both ends by 0001
-- (relationships_from_idx, relationships_to_idx); nothing to add here.
