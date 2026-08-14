-- ContextShelf — Phase 2 (Memory)
--
-- Additive only. This migration drops nothing and rewrites
-- no existing row; the one table it adds did not exist. Phase 0 already
-- modelled decisions, ideas, prompts,
-- prompt_versions, relationships, and context_snapshots, and Phase 1 applied
-- them. What was missing was three decision states, the integrity that makes
-- CLAUDE.md rule 7 a database guarantee rather than a convention, and a
-- projection to read the Timeline from.
--
-- Contents:
--   1. decision_status gains 'proposed', 'rejected', 'archived'
--   2. supersede_decision() — transactional, reason mandatory
--   3. A CHECK so a superseded decision cannot exist without its reason
--   4. prompt_version_outcomes — append-only ratings, so rule 6 stands
--   5. prompt_winning_selections — which exact version won, append-only
--   6. timeline_events — a security_invoker view over eight record types
--   7. Indexes for timeline ordering
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
-- 4. prompt_version_outcomes — how a version performed
--
-- Phase 0 gave prompt_versions result/rating/notes columns, but Phase 1 gave
-- the table SELECT and INSERT policies only, so those columns can be written
-- once and never revised. Whether a prompt worked is learned after its body is
-- written, and a rating is exactly the kind of judgement that gets corrected
-- later, so the columns as they stand cannot carry the feature.
--
-- Rule 6 is not weakened to make room. This table is append-only on the same
-- terms: SELECT and INSERT policies, no UPDATE, no DELETE. Re-rating a version
-- appends a row, so "I first thought it worked, then found it only partly did"
-- survives as history rather than overwriting the earlier judgement — which is
-- the same reason decisions are superseded rather than edited.
--
-- On sources of truth: the effective outcome is ALWAYS the highest-seq row here.
-- There is no fallback to the columns on prompt_versions, because a rule of the
-- form "this column unless that table has a row" is the ambiguity this design
-- exists to avoid. The application seeds an outcome row whenever it creates a
-- version, so the table is complete. The legacy columns are left in place for
-- rows written before this migration and are not read.
-- ---------------------------------------------------------------------------

-- Needed for the composite foreign key below (AD-11).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'prompt_versions'::regclass and conname = 'prompt_versions_id_workspace_uk'
  ) then
    alter table prompt_versions add constraint prompt_versions_id_workspace_uk unique (id, workspace_id);
  end if;
end $$;

create table if not exists prompt_version_outcomes (
  id                 uuid primary key default gen_random_uuid(),
  -- Ordering is by seq, never by created_at. now() is fixed for the whole
  -- transaction, so two outcomes recorded together carry identical timestamps
  -- and "newest" would fall back to comparing random uuids. A monotonic
  -- sequence is also immune to clock skew between writers.
  seq                bigint generated always as identity,
  prompt_version_id  uuid not null,
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  user_id            uuid references auth.users(id) on delete set null,
  result             prompt_result not null,
  rating             smallint check (rating is null or (rating >= 1 and rating <= 5)),
  notes              text,
  output_summary     text,
  created_at         timestamptz not null default now(),
  -- AD-11: the row's own workspace_id must match the version's, or a member of
  -- workspace B could attach an outcome to a version in workspace A and the
  -- with-check would still pass.
  constraint prompt_version_outcomes_version_fk
    foreign key (prompt_version_id, workspace_id)
    references prompt_versions (id, workspace_id) on delete cascade
);

create index if not exists prompt_version_outcomes_version_idx
  on prompt_version_outcomes (prompt_version_id, seq desc);
create index if not exists prompt_version_outcomes_workspace_idx
  on prompt_version_outcomes (workspace_id, created_at desc);

alter table prompt_version_outcomes enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'prompt_version_outcomes' and policyname = 'prompt_version_outcomes_read') then
    create policy prompt_version_outcomes_read on prompt_version_outcomes
      for select using (is_workspace_member(workspace_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'prompt_version_outcomes' and policyname = 'prompt_version_outcomes_insert') then
    create policy prompt_version_outcomes_insert on prompt_version_outcomes
      for insert with check (is_workspace_member(workspace_id));
  end if;
end $$;

-- No UPDATE or DELETE policy, and none granted: append-only, like the two
-- history tables rule 6 names.
grant select, insert on prompt_version_outcomes to authenticated, service_role;
revoke update, delete on prompt_version_outcomes from authenticated, service_role;
revoke all on prompt_version_outcomes from anon;

/** The current outcome of every version: the newest row, one per version. */
create or replace view prompt_version_current_outcome with (security_invoker = true) as
  select distinct on (o.prompt_version_id)
    o.prompt_version_id,
    o.workspace_id,
    o.result,
    o.rating,
    o.notes,
    o.output_summary,
    o.created_at,
    o.seq
  from prompt_version_outcomes o
  order by o.prompt_version_id, o.seq desc;

grant select on prompt_version_current_outcome to authenticated, service_role;
revoke all on prompt_version_current_outcome from anon;

-- ---------------------------------------------------------------------------
-- 5. prompt_winning_selections — which exact version won
--
-- prompts.is_winning marks a prompt, which cannot answer "which prompt text
-- produced the best result" once a prompt has several versions. The winner is a
-- property of a version, and which version is winning changes over time.
--
-- Same shape as outcomes, for the same reasons: append-only, ordered by an
-- identity sequence rather than a timestamp, newest row wins. Changing the
-- winner appends; the earlier selection stays readable, so "we used to think v2
-- was best, then v4 beat it" is recoverable. A row with a null
-- prompt_version_id records that a prompt no longer has a winner, so clearing
-- is history too rather than a silent gap.
--
-- Source of truth: the highest-seq row here, exposed as
-- prompt_current_winning. prompts.is_winning is kept in step by a trigger and
-- is strictly derived — never written directly, and safe to read only as
-- "does this prompt have a winner".
-- ---------------------------------------------------------------------------

create table if not exists prompt_winning_selections (
  id                 uuid primary key default gen_random_uuid(),
  seq                bigint generated always as identity,
  prompt_id          uuid not null,
  -- Null means "cleared": the prompt has no winning version from here on.
  prompt_version_id  uuid,
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  user_id            uuid references auth.users(id) on delete set null,
  reason             text,
  created_at         timestamptz not null default now(),
  constraint prompt_winning_selections_prompt_fk
    foreign key (prompt_id, workspace_id)
    references prompts (id, workspace_id) on delete cascade,
  constraint prompt_winning_selections_version_fk
    foreign key (prompt_version_id, workspace_id)
    references prompt_versions (id, workspace_id) on delete cascade
);

create index if not exists prompt_winning_selections_prompt_idx
  on prompt_winning_selections (prompt_id, seq desc);
create index if not exists prompt_winning_selections_workspace_idx
  on prompt_winning_selections (workspace_id, seq desc);

/** A winning version must belong to the prompt it is declared to win. */
create or replace function prompt_winning_selection_valid()
returns trigger language plpgsql as $$
begin
  if new.prompt_version_id is not null then
    if not exists (
      select 1 from prompt_versions v
      where v.id = new.prompt_version_id and v.prompt_id = new.prompt_id
    ) then
      raise exception 'version % does not belong to prompt %', new.prompt_version_id, new.prompt_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists prompt_winning_selection_valid_trg on prompt_winning_selections;
create trigger prompt_winning_selection_valid_trg
  before insert on prompt_winning_selections
  for each row execute function prompt_winning_selection_valid();

/**
 * Keeps prompts.is_winning derived rather than independently written.
 *
 * Without this the column would drift from the selections table and the two
 * would disagree about the same fact.
 */
create or replace function prompt_winning_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update prompts
     set is_winning = (new.prompt_version_id is not null)
   where id = new.prompt_id;
  return new;
end $$;

drop trigger if exists prompt_winning_sync_trg on prompt_winning_selections;
create trigger prompt_winning_sync_trg
  after insert on prompt_winning_selections
  for each row execute function prompt_winning_sync();

alter table prompt_winning_selections enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='prompt_winning_selections' and policyname='prompt_winning_selections_read') then
    create policy prompt_winning_selections_read on prompt_winning_selections
      for select using (is_workspace_member(workspace_id));
  end if;
  if not exists (select 1 from pg_policies where tablename='prompt_winning_selections' and policyname='prompt_winning_selections_insert') then
    create policy prompt_winning_selections_insert on prompt_winning_selections
      for insert with check (is_workspace_member(workspace_id));
  end if;
end $$;

grant select, insert on prompt_winning_selections to authenticated, service_role;
revoke update, delete on prompt_winning_selections from authenticated, service_role;
revoke all on prompt_winning_selections from anon;

/** The current winning version of every prompt, with its body. */
create or replace view prompt_current_winning with (security_invoker = true) as
  select
    w.prompt_id,
    w.workspace_id,
    w.prompt_version_id,
    v.version        as winning_version,
    v.body           as winning_body,
    w.reason,
    w.created_at     as selected_at
  from (
    select distinct on (s.prompt_id) s.*
    from prompt_winning_selections s
    order by s.prompt_id, s.seq desc
  ) w
  left join prompt_versions v on v.id = w.prompt_version_id
  where w.prompt_version_id is not null;

grant select on prompt_current_winning to authenticated, service_role;
revoke all on prompt_current_winning from anon;

-- ---------------------------------------------------------------------------
-- 6. timeline_events
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
    case when cw.prompt_version_id = pv.id then 'winning_prompt' else 'prompt' end,
    p.title || ' (v' || pv.version || ')',
    coalesce(o.output_summary, pv.output_summary, o.notes, pv.notes, left(pv.body, 280)),
    p.source_type,
    coalesce(o.result, pv.result)::text,
    null::uuid,
    pv.created_at,
    pv.created_at
  from prompt_versions pv
  join prompts p on p.id = pv.prompt_id
  left join prompt_version_current_outcome o on o.prompt_version_id = pv.id
  left join prompt_current_winning cw on cw.prompt_id = p.id
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
-- 7. Indexes for the projection
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
