-- ContextShelf — Phase 3 (Capture & retrieval), part 2 of 2.
--
-- Additive only. This migration drops nothing, retypes no column and rewrites
-- no row. It adds no table at all: Phase 0 already modelled the Inbox
-- (ingestion_records), Layer 1 evidence (source_sessions), file and URL
-- references (file_references), tags, and the deletion log. What was missing
-- was retrieval across those records, a fingerprint to propose duplicates
-- from, one transactional write path for imports, and a soft delete that
-- actually writes its tombstone.
--
-- Contents:
--   1. entity_exists() learns the two entity types 0003 added
--   2. content_fingerprint() + generated hash columns — duplicate CANDIDATES
--   3. search_vector generated columns across the searchable record types
--   4. search_documents — a security_invoker projection over all of them
--   5. persist_ingestion() — adapter output → Inbox + Layer 1 + Layer 2, atomic
--   6. soft_delete_record() / restore_record() — allowlisted, no dynamic SQL
--   7. Indexes
--
-- Safe to run against a database holding production data. Every statement is
-- guarded (IF NOT EXISTS / CREATE OR REPLACE) so re-running is a no-op.

-- ---------------------------------------------------------------------------
-- 1. Relationship validation covers the new entity types
--
-- relationships_validate() calls this on every edge insert. Without these two
-- branches the CASE returns NULL, format() produces invalid SQL, and linking
-- an inbox item to what it produced would fail with an unreadable error
-- instead of working.
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
      when 'ingestion_record' then 'ingestion_records'
      when 'context_snapshot' then 'context_snapshots'
    end
  ) into found using eid;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Duplicate CANDIDATES, never duplicate verdicts
--
-- The fingerprint is deliberately weak on formatting and strict on content:
-- trimmed, case-folded, whitespace-collapsed, then SHA-256. Two pastes of the
-- same transcript that differ only in indentation produce the same hash; two
-- genuinely different texts never do.
--
-- These are indexes, NOT unique constraints, and that is the whole point.
-- CLAUDE.md rule 17: duplicate detection PROPOSES and the user confirms. A
-- unique constraint would refuse the second copy at the database level, which
-- decides on the user's behalf and loses the content. An index makes the
-- proposal cheap and leaves the decision where it belongs.
-- ---------------------------------------------------------------------------

-- Whitespace is collapsed BEFORE trimming, not after. btrim() with no second
-- argument removes spaces only, so trimming first would leave a leading tab as
-- a leading space once the collapse ran — and the identical expression in
-- TypeScript (src/lib/ingestion/fingerprint.ts, which computes the hash of
-- text that has not been inserted yet) would then disagree with this one on
-- exactly the inputs a real paste produces.
create or replace function content_fingerprint(t text)
returns text language sql immutable parallel safe as $$
  select case
    when t is null or btrim(regexp_replace(t, '\s+', ' ', 'g')) = '' then null
    else encode(sha256(convert_to(lower(btrim(regexp_replace(t, '\s+', ' ', 'g'))), 'UTF8')), 'hex')
  end;
$$;

comment on function content_fingerprint(text) is
  'Formatting-insensitive content hash. Feeds duplicate PROPOSALS (rule 17); never enforces uniqueness.';

alter table knowledge_entries add column if not exists content_hash text
  generated always as (content_fingerprint(coalesce(title, '') || ' ' || coalesce(content, ''))) stored;

alter table prompt_versions add column if not exists body_hash text
  generated always as (content_fingerprint(body)) stored;

alter table source_sessions add column if not exists raw_hash text
  generated always as (content_fingerprint(raw_content)) stored;

alter table ingestion_records add column if not exists raw_hash text
  generated always as (content_fingerprint(raw_content)) stored;

-- ---------------------------------------------------------------------------
-- 3. Search vectors
--
-- knowledge_entries has had one since Phase 0. Everything else searchable gets
-- the same treatment and the same weighting convention: A = the name you would
-- recognise the record by, B = its substance, C = supporting detail, D = bulk
-- verbatim text.
--
-- Generated and stored, so there is no trigger to forget, no backfill job, and
-- no way for the index to disagree with the row it indexes.
--
-- CLARIFICATION 1 — Current State and Master Topic Memory.
-- Both are DERIVED reads (rule 8, AD-8), so neither can be indexed directly
-- and neither gets a copy made of it here. Instead every record they are
-- assembled FROM is searchable, including the authoritative stored fields:
-- topics.current_state and topics.goal are in the topic vector (and the
-- subtopic equivalents in theirs), which is what "Where we are" and "Current
-- objective" in Master Topic Memory render. Searching a phrase remembered from
-- the memory panel therefore lands on the record that produced it.
--
-- raw_content is capped before tokenising. to_tsvector rejects input over 1MB,
-- and a pasted transcript can exceed that; 200k characters keeps every real
-- transcript whole while making the failure impossible. Substring matching
-- beyond the cap still works through the pg_trgm index Phase 0 created.
-- ---------------------------------------------------------------------------

alter table topics add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(goal, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(current_state, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) stored;

alter table subtopics add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(goal, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(current_state, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) stored;

alter table decisions add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(decision, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(reason, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(approved_direction, '')), 'C')
  ) stored;

alter table ideas add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(idea, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(rationale, '')), 'B')
  ) stored;

alter table prompts add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(purpose, '')), 'B')
  ) stored;

-- prompt_versions is append-only. Adding a generated column is DDL by the
-- table owner, not an UPDATE by a client, so rule 6 is untouched: there is
-- still no UPDATE or DELETE policy and no existing row is rewritten.
alter table prompt_versions add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(body, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(output_summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(notes, '')), 'C')
  ) stored;

alter table source_sessions add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', left(coalesce(raw_content, ''), 200000)), 'D')
  ) stored;

alter table file_references add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(display_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(path, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(url, '')), 'B')
  ) stored;

alter table actions add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(detail, '')), 'B')
  ) stored;

alter table milestones add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(detail, '')), 'B')
  ) stored;

alter table ingestion_records add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(source_hint, '')), 'A') ||
    setweight(to_tsvector('english', left(coalesce(raw_content, ''), 200000)), 'B')
  ) stored;

alter table context_snapshots add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(target, '')), 'A') ||
    setweight(to_tsvector('english', left(coalesce(body, ''), 200000)), 'B')
  ) stored;

-- ---------------------------------------------------------------------------
-- 4. search_documents — one projection over every searchable record type
--
-- security_invoker = true is load-bearing, not decoration. A view runs as its
-- OWNER by default, which would read straight past RLS on all twelve
-- underlying tables and serve one workspace's records to another while
-- appearing to work perfectly. This is the same property 04_timeline.test.sql
-- proves for timeline_events, and 05_search.test.sql proves for this view: as
-- the real `authenticated` role, user B searching for a term that exists only
-- in user A's rows must get zero results.
--
-- A VIEW and not a materialised table (AD-17). A materialised copy would hold
-- rows of its own — outside RLS, refreshed by an owner-privileged job — which
-- is both a second store to drift and a second authorisation surface to get
-- wrong. Because every branch selects an already-indexed generated column,
-- Postgres pushes the @@ predicate into each branch and uses that branch's GIN
-- index, so the view costs nothing a table would have bought.
--
-- record_state answers "is this still true?" at a glance:
--   current    — active, not superseded, still open
--   historical — superseded, rejected, archived, closed, or immutable evidence
--   snapshot   — a saved rendering of Master Topic Memory (AD-8)
--
-- Snapshots participate as HISTORY. context_snapshots is derived and
-- disposable; labelling its rows 'snapshot' is what stops search implying it
-- is a second Current State.
--
-- Soft-deleted rows are excluded everywhere. They are not gone — they are
-- reachable through deletion_log and the Recovery screen, which is where a
-- deleted record should be found.
-- ---------------------------------------------------------------------------

create or replace view search_documents with (security_invoker = true) as
  select
    'topic'::entity_type                       as entity_type,
    t.id                                       as entity_id,
    t.workspace_id,
    t.id                                       as topic_id,
    null::uuid                                 as subtopic_id,
    t.name                                     as title,
    coalesce(t.current_state, t.goal, t.description) as snippet,
    null::source_type                          as source_type,
    'topic'                                    as kind,
    t.status::text                             as status,
    case when t.status = 'archived' or t.archived_at is not null
         then 'historical' else 'current' end  as record_state,
    t.last_meaningful_update_at                as occurred_at,
    t.search_vector
  from topics t
  where t.deleted_at is null

  union all
  select
    'subtopic'::entity_type, s.id, s.workspace_id, s.topic_id, s.id,
    s.name, coalesce(s.current_state, s.goal, s.description),
    null::source_type, 'subtopic', s.status::text,
    case when s.status = 'archived' or s.archived_at is not null
         then 'historical' else 'current' end,
    s.last_meaningful_update_at, s.search_vector
  from subtopics s
  where s.deleted_at is null

  union all
  select
    'knowledge_entry'::entity_type, e.id, e.workspace_id, e.topic_id, null::uuid,
    e.title, e.content, e.source_type, e.knowledge_type::text, e.status::text,
    -- Rule 8, in the same predicate Current State and the Timeline use.
    case when e.status = 'active' and e.superseded_by_id is null
         then 'current' else 'historical' end,
    e.occurred_at, e.search_vector
  from knowledge_entries e
  where e.deleted_at is null

  union all
  select
    'decision'::entity_type, d.id, d.workspace_id, d.topic_id, d.subtopic_id,
    d.title, coalesce(d.decision, d.reason), d.source_type, 'decision', d.status::text,
    case when d.status = 'active' and d.superseded_by_id is null
         then 'current' else 'historical' end,
    d.decided_at, d.search_vector
  from decisions d
  where d.deleted_at is null

  union all
  select
    'idea'::entity_type, i.id, i.workspace_id, i.topic_id, i.subtopic_id,
    i.title, coalesce(i.idea, i.rationale), i.source_type, 'idea', i.status::text,
    case when i.status in ('rejected', 'deferred') then 'historical' else 'current' end,
    i.created_at, i.search_vector
  from ideas i
  where i.deleted_at is null

  union all
  select
    'prompt'::entity_type, p.id, p.workspace_id, p.topic_id, p.subtopic_id,
    p.title, p.purpose, p.source_type,
    case when p.is_winning then 'winning_prompt' else 'prompt' end,
    null::text, 'current',
    p.updated_at, p.search_vector
  from prompts p
  where p.deleted_at is null

  union all
  -- A version is 'current' only if it is the head. An older version is not
  -- wrong, it is history — including a winning version that a later
  -- experiment replaced as head (rule 9a).
  select
    'prompt_version'::entity_type, v.id, v.workspace_id, p.topic_id, p.subtopic_id,
    p.title || ' v' || v.version, v.body, p.source_type, 'prompt_version', v.result::text,
    case when p.current_version_id = v.id then 'current' else 'historical' end,
    v.created_at, v.search_vector
  from prompt_versions v
  join prompts p on p.id = v.prompt_id
  where p.deleted_at is null

  union all
  -- Layer 1 evidence is always historical: it is the receipt for something
  -- that already happened, never a claim about what is true now.
  select
    'source_session'::entity_type, ss.id, ss.workspace_id, ss.topic_id, null::uuid,
    coalesce(ss.title, 'Session'), coalesce(ss.summary, left(ss.raw_content, 400)),
    ss.source_type, 'source_session', null::text, 'historical',
    ss.occurred_at, ss.search_vector
  from source_sessions ss

  union all
  select
    'file_reference'::entity_type, f.id, f.workspace_id, f.topic_id, f.subtopic_id,
    coalesce(f.display_name, f.path, f.url), coalesce(f.path, f.url),
    null::source_type, f.kind::text, null::text, 'current',
    f.created_at, f.search_vector
  from file_references f
  where f.deleted_at is null

  union all
  select
    'action'::entity_type, a.id, a.workspace_id, a.topic_id, a.subtopic_id,
    a.title, a.detail, null::source_type, a.kind::text, a.status::text,
    case when a.status in ('done', 'dropped') then 'historical' else 'current' end,
    a.created_at, a.search_vector
  from actions a
  where a.deleted_at is null

  union all
  select
    'milestone'::entity_type, m.id, m.workspace_id, m.topic_id, null::uuid,
    m.title, m.detail, null::source_type, 'milestone', m.status,
    case when m.status in ('missed', 'dropped') then 'historical' else 'current' end,
    coalesce(m.achieved_at, m.created_at), m.search_vector
  from milestones m
  where m.deleted_at is null

  union all
  select
    'ingestion_record'::entity_type, r.id, r.workspace_id, r.topic_id, r.subtopic_id,
    coalesce(r.source_hint, 'Captured item'), left(coalesce(r.raw_content, ''), 400),
    r.source_type, 'ingestion_record', r.status::text,
    case when r.status in ('processed', 'archived', 'discarded')
         then 'historical' else 'current' end,
    r.created_at, r.search_vector
  from ingestion_records r

  union all
  -- Derived and disposable (AD-8). Labelled 'snapshot' so a hit here is never
  -- mistaken for the live answer.
  select
    'context_snapshot'::entity_type, cs.id, cs.workspace_id, cs.topic_id, cs.subtopic_id,
    coalesce(cs.target, 'Saved memory'), left(cs.body, 400),
    null::source_type, 'context_snapshot', cs.density::text, 'snapshot',
    cs.generated_at, cs.search_vector
  from context_snapshots cs;

comment on view search_documents is
  'Universal search projection over every searchable record type. security_invoker: RLS on the underlying tables is authoritative. record_state distinguishes current records from history and from saved snapshots; snapshots are never a second Current State (AD-8).';

grant select on search_documents to authenticated, service_role;
revoke all on search_documents from anon;

-- ---------------------------------------------------------------------------
-- 4b. Ranked search
--
-- Ranking lives here rather than in the client because ts_rank_cd cannot be
-- expressed through PostgREST, and because it must be the same everywhere: one
-- definition of "best match" for the search page, the Topic page and any future
-- caller.
--
-- Entirely deterministic. The same query over the same rows always returns the
-- same order, which is what makes search learnable — there is no model, no
-- personalisation and no feedback loop anywhere in this path.
--
-- Two components, both fixed:
--   * ts_rank_cd over the weighted vector — cover density, so a document that
--     mentions every search term near each other beats one that scatters them.
--   * A state multiplier. At equal textual relevance a record that is still
--     true outranks one that was superseded, and a saved snapshot ranks below
--     both because it is a rendering of records rather than a record. These are
--     constants, chosen once and written down, not weights that drift.
--
-- Ties break on recency and then on id, so the order is total: two runs of the
-- same query can never disagree, and pagination cannot drop or repeat a row.
--
-- SECURITY INVOKER (the default, stated explicitly because it is load-bearing):
-- the function reads a security_invoker view, so RLS still applies as the
-- caller. Making it definer would hand every workspace's records to anyone.
-- ---------------------------------------------------------------------------

create or replace function search_records(
  p_workspace_id  uuid,
  p_query         text,
  p_entity_types  text[]      default null,
  p_kinds         text[]      default null,
  p_source_types  text[]      default null,
  p_topic_id      uuid        default null,
  p_record_states text[]      default null,
  p_since         timestamptz default null,
  p_until         timestamptz default null,
  p_limit         integer     default 50,
  p_offset        integer     default 0
) returns table (
  entity_type   entity_type,
  entity_id     uuid,
  workspace_id  uuid,
  topic_id      uuid,
  subtopic_id   uuid,
  title         text,
  snippet       text,
  source_type   source_type,
  kind          text,
  status        text,
  record_state  text,
  occurred_at   timestamptz,
  rank          real
) language sql stable security invoker as $$
  with q as (select websearch_to_tsquery('english', coalesce(p_query, '')) as tsq)
  select
    d.entity_type, d.entity_id, d.workspace_id, d.topic_id, d.subtopic_id,
    d.title, d.snippet, d.source_type, d.kind, d.status, d.record_state,
    d.occurred_at,
    (ts_rank_cd(d.search_vector, q.tsq) *
      case d.record_state
        when 'current' then 1.0
        when 'historical' then 0.6
        else 0.4
      end)::real as rank
  from search_documents d, q
  where d.workspace_id = p_workspace_id
    -- An empty or stopword-only query matches nothing rather than everything.
    -- Compared as text because @@ against an empty tsquery is merely a no-op
    -- with a NOTICE, and a stray keystroke should not log noise on every read.
    and q.tsq::text <> ''
    and d.search_vector @@ q.tsq
    and (p_entity_types  is null or d.entity_type::text = any(p_entity_types))
    and (p_kinds         is null or d.kind = any(p_kinds))
    and (p_source_types  is null or d.source_type::text = any(p_source_types))
    and (p_topic_id      is null or d.topic_id = p_topic_id)
    and (p_record_states is null or d.record_state = any(p_record_states))
    and (p_since         is null or d.occurred_at >= p_since)
    and (p_until         is null or d.occurred_at <= p_until)
  order by rank desc, d.occurred_at desc, d.entity_id
  limit greatest(coalesce(p_limit, 50), 0)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function search_records is
  'Ranked universal search. Deterministic: ts_rank_cd with fixed state multipliers, ties broken on recency then id. security invoker — RLS on the underlying tables is authoritative.';

-- The counts beside each filter chip. Same predicate, no ranking, no paging,
-- so a chip can never disagree with the results it filters to.
create or replace function search_type_counts(
  p_workspace_id  uuid,
  p_query         text,
  p_source_types  text[]      default null,
  p_topic_id      uuid        default null,
  p_record_states text[]      default null,
  p_since         timestamptz default null,
  p_until         timestamptz default null
) returns table (entity_type text, n bigint)
language sql stable security invoker as $$
  with q as (select websearch_to_tsquery('english', coalesce(p_query, '')) as tsq)
  select d.entity_type::text, count(*)
  from search_documents d, q
  where d.workspace_id = p_workspace_id
    -- An empty or stopword-only query matches nothing rather than everything.
    -- Compared as text because @@ against an empty tsquery is merely a no-op
    -- with a NOTICE, and a stray keystroke should not log noise on every read.
    and q.tsq::text <> ''
    and d.search_vector @@ q.tsq
    and (p_source_types  is null or d.source_type::text = any(p_source_types))
    and (p_topic_id      is null or d.topic_id = p_topic_id)
    and (p_record_states is null or d.record_state = any(p_record_states))
    and (p_since         is null or d.occurred_at >= p_since)
    and (p_until         is null or d.occurred_at <= p_until)
  group by 1;
$$;

-- ---------------------------------------------------------------------------
-- 5. persist_ingestion — the one write path for an import
--
-- ARCHITECTURE §9 stage 3 requires the Inbox record, the Layer 1 session, and
-- the Layer 2 entries to land in ONE transaction. PostgREST cannot span calls
-- transactionally, so a half-written import would otherwise be reachable: a
-- session with no entries, or entries whose ingestion_record still says
-- 'unsorted'. This function is that transaction.
--
-- SECURITY INVOKER, emphatically. A definer function here would let any caller
-- write into any workspace by passing its id; as invoker, every insert is
-- checked by the same RLS policy an ordinary client insert would hit, so
-- p_workspace_id can only ever be a workspace the caller belongs to.
--
-- It never guesses. Segments arrive already extracted by a deterministic
-- adapter (Path A) or already confirmed by the user (Path B). Nothing here
-- classifies, and nothing is filed to a topic the caller did not name.
-- ---------------------------------------------------------------------------

create or replace function persist_ingestion(
  p_workspace_id uuid,
  p_adapter_id   text,
  p_source_type  source_type,
  p_content_type text,
  p_raw          text,
  p_payload      jsonb,
  p_title        text,
  p_occurred_at  timestamptz,
  p_external_url text,
  p_topic_id     uuid,
  p_subtopic_id  uuid,
  p_segments     jsonb,
  p_code         jsonb
) returns uuid language plpgsql security invoker as $$
declare
  v_record_id  uuid;
  v_session_id uuid;
  v_entry_ids  uuid[] := '{}';
  v_entry_id   uuid;
  seg          jsonb;
  v_status     ingestion_status;
  v_seg_count  integer := coalesce(jsonb_array_length(p_segments), 0);
begin
  if p_workspace_id is null then
    raise exception 'a workspace is required';
  end if;
  if p_subtopic_id is not null and p_topic_id is null then
    raise exception 'a subtopic cannot be assigned without its topic';
  end if;

  insert into ingestion_records (
    workspace_id, user_id, adapter_id, source_type, content_type,
    raw_content, payload, source_hint, topic_id, subtopic_id, status
  ) values (
    p_workspace_id, auth.uid(), p_adapter_id, coalesce(p_source_type, 'manual'),
    coalesce(p_content_type, 'text'), p_raw, coalesce(p_payload, '{}'::jsonb),
    p_title, p_topic_id, p_subtopic_id, 'unsorted'
  ) returning id into v_record_id;

  -- Nothing filed yet: the item waits in the Inbox with its raw content intact.
  if p_topic_id is null then
    return v_record_id;
  end if;

  -- Layer 1 first, so every entry below can point at it (rule 10).
  if p_raw is not null and btrim(p_raw) <> '' then
    insert into source_sessions (
      workspace_id, user_id, topic_id, source_type, title, external_url,
      occurred_at, raw_content, repo_url, branch, commit_sha,
      files_changed, files_added, files_removed, metadata
    ) values (
      p_workspace_id, auth.uid(), p_topic_id, coalesce(p_source_type, 'manual'),
      p_title, p_external_url, coalesce(p_occurred_at, now()), p_raw,
      p_code ->> 'repoUrl', p_code ->> 'branch', p_code ->> 'commitSha',
      coalesce(p_code -> 'filesChanged', '[]'::jsonb),
      coalesce(p_code -> 'filesAdded', '[]'::jsonb),
      coalesce(p_code -> 'filesRemoved', '[]'::jsonb),
      coalesce(p_payload, '{}'::jsonb)
    ) returning id into v_session_id;

    if p_subtopic_id is not null then
      insert into session_subtopics (source_session_id, subtopic_id)
      values (v_session_id, p_subtopic_id) on conflict do nothing;
    end if;
  end if;

  -- Layer 2: one session fans out into many entries (rule 4).
  for seg in select * from jsonb_array_elements(coalesce(p_segments, '[]'::jsonb))
  loop
    insert into knowledge_entries (
      workspace_id, topic_id, user_id, knowledge_type, status, title, content,
      source_type, source_session_id, source_reference, occurred_at, confidence
    ) values (
      p_workspace_id, p_topic_id, auth.uid(),
      (seg ->> 'knowledgeType')::knowledge_type, 'active',
      seg ->> 'title', seg ->> 'content',
      coalesce(p_source_type, 'manual'), v_session_id, seg ->> 'sourceReference',
      coalesce((seg ->> 'occurredAt')::timestamptz, p_occurred_at, now()),
      (seg ->> 'confidence')::real
    ) returning id into v_entry_id;

    v_entry_ids := v_entry_ids || v_entry_id;

    if p_subtopic_id is not null then
      insert into entry_subtopics (knowledge_entry_id, subtopic_id)
      values (v_entry_id, p_subtopic_id) on conflict do nothing;
    end if;
  end loop;

  -- An import that produced no entry is not "processed" — it is waiting for a
  -- human, which is exactly what needs_review means.
  v_status := case
    when v_seg_count = 0 then 'needs_review'::ingestion_status
    when array_length(v_entry_ids, 1) = v_seg_count then 'processed'::ingestion_status
    else 'partially_processed'::ingestion_status
  end;

  update ingestion_records
     set created_source_session_id = v_session_id,
         created_entry_ids = v_entry_ids,
         status = v_status,
         processed_at = case when v_status = 'needs_review' then null else now() end
   where id = v_record_id;

  update topics set last_meaningful_update_at = now()
   where id = p_topic_id and array_length(v_entry_ids, 1) > 0;

  return v_record_id;
end;
$$;

comment on function persist_ingestion is
  'Adapter output -> Inbox record + Layer 1 session + Layer 2 entries, in one transaction. security invoker: RLS decides which workspace the caller may write to.';

-- ---------------------------------------------------------------------------
-- 6. Soft delete and recovery
--
-- Nothing is destroyed (rule 5). Deleting stamps deleted_at and writes the
-- full row into deletion_log, so the record can be brought back exactly as it
-- was rather than retyped from memory.
--
-- CLARIFICATION 3 — no dynamic SQL, and an explicit allowlist.
-- entity_type arrives from the client. entity_exists() above interpolates a
-- table name through format(%I), which is safe only because the enum
-- constrains the input to eleven known values — a guarantee that lives in the
-- type, not in this function. For a function that MUTATES rows that is too
-- much trust to place in an argument: adding a value to the enum later, or any
-- future overload taking text, would silently widen what a caller can write
-- to. So every supported type here is a separate, statically-compiled UPDATE
-- against a named table. There is no code path that builds a table name.
--
-- The CASE is an allowlist, so the default is refusal:
--   * prompt_version and any future history table are refused explicitly,
--     with their own message. Those tables have no deleted_at and no UPDATE or
--     DELETE policy, and rule 6 depends on that staying true.
--   * source_session is refused: Layer 1 is written once and never edited, and
--     deleting the evidence under a knowledge entry would break provenance.
--   * ingestion_record is refused: an inbox item is archived, not deleted, so
--     the raw capture survives.
--   * context_snapshot is refused: it is derived and regenerable (AD-8).
--   * anything else raises.
--
-- Cross-workspace deletion is impossible without a check of its own. The
-- function is SECURITY INVOKER, so each UPDATE runs under RLS; a row in
-- another workspace is simply not visible, the UPDATE matches nothing, and the
-- RETURNING clause yields null — which raises below.
-- ---------------------------------------------------------------------------

create or replace function soft_delete_record(
  p_entity_type entity_type,
  p_entity_id   uuid,
  p_reason      text default null
) returns uuid language plpgsql security invoker as $$
declare
  v_workspace_id uuid;
  v_snapshot     jsonb;
  v_log_id       uuid;
begin
  case p_entity_type
    when 'topic' then
      update topics set deleted_at = now()
       where id = p_entity_id and deleted_at is null
      returning workspace_id, to_jsonb(topics.*) into v_workspace_id, v_snapshot;

    when 'subtopic' then
      update subtopics set deleted_at = now()
       where id = p_entity_id and deleted_at is null
      returning workspace_id, to_jsonb(subtopics.*) into v_workspace_id, v_snapshot;

    when 'knowledge_entry' then
      update knowledge_entries set deleted_at = now()
       where id = p_entity_id and deleted_at is null
      returning workspace_id, to_jsonb(knowledge_entries.*) into v_workspace_id, v_snapshot;

    when 'decision' then
      update decisions set deleted_at = now()
       where id = p_entity_id and deleted_at is null
      returning workspace_id, to_jsonb(decisions.*) into v_workspace_id, v_snapshot;

    when 'idea' then
      update ideas set deleted_at = now()
       where id = p_entity_id and deleted_at is null
      returning workspace_id, to_jsonb(ideas.*) into v_workspace_id, v_snapshot;

    when 'prompt' then
      update prompts set deleted_at = now()
       where id = p_entity_id and deleted_at is null
      returning workspace_id, to_jsonb(prompts.*) into v_workspace_id, v_snapshot;

    when 'file_reference' then
      update file_references set deleted_at = now()
       where id = p_entity_id and deleted_at is null
      returning workspace_id, to_jsonb(file_references.*) into v_workspace_id, v_snapshot;

    when 'action' then
      update actions set deleted_at = now()
       where id = p_entity_id and deleted_at is null
      returning workspace_id, to_jsonb(actions.*) into v_workspace_id, v_snapshot;

    when 'milestone' then
      update milestones set deleted_at = now()
       where id = p_entity_id and deleted_at is null
      returning workspace_id, to_jsonb(milestones.*) into v_workspace_id, v_snapshot;

    when 'prompt_version' then
      raise exception
        'prompt_version is append-only history and cannot be deleted'
        using errcode = 'feature_not_supported';

    when 'source_session' then
      raise exception
        'source_session is immutable Layer 1 evidence and cannot be deleted'
        using errcode = 'feature_not_supported';

    when 'ingestion_record' then
      raise exception
        'ingestion_record is archived rather than deleted, so the raw capture survives'
        using errcode = 'feature_not_supported';

    when 'context_snapshot' then
      raise exception
        'context_snapshot is derived and regenerable; delete the records it was assembled from instead'
        using errcode = 'feature_not_supported';

    else
      raise exception 'soft delete is not supported for entity type %', p_entity_type
        using errcode = 'feature_not_supported';
  end case;

  -- Not found, already deleted, or in a workspace this caller cannot see.
  -- Deliberately one message for all three: distinguishing them would confirm
  -- the existence of another workspace's row.
  if v_workspace_id is null then
    raise exception 'no % is available to delete', p_entity_type
      using errcode = 'no_data_found';
  end if;

  insert into deletion_log (workspace_id, user_id, entity_type, entity_id, snapshot, reason)
  values (v_workspace_id, auth.uid(), p_entity_type, p_entity_id, v_snapshot, p_reason)
  returning id into v_log_id;

  return v_log_id;
end;
$$;

comment on function soft_delete_record is
  'Stamps deleted_at and writes the deletion_log tombstone in one transaction. Explicit allowlist, no dynamic SQL; append-only and Layer 1 tables are refused.';

create or replace function restore_record(p_deletion_log_id uuid)
returns uuid language plpgsql security invoker as $$
declare
  v_log      deletion_log%rowtype;
  v_restored uuid;
begin
  -- RLS scopes this select, so a tombstone from another workspace is invisible.
  select * into v_log from deletion_log where id = p_deletion_log_id for update;
  if not found then
    raise exception 'no deletion record is available to restore'
      using errcode = 'no_data_found';
  end if;
  if v_log.restored_at is not null then
    raise exception 'that record was already restored'
      using errcode = 'invalid_parameter_value';
  end if;

  case v_log.entity_type
    when 'topic' then
      update topics set deleted_at = null where id = v_log.entity_id
      returning id into v_restored;
    when 'subtopic' then
      update subtopics set deleted_at = null where id = v_log.entity_id
      returning id into v_restored;
    when 'knowledge_entry' then
      update knowledge_entries set deleted_at = null where id = v_log.entity_id
      returning id into v_restored;
    when 'decision' then
      update decisions set deleted_at = null where id = v_log.entity_id
      returning id into v_restored;
    when 'idea' then
      update ideas set deleted_at = null where id = v_log.entity_id
      returning id into v_restored;
    when 'prompt' then
      update prompts set deleted_at = null where id = v_log.entity_id
      returning id into v_restored;
    when 'file_reference' then
      update file_references set deleted_at = null where id = v_log.entity_id
      returning id into v_restored;
    when 'action' then
      update actions set deleted_at = null where id = v_log.entity_id
      returning id into v_restored;
    when 'milestone' then
      update milestones set deleted_at = null where id = v_log.entity_id
      returning id into v_restored;
    else
      raise exception 'restore is not supported for entity type %', v_log.entity_type
        using errcode = 'feature_not_supported';
  end case;

  if v_restored is null then
    -- The parent cascaded away, or the row is in another workspace.
    raise exception 'the % this tombstone describes is no longer available', v_log.entity_type
      using errcode = 'no_data_found';
  end if;

  update deletion_log set restored_at = now() where id = p_deletion_log_id;
  return v_restored;
end;
$$;

comment on function restore_record is
  'Clears deleted_at from a deletion_log tombstone and stamps restored_at. Same allowlist as soft_delete_record; refuses a second restore.';

grant execute on function content_fingerprint(text) to authenticated, service_role;
grant execute on function search_records(uuid, text, text[], text[], text[], uuid, text[], timestamptz, timestamptz, integer, integer) to authenticated, service_role;
grant execute on function search_type_counts(uuid, text, text[], uuid, text[], timestamptz, timestamptz) to authenticated, service_role;
revoke all on function search_records(uuid, text, text[], text[], text[], uuid, text[], timestamptz, timestamptz, integer, integer) from anon;
revoke all on function search_type_counts(uuid, text, text[], uuid, text[], timestamptz, timestamptz) from anon;
grant execute on function persist_ingestion(uuid, text, source_type, text, text, jsonb, text, timestamptz, text, uuid, uuid, jsonb, jsonb) to authenticated, service_role;
grant execute on function soft_delete_record(entity_type, uuid, text) to authenticated, service_role;
grant execute on function restore_record(uuid) to authenticated, service_role;

revoke all on function persist_ingestion(uuid, text, source_type, text, text, jsonb, text, timestamptz, text, uuid, uuid, jsonb, jsonb) from anon;
revoke all on function soft_delete_record(entity_type, uuid, text) from anon;
revoke all on function restore_record(uuid) from anon;

-- ---------------------------------------------------------------------------
-- 7. Indexes
--
-- One GIN index per search_vector, so each branch of search_documents is
-- served by its own index rather than by a sequential scan of the union.
-- ---------------------------------------------------------------------------

create index if not exists topics_search_idx            on topics             using gin (search_vector);
create index if not exists subtopics_search_idx         on subtopics          using gin (search_vector);
create index if not exists decisions_search_idx         on decisions          using gin (search_vector);
create index if not exists ideas_search_idx             on ideas              using gin (search_vector);
create index if not exists prompts_search_idx           on prompts            using gin (search_vector);
create index if not exists prompt_versions_search_idx   on prompt_versions    using gin (search_vector);
create index if not exists sessions_search_idx          on source_sessions    using gin (search_vector);
create index if not exists files_search_idx             on file_references    using gin (search_vector);
create index if not exists actions_search_idx           on actions            using gin (search_vector);
create index if not exists milestones_search_idx        on milestones         using gin (search_vector);
create index if not exists ingestion_search_idx         on ingestion_records  using gin (search_vector);
create index if not exists snapshots_search_idx         on context_snapshots  using gin (search_vector);

-- Duplicate proposals. Non-unique on purpose (section 2).
create index if not exists entries_content_hash_idx
  on knowledge_entries (workspace_id, content_hash) where deleted_at is null;
create index if not exists prompt_versions_body_hash_idx
  on prompt_versions (workspace_id, body_hash);
create index if not exists sessions_raw_hash_idx
  on source_sessions (workspace_id, raw_hash);
create index if not exists ingestion_raw_hash_idx
  on ingestion_records (workspace_id, raw_hash);

-- Re-import detection: the same transcript URL, or the same commit.
create index if not exists sessions_external_url_idx
  on source_sessions (workspace_id, external_url) where external_url is not null;
create index if not exists sessions_commit_idx
  on source_sessions (workspace_id, repo_url, commit_sha) where commit_sha is not null;

-- Near-duplicate and conflict proposals work on titles, which is why these are
-- trigram rather than tsvector indexes: they answer "how similar are these two
-- strings", not "does this document contain this word".
create index if not exists entries_title_trgm_idx
  on knowledge_entries using gin (title gin_trgm_ops);
create index if not exists decisions_title_trgm_idx
  on decisions using gin (title gin_trgm_ops);

-- Inbox triage reads by status, not only by the unsorted partial index Phase 0
-- created.
create index if not exists ingestion_status_idx
  on ingestion_records (workspace_id, status, created_at desc);

-- Recovery reads the tombstones that have not been restored yet.
create index if not exists deletion_log_open_idx
  on deletion_log (workspace_id, created_at desc) where restored_at is null;

-- Import History, and "what did this import produce".
create index if not exists ingestion_session_idx
  on ingestion_records (created_source_session_id) where created_source_session_id is not null;
