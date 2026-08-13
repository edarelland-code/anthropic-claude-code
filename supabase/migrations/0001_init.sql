-- ContextShelf — initial schema
-- Phase 1 foundation. See docs/ARCHITECTURE.md §6 and docs/SCHEMA.md.
--
-- Invariants enforced here rather than in application code:
--   * updated_at is set by trigger, never by the client (clocks differ across devices)
--   * *_versions tables have no UPDATE/DELETE policy -> append-only, by construction
--   * deletes are soft (deleted_at) and tombstoned in deletion_log
--   * every table is deny-by-default under RLS and scoped by workspace membership

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type source_type as enum (
  'claude_chat', 'claude_cowork', 'claude_code', 'manual', 'file', 'url',
  'imported_transcript', 'api', 'mcp', 'browser_extension'
);

create type knowledge_type as enum (
  'progress', 'implementation', 'decision', 'idea', 'suggestion', 'prompt',
  'winning_prompt', 'failed_prompt', 'requirement', 'change', 'added', 'removed',
  'refactored', 'bug', 'fix', 'research', 'file', 'link', 'blocker', 'question',
  'next_step', 'milestone', 'rejected_idea', 'important_context'
);

create type entry_status as enum (
  'active', 'superseded', 'rejected', 'replaced', 'deprecated', 'archived'
);

create type topic_status as enum ('active', 'paused', 'blocked', 'completed', 'archived');
create type idea_status as enum ('suggested', 'considering', 'approved', 'implemented', 'deferred', 'rejected');
create type decision_status as enum ('active', 'superseded', 'reversed', 'deprecated');
create type prompt_result as enum ('untested', 'worked', 'partially_worked', 'failed', 'superseded');
create type action_kind as enum ('next_step', 'blocker', 'question');
create type action_status as enum ('open', 'in_progress', 'blocked', 'done', 'dropped');
create type ingestion_status as enum ('unsorted', 'classified', 'processed', 'discarded');
create type context_density as enum ('compact', 'standard', 'full_audit');
create type file_kind as enum ('repo_file', 'upload', 'url');

create type entity_type as enum (
  'topic', 'subtopic', 'knowledge_entry', 'decision', 'idea', 'prompt',
  'prompt_version', 'file_reference', 'action', 'milestone', 'source_session'
);

create type relationship_type as enum (
  'produced', 'resulted_in', 'supersedes', 'resolves', 'caused', 'belongs_to',
  'relates_to', 'duplicates', 'contradicts', 'implements', 'derived_from'
);

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Membership test used by every RLS policy. security definer so the policy on
-- workspace_members does not recurse into itself.
create or replace function is_workspace_member(ws uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Identity and containers
-- ---------------------------------------------------------------------------

create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  preferences  jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table workspaces (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  slug       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, slug)
);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'owner' check (role in ('owner', 'editor', 'viewer')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Organization: topics and subtopics
-- ---------------------------------------------------------------------------

create table topics (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  slug         text not null,
  description  text,
  goal         text,
  current_state text,
  status       topic_status not null default 'active',
  progress     smallint not null default 0 check (progress between 0 and 100),
  color        text,
  pinned       boolean not null default false,
  -- Implementation intention, used narrowly for resuming work (ARCHITECTURE §10)
  resume_trigger_if   text,
  resume_trigger_then text,
  -- Distinct from updated_at on purpose: renaming a topic is not progress.
  last_meaningful_update_at timestamptz not null default now(),
  archived_at  timestamptz,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table subtopics (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  topic_id     uuid not null references topics(id) on delete cascade,
  parent_subtopic_id uuid references subtopics(id) on delete set null,
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  slug         text not null,
  description  text,
  goal         text,
  current_state text,
  status       topic_status not null default 'active',
  position     integer not null default 0,
  resume_trigger_if   text,
  resume_trigger_then text,
  last_meaningful_update_at timestamptz not null default now(),
  archived_at  timestamptz,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (topic_id, slug)
);

-- Subtopic nesting must stay a tree.
create or replace function subtopics_no_cycle()
returns trigger language plpgsql as $$
declare
  cursor_id uuid := new.parent_subtopic_id;
  hops int := 0;
begin
  while cursor_id is not null loop
    if cursor_id = new.id then
      raise exception 'subtopic parent cycle detected';
    end if;
    hops := hops + 1;
    if hops > 32 then
      raise exception 'subtopic nesting too deep';
    end if;
    select parent_subtopic_id into cursor_id from subtopics where id = cursor_id;
  end loop;
  return new;
end;
$$;

create trigger subtopics_no_cycle_trg
  before insert or update of parent_subtopic_id on subtopics
  for each row execute function subtopics_no_cycle();

-- ---------------------------------------------------------------------------
-- Layer 1: raw source evidence. Written once, never edited.
-- ---------------------------------------------------------------------------

create table source_sessions (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  topic_id     uuid references topics(id) on delete set null,
  source_type  source_type not null,
  title        text,
  external_url text,
  occurred_at  timestamptz not null default now(),
  summary      text,
  raw_content  text,
  -- Claude Code specifics (Phase 5)
  repo_url     text,
  branch       text,
  commit_sha   text,
  files_changed jsonb not null default '[]'::jsonb,
  files_added   jsonb not null default '[]'::jsonb,
  files_removed jsonb not null default '[]'::jsonb,
  build_status  text,
  test_summary  text,
  artifacts     jsonb not null default '[]'::jsonb,
  metadata      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table session_subtopics (
  source_session_id uuid not null references source_sessions(id) on delete cascade,
  subtopic_id       uuid not null references subtopics(id) on delete cascade,
  primary key (source_session_id, subtopic_id)
);

-- ---------------------------------------------------------------------------
-- Layer 2: the knowledge atom
-- ---------------------------------------------------------------------------

create table knowledge_entries (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  topic_id     uuid not null references topics(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  knowledge_type knowledge_type not null,
  status       entry_status not null default 'active',
  title        text not null,
  content      text,
  source_type  source_type not null default 'manual',
  source_session_id uuid references source_sessions(id) on delete set null,
  source_reference  text,
  occurred_at  timestamptz not null default now(),
  superseded_by_id  uuid references knowledge_entries(id) on delete set null,
  supersedes_reason text,
  importance   smallint not null default 0 check (importance between 0 and 3),
  confidence   real,
  metadata     jsonb not null default '{}'::jsonb,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ) stored,
  constraint no_self_supersede check (superseded_by_id is null or superseded_by_id <> id)
);

create table entry_subtopics (
  knowledge_entry_id uuid not null references knowledge_entries(id) on delete cascade,
  subtopic_id        uuid not null references subtopics(id) on delete cascade,
  primary key (knowledge_entry_id, subtopic_id)
);

-- Append-only history of edited entry bodies. No UPDATE/DELETE policy below.
create table knowledge_entry_versions (
  id         uuid primary key default gen_random_uuid(),
  knowledge_entry_id uuid not null references knowledge_entries(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  version    integer not null,
  title      text not null,
  content    text,
  knowledge_type knowledge_type not null,
  status     entry_status not null,
  edited_by  uuid references auth.users(id) on delete set null,
  note       text,
  created_at timestamptz not null default now(),
  unique (knowledge_entry_id, version)
);

-- ---------------------------------------------------------------------------
-- First-class projections
-- ---------------------------------------------------------------------------

create table decisions (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  topic_id     uuid not null references topics(id) on delete cascade,
  subtopic_id  uuid references subtopics(id) on delete set null,
  user_id      uuid not null references auth.users(id) on delete cascade,
  knowledge_entry_id uuid references knowledge_entries(id) on delete set null,
  title        text not null,
  decision     text not null,
  reason       text,
  alternatives jsonb not null default '[]'::jsonb,
  approved_direction text,
  status       decision_status not null default 'active',
  decided_at   timestamptz not null default now(),
  superseded_by_id uuid references decisions(id) on delete set null,
  supersede_reason text,
  source_type  source_type not null default 'manual',
  source_session_id uuid references source_sessions(id) on delete set null,
  metadata     jsonb not null default '{}'::jsonb,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table ideas (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  topic_id     uuid not null references topics(id) on delete cascade,
  subtopic_id  uuid references subtopics(id) on delete set null,
  user_id      uuid not null references auth.users(id) on delete cascade,
  knowledge_entry_id uuid references knowledge_entries(id) on delete set null,
  title        text not null,
  idea         text,
  rationale    text,
  status       idea_status not null default 'suggested',
  decision_id  uuid references decisions(id) on delete set null,
  implementation_entry_id uuid references knowledge_entries(id) on delete set null,
  source_type  source_type not null default 'manual',
  source_session_id uuid references source_sessions(id) on delete set null,
  metadata     jsonb not null default '{}'::jsonb,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table prompts (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  topic_id     uuid not null references topics(id) on delete cascade,
  subtopic_id  uuid references subtopics(id) on delete set null,
  user_id      uuid not null references auth.users(id) on delete cascade,
  title        text not null,
  purpose      text,
  source_type  source_type not null default 'manual',
  current_version_id uuid,
  is_winning   boolean not null default false,
  metadata     jsonb not null default '{}'::jsonb,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Insert-only. A prompt is never overwritten; a new version is appended.
create table prompt_versions (
  id           uuid primary key default gen_random_uuid(),
  prompt_id    uuid not null references prompts(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  version      integer not null,
  body         text not null,
  result       prompt_result not null default 'untested',
  rating       smallint check (rating between 1 and 5),
  notes        text,
  output_summary text,
  related_entry_id uuid references knowledge_entries(id) on delete set null,
  source_session_id uuid references source_sessions(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (prompt_id, version)
);

alter table prompts
  add constraint prompts_current_version_fk
  foreign key (current_version_id) references prompt_versions(id) on delete set null;

create table file_references (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  topic_id     uuid not null references topics(id) on delete cascade,
  subtopic_id  uuid references subtopics(id) on delete set null,
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         file_kind not null default 'repo_file',
  path         text,
  display_name text,
  url          text,
  storage_path text,
  repo_url     text,
  branch       text,
  commit_sha   text,
  source_session_id uuid references source_sessions(id) on delete set null,
  last_seen_at timestamptz,
  metadata     jsonb not null default '{}'::jsonb,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table actions (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  topic_id     uuid not null references topics(id) on delete cascade,
  subtopic_id  uuid references subtopics(id) on delete set null,
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         action_kind not null default 'next_step',
  status       action_status not null default 'open',
  title        text not null,
  detail       text,
  position     integer not null default 0,
  due_at       timestamptz,
  resolved_at  timestamptz,
  resolution_entry_id uuid references knowledge_entries(id) on delete set null,
  source_session_id uuid references source_sessions(id) on delete set null,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table milestones (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  topic_id     uuid not null references topics(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  title        text not null,
  detail       text,
  achieved_at  timestamptz,
  status       text not null default 'planned' check (status in ('planned', 'achieved', 'missed', 'dropped')),
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Cross-cutting
-- ---------------------------------------------------------------------------

create table relationships (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  from_type    entity_type not null,
  from_id      uuid not null,
  relationship_type relationship_type not null,
  to_type      entity_type not null,
  to_id        uuid not null,
  note         text,
  created_at   timestamptz not null default now(),
  unique (from_type, from_id, relationship_type, to_type, to_id)
);

create table tags (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null,
  color        text,
  created_at   timestamptz not null default now(),
  unique (workspace_id, name)
);

create table taggables (
  tag_id      uuid not null references tags(id) on delete cascade,
  entity_type entity_type not null,
  entity_id   uuid not null,
  created_at  timestamptz not null default now(),
  primary key (tag_id, entity_type, entity_id)
);

-- Derived Master Topic Memory. Regenerable; never the source of truth.
create table context_snapshots (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  topic_id     uuid not null references topics(id) on delete cascade,
  subtopic_id  uuid references subtopics(id) on delete set null,
  user_id      uuid not null references auth.users(id) on delete cascade,
  density      context_density not null default 'standard',
  target       text,
  body         text not null,
  inputs       jsonb not null default '{}'::jsonb,
  is_current   boolean not null default true,
  generated_at timestamptz not null default now()
);

-- The Inbox. Every path into the system lands here first.
create table ingestion_records (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  adapter_id   text,
  source_type  source_type not null default 'manual',
  content_type text not null default 'text',
  raw_content  text,
  payload      jsonb not null default '{}'::jsonb,
  source_hint  text,
  suggested_topic_id uuid references topics(id) on delete set null,
  topic_id     uuid references topics(id) on delete set null,
  subtopic_id  uuid references subtopics(id) on delete set null,
  status       ingestion_status not null default 'unsorted',
  error        text,
  created_source_session_id uuid references source_sessions(id) on delete set null,
  created_entry_ids uuid[] not null default '{}',
  processed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Bearer tokens for /api/ingest (Phase 5). Only the hash is stored.
create table ingestion_tokens (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  token_hash   text not null unique,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

-- Tombstones for soft-deleted rows, so deletion is recoverable.
create table deletion_log (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  entity_type  entity_type not null,
  entity_id    uuid not null,
  snapshot     jsonb not null,
  reason       text,
  restored_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Relationship integrity: no FK can span tables, so validate in a trigger.
-- ---------------------------------------------------------------------------

create or replace function entity_exists(et entity_type, eid uuid)
returns boolean language plpgsql stable as $$
declare found boolean;
begin
  execute format(
    'select exists (select 1 from %I where id = $1)',
    case et
      when 'topic' then 'topics'
      when 'subtopic' then 'subtopics'
      when 'knowledge_entry' then 'knowledge_entries'
      when 'decision' then 'decisions'
      when 'idea' then 'ideas'
      when 'prompt' then 'prompts'
      when 'prompt_version' then 'prompt_versions'
      when 'file_reference' then 'file_references'
      when 'action' then 'actions'
      when 'milestone' then 'milestones'
      when 'source_session' then 'source_sessions'
    end
  ) into found using eid;
  return found;
end;
$$;

create or replace function relationships_validate()
returns trigger language plpgsql as $$
begin
  if not entity_exists(new.from_type, new.from_id) then
    raise exception 'relationship source % % does not exist', new.from_type, new.from_id;
  end if;
  if not entity_exists(new.to_type, new.to_id) then
    raise exception 'relationship target % % does not exist', new.to_type, new.to_id;
  end if;
  return new;
end;
$$;

create trigger relationships_validate_trg
  before insert or update on relationships
  for each row execute function relationships_validate();

-- ---------------------------------------------------------------------------
-- Supersession: replace without destroying. One transaction, both sides linked.
-- ---------------------------------------------------------------------------

create or replace function supersede_entry(
  old_entry_id uuid,
  new_title text,
  new_content text,
  new_type knowledge_type,
  reason text
) returns uuid language plpgsql security invoker as $$
declare
  old_row knowledge_entries%rowtype;
  new_id uuid;
begin
  if reason is null or length(btrim(reason)) = 0 then
    -- CLAUDE.md rule 7: "why did we change our mind" is the product.
    raise exception 'a supersede reason is required';
  end if;

  select * into old_row from knowledge_entries where id = old_entry_id for update;
  if not found then
    raise exception 'entry % not found', old_entry_id;
  end if;

  insert into knowledge_entries (
    workspace_id, topic_id, user_id, knowledge_type, status, title, content,
    source_type, source_session_id, source_reference, importance, metadata
  ) values (
    old_row.workspace_id, old_row.topic_id, auth.uid(), new_type, 'active',
    new_title, new_content, old_row.source_type, old_row.source_session_id,
    old_row.source_reference, old_row.importance, old_row.metadata
  ) returning id into new_id;

  update knowledge_entries
     set status = 'superseded',
         superseded_by_id = new_id,
         supersedes_reason = reason
   where id = old_entry_id;

  insert into entry_subtopics (knowledge_entry_id, subtopic_id)
  select new_id, subtopic_id from entry_subtopics where knowledge_entry_id = old_entry_id;

  insert into relationships (workspace_id, user_id, from_type, from_id, relationship_type, to_type, to_id, note)
  values (old_row.workspace_id, auth.uid(), 'knowledge_entry', new_id, 'supersedes', 'knowledge_entry', old_entry_id, reason)
  on conflict do nothing;

  update topics set last_meaningful_update_at = now() where id = old_row.topic_id;

  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'workspaces', 'topics', 'subtopics', 'source_sessions',
    'knowledge_entries', 'decisions', 'ideas', 'prompts', 'file_references',
    'actions', 'milestones', 'ingestion_records'
  ] loop
    execute format(
      'create trigger %I_set_updated_at before update on %I
         for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index topics_workspace_idx on topics (workspace_id) where deleted_at is null;
create index topics_recent_idx on topics (workspace_id, last_meaningful_update_at desc);
create index subtopics_topic_idx on subtopics (topic_id) where deleted_at is null;
create index subtopics_parent_idx on subtopics (parent_subtopic_id);

create index entries_timeline_idx on knowledge_entries (topic_id, occurred_at desc) where deleted_at is null;
create index entries_current_idx on knowledge_entries (topic_id, knowledge_type)
  where status = 'active' and superseded_by_id is null and deleted_at is null;
create index entries_search_idx on knowledge_entries using gin (search_vector);
create index entries_session_idx on knowledge_entries (source_session_id);
create index entries_workspace_recent_idx on knowledge_entries (workspace_id, occurred_at desc);

create index sessions_topic_idx on source_sessions (topic_id, occurred_at desc);
create index sessions_source_idx on source_sessions (workspace_id, source_type, occurred_at desc);
create index sessions_raw_trgm_idx on source_sessions using gin (raw_content gin_trgm_ops);

create index decisions_topic_idx on decisions (topic_id, decided_at desc) where deleted_at is null;
create index decisions_active_idx on decisions (topic_id) where status = 'active' and deleted_at is null;
create index ideas_topic_idx on ideas (topic_id, status) where deleted_at is null;
create index prompts_topic_idx on prompts (topic_id) where deleted_at is null;
create index prompt_versions_prompt_idx on prompt_versions (prompt_id, version desc);
create index prompt_versions_body_trgm_idx on prompt_versions using gin (body gin_trgm_ops);
create index files_topic_idx on file_references (topic_id) where deleted_at is null;
create index actions_open_idx on actions (topic_id, kind) where status in ('open', 'in_progress', 'blocked') and deleted_at is null;

create index relationships_from_idx on relationships (from_type, from_id);
create index relationships_to_idx on relationships (to_type, to_id);
create index taggables_entity_idx on taggables (entity_type, entity_id);
create index snapshots_topic_idx on context_snapshots (topic_id, generated_at desc);
create index ingestion_unsorted_idx on ingestion_records (workspace_id, created_at desc) where status = 'unsorted';

-- ---------------------------------------------------------------------------
-- Row Level Security — deny by default, scoped by workspace membership
-- ---------------------------------------------------------------------------

alter table profiles           enable row level security;
alter table workspaces         enable row level security;
alter table workspace_members  enable row level security;
alter table topics             enable row level security;
alter table subtopics          enable row level security;
alter table source_sessions    enable row level security;
alter table session_subtopics  enable row level security;
alter table knowledge_entries  enable row level security;
alter table entry_subtopics    enable row level security;
alter table knowledge_entry_versions enable row level security;
alter table decisions          enable row level security;
alter table ideas              enable row level security;
alter table prompts            enable row level security;
alter table prompt_versions    enable row level security;
alter table file_references    enable row level security;
alter table actions            enable row level security;
alter table milestones         enable row level security;
alter table relationships      enable row level security;
alter table tags               enable row level security;
alter table taggables          enable row level security;
alter table context_snapshots  enable row level security;
alter table ingestion_records  enable row level security;
alter table ingestion_tokens   enable row level security;
alter table deletion_log       enable row level security;

create policy profiles_self on profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy workspaces_member_read on workspaces
  for select using (is_workspace_member(id));
create policy workspaces_owner_write on workspaces
  for insert with check (owner_id = auth.uid());
create policy workspaces_owner_update on workspaces
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy workspaces_owner_delete on workspaces
  for delete using (owner_id = auth.uid());

create policy members_read on workspace_members
  for select using (user_id = auth.uid() or is_workspace_member(workspace_id));
create policy members_write on workspace_members
  for insert with check (
    user_id = auth.uid()
    or exists (select 1 from workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
  );
create policy members_delete on workspace_members
  for delete using (
    exists (select 1 from workspaces w where w.id = workspace_id and w.owner_id = auth.uid())
  );

-- Standard workspace-scoped tables: full access for members.
do $$
declare t text;
begin
  foreach t in array array[
    'topics', 'subtopics', 'source_sessions', 'knowledge_entries', 'decisions',
    'ideas', 'prompts', 'file_references', 'actions', 'milestones',
    'relationships', 'tags', 'context_snapshots', 'ingestion_records',
    'ingestion_tokens', 'deletion_log'
  ] loop
    execute format(
      'create policy %1$I_member_all on %1$I for all
         using (is_workspace_member(workspace_id))
         with check (is_workspace_member(workspace_id))', t);
  end loop;
end $$;

-- Join tables inherit access from their parent row.
create policy entry_subtopics_member on entry_subtopics for all
  using (exists (select 1 from knowledge_entries e where e.id = knowledge_entry_id and is_workspace_member(e.workspace_id)))
  with check (exists (select 1 from knowledge_entries e where e.id = knowledge_entry_id and is_workspace_member(e.workspace_id)));

create policy session_subtopics_member on session_subtopics for all
  using (exists (select 1 from source_sessions s where s.id = source_session_id and is_workspace_member(s.workspace_id)))
  with check (exists (select 1 from source_sessions s where s.id = source_session_id and is_workspace_member(s.workspace_id)));

create policy taggables_member on taggables for all
  using (exists (select 1 from tags t where t.id = tag_id and is_workspace_member(t.workspace_id)))
  with check (exists (select 1 from tags t where t.id = tag_id and is_workspace_member(t.workspace_id)));

-- Append-only tables: SELECT + INSERT only. The absence of UPDATE/DELETE
-- policies is what makes "never overwrite a prompt" a database guarantee.
create policy prompt_versions_read on prompt_versions
  for select using (is_workspace_member(workspace_id));
create policy prompt_versions_insert on prompt_versions
  for insert with check (is_workspace_member(workspace_id));

create policy entry_versions_read on knowledge_entry_versions
  for select using (is_workspace_member(workspace_id));
create policy entry_versions_insert on knowledge_entry_versions
  for insert with check (is_workspace_member(workspace_id));

-- ---------------------------------------------------------------------------
-- New user bootstrap: profile + a default workspace + membership
-- ---------------------------------------------------------------------------

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare ws_id uuid;
begin
  insert into profiles (id, email, display_name)
  values (new.id, new.email, split_part(coalesce(new.email, 'there'), '@', 1))
  on conflict (id) do nothing;

  insert into workspaces (owner_id, name, slug)
  values (new.id, 'My Shelf', 'my-shelf')
  returning id into ws_id;

  insert into workspace_members (workspace_id, user_id, role)
  values (ws_id, new.id, 'owner');

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
