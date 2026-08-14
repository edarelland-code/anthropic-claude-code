-- ContextShelf — Phase 6: model-assisted extraction, and the review it must pass.
--
-- The rule the whole migration exists to enforce: **a model may suggest; a
-- person confirms.** Nothing here writes an authoritative record. These two
-- tables are a workspace where proposals wait to be judged, and one function
-- that turns judged proposals into records through the paths that already
-- exist.
--
-- Why new tables at all. `ingestion_records.payload` already holds the
-- original structured payload, and overloading it with mutable review state
-- would conflate Layer 1 evidence with a scratch pad — the capture would start
-- changing as somebody edited a suggestion derived from it. A review is also
-- long-lived: half an hour of editing must survive a closed tab (6AB), which
-- means rows rather than React state.
--
-- What is deliberately NOT here:
--
--   * No column for a provider credential. Keys stay in the server
--     environment; see `docs/DEPLOYMENT.md`. A user-readable table is the
--     wrong place for a secret, and encrypting one at rest would mean a new
--     dependency.
--   * No chain-of-thought, no hidden reasoning (6R). `basis` holds the literal
--     evidence a suggestion cites, which is the part a person can audit.
--   * No path by which confirming a suggestion sets a decision `active`,
--     replaces Current State, chooses a winning prompt version or supersedes
--     anything. Those remain the operations a person performs afterwards,
--     through the controls that already gate them.

-- ---------------------------------------------------------------------------
-- 1. Vocabulary
-- ---------------------------------------------------------------------------
--
-- `create type` is safe in the same transaction as its first use. Only
-- `alter type ... add value` is not, which is why 0003 existed.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'extraction_status') then
    create type extraction_status as enum ('running', 'succeeded', 'partial', 'failed');
  end if;
  if not exists (select 1 from pg_type where typname = 'suggestion_state') then
    -- `edited` is its own state rather than a flag: "the user changed this
    -- before accepting it" is exactly the distinction 6AA asks to preserve,
    -- and a boolean would lose it the moment someone edited and then rejected.
    create type suggestion_state as enum ('suggested', 'edited', 'confirmed', 'rejected');
  end if;
  if not exists (select 1 from pg_type where typname = 'suggestion_kind') then
    create type suggestion_kind as enum (
      'knowledge_entry', 'decision', 'idea', 'prompt', 'action',
      'current_state', 'relationship'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. One analysis
-- ---------------------------------------------------------------------------

create table if not exists extraction_runs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,

  -- What was analysed. The Inbox item is the usual answer; a Layer 1 session
  -- is the answer when someone re-analyses an already-filed import.
  ingestion_record_id uuid references ingestion_records(id) on delete cascade,
  source_session_id   uuid references source_sessions(id) on delete set null,
  topic_id      uuid,
  subtopic_id   uuid,

  -- Observability (6R). Enough to answer "why did extraction change" without
  -- storing anything the model thought.
  provider      text not null,
  model         text,
  prompt_version text not null,
  status        extraction_status not null default 'running',
  failure_code  text,
  failure_detail text,

  chunk_count   integer not null default 1,
  suggested_count integer not null default 0,
  confirmed_count integer not null default 0,
  rejected_count  integer not null default 0,

  -- Usage, when the provider reports it (6S). Cost is computed from configured
  -- pricing at write time, or left null — an estimate nobody can reproduce is
  -- worse than no number.
  input_tokens  integer,
  output_tokens integer,
  cost_usd      numeric(12, 6),

  warnings      jsonb not null default '[]'::jsonb,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'extraction_runs_topic_fk') then
    alter table extraction_runs add constraint extraction_runs_topic_fk
      foreign key (topic_id, workspace_id) references topics (id, workspace_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'extraction_runs_subtopic_fk') then
    alter table extraction_runs add constraint extraction_runs_subtopic_fk
      foreign key (subtopic_id, workspace_id) references subtopics (id, workspace_id) on delete set null;
  end if;
end $$;

create index if not exists extraction_runs_workspace_idx
  on extraction_runs (workspace_id, started_at desc);
create index if not exists extraction_runs_record_idx
  on extraction_runs (ingestion_record_id, started_at desc);

-- ---------------------------------------------------------------------------
-- 3. One proposal
-- ---------------------------------------------------------------------------

create table if not exists extraction_suggestions (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  run_id        uuid not null references extraction_runs(id) on delete cascade,
  ordinal       integer not null default 0,

  kind          suggestion_kind not null,
  -- Only meaningful when kind = 'knowledge_entry'. Constrained by the enum, so
  -- a model cannot invent a type the product does not have.
  knowledge_type knowledge_type,

  -- The CURRENT values, which a user may edit before confirming. `original`
  -- keeps what the provider actually said, so an edit is legible as an edit
  -- and the record written is the corrected one (6AA).
  title         text not null,
  content       text,
  reason        text,
  status_suggestion text,
  suggested_topic_id    uuid,
  suggested_subtopic_id uuid,

  -- Provenance. A suggestion with no anchor into the source is one nobody can
  -- check, so this is required whenever the source could supply one — enforced
  -- at the application boundary, where the source is in hand.
  source_reference text,
  chunk_index   integer not null default 0,
  confidence    real not null default 0,
  basis         jsonb not null default '[]'::jsonb,
  payload       jsonb not null default '{}'::jsonb,
  original      jsonb not null default '{}'::jsonb,

  -- Review state.
  state         suggestion_state not null default 'suggested',
  selected      boolean not null default false,
  -- Deterministic duplicate/conflict findings, attached before review (6J/6K).
  -- The model does not decide either of these.
  duplicate_of_kind text,
  duplicate_of_id   uuid,
  duplicate_reason  text,
  conflicts_with_id uuid,
  conflict_reason   text,
  /** Set on confirmation, so a second confirm is a no-op rather than a copy. */
  created_record_id uuid,
  created_record_kind text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint extraction_suggestions_confidence_ck check (confidence >= 0 and confidence <= 1),
  constraint extraction_suggestions_title_ck check (btrim(title) <> ''),
  -- A knowledge entry needs a type; nothing else has one to give.
  constraint extraction_suggestions_type_ck check (
    (kind = 'knowledge_entry' and knowledge_type is not null)
    or (kind <> 'knowledge_entry' and knowledge_type is null)
  )
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'extraction_suggestions_topic_fk') then
    alter table extraction_suggestions add constraint extraction_suggestions_topic_fk
      foreign key (suggested_topic_id, workspace_id) references topics (id, workspace_id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'extraction_suggestions_subtopic_fk') then
    alter table extraction_suggestions add constraint extraction_suggestions_subtopic_fk
      foreign key (suggested_subtopic_id, workspace_id) references subtopics (id, workspace_id) on delete set null;
  end if;
end $$;

create index if not exists extraction_suggestions_run_idx
  on extraction_suggestions (run_id, ordinal);
create index if not exists extraction_suggestions_workspace_idx
  on extraction_suggestions (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Row-level security
-- ---------------------------------------------------------------------------

alter table extraction_runs enable row level security;
alter table extraction_suggestions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'extraction_runs' and policyname = 'extraction_runs_member_all'
  ) then
    create policy extraction_runs_member_all on extraction_runs for all
      using (is_workspace_member(workspace_id))
      with check (is_workspace_member(workspace_id));
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'extraction_suggestions' and policyname = 'extraction_suggestions_member_all'
  ) then
    create policy extraction_suggestions_member_all on extraction_suggestions for all
      using (is_workspace_member(workspace_id))
      with check (is_workspace_member(workspace_id));
  end if;
end $$;

grant select, insert, update, delete on extraction_runs to authenticated;
grant select, insert, update, delete on extraction_suggestions to authenticated;
-- Supabase's default privileges hand every new public table to `anon`; 0006
-- is the record of learning that the hard way.
revoke all on extraction_runs from anon;
revoke all on extraction_suggestions from anon;

-- `updated_at` is the database's to set, never the client's (rule 15).
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'extraction_runs_set_updated_at') then
    create trigger extraction_runs_set_updated_at before update on extraction_runs
      for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'extraction_suggestions_set_updated_at') then
    create trigger extraction_suggestions_set_updated_at before update on extraction_suggestions
      for each row execute function set_updated_at();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Confirmation
-- ---------------------------------------------------------------------------

/**
 * Turns judged proposals into records, atomically.
 *
 * `security invoker`, so every insert below is subject to the caller's own
 * policies — a caller cannot confirm suggestions in a workspace they are not a
 * member of, and does not need this function to be careful for them.
 *
 * Three properties worth stating because they are the point of Phase 6:
 *
 *   1. **Nothing becomes authoritative.** A confirmed decision is written
 *      `proposed`, an idea `suggested`, a prompt version `untested` and never
 *      winning. Making one of them current is a separate act, through the
 *      controls that already demand a reason.
 *   2. **Current State is not writable here at all.** `current_state`
 *      suggestions are skipped by name. Replacing a topic's state is a
 *      compare-and-accept flow of its own (6L), with optimistic concurrency,
 *      because it is the single most overwriteable field in the product.
 *   3. **It is idempotent.** A suggestion already `confirmed` is skipped, so a
 *      double-click or a retried request cannot write a record twice.
 *
 * Knowledge entries go through `persist_ingestion()` — the same function the
 * Inbox and the Claude Code endpoint call — rather than a second insert of
 * their own (rule 20).
 */
create or replace function confirm_extraction_suggestions(
  p_run_id         uuid,
  p_suggestion_ids uuid[],
  p_topic_id       uuid,
  p_subtopic_id    uuid
) returns jsonb language plpgsql security invoker as $$
declare
  v_run       extraction_runs%rowtype;
  v_record    ingestion_records%rowtype;
  v_source    ingestion_records%rowtype;
  v_segments  jsonb := '[]'::jsonb;
  v_entry_ids uuid[] := '{}';
  v_created   jsonb := '[]'::jsonb;
  v_skipped   integer := 0;
  v_record_id uuid;
  v_id        uuid;
  v_pos       integer;
  v_version   integer;
  s           extraction_suggestions%rowtype;
begin
  select * into v_run from extraction_runs where id = p_run_id;
  if not found then
    raise exception 'no such extraction run' using errcode = '42P01';
  end if;
  if p_topic_id is null then
    raise exception 'a topic is required to file confirmed suggestions' using errcode = '22023';
  end if;
  if not exists (
    select 1 from topics
     where id = p_topic_id and workspace_id = v_run.workspace_id and deleted_at is null
  ) then
    raise exception 'no such topic' using errcode = '42P01';
  end if;
  if p_subtopic_id is not null and not exists (
    select 1 from subtopics
     where id = p_subtopic_id and topic_id = p_topic_id
       and workspace_id = v_run.workspace_id and deleted_at is null
  ) then
    raise exception 'no such subtopic' using errcode = '42P01';
  end if;

  -- --- Knowledge entries, through the one write path --------------------
  for s in
    select * from extraction_suggestions
     where run_id = p_run_id and id = any(p_suggestion_ids)
       and kind = 'knowledge_entry' and state <> 'confirmed'
     order by ordinal
  loop
    v_segments := v_segments || jsonb_build_object(
      'knowledgeType', s.knowledge_type::text,
      'title', s.title,
      'content', s.content,
      'sourceReference', s.source_reference,
      -- The confidence travels with the entry so a reader can see that it came
      -- from a suggestion somebody accepted rather than something typed.
      'confidence', s.confidence
    );
  end loop;

  if jsonb_array_length(v_segments) > 0 then
    select * into v_source from ingestion_records where id = v_run.ingestion_record_id;

    select persist_ingestion(
      v_run.workspace_id,
      coalesce(v_source.adapter_id, 'assisted-extraction'),
      coalesce(v_source.source_type, 'manual'),
      coalesce(v_source.content_type, 'text'),
      coalesce(v_source.raw_content, ''),
      jsonb_build_object('extractionRunId', p_run_id, 'provider', v_run.provider,
                         'model', v_run.model, 'promptVersion', v_run.prompt_version),
      v_source.source_hint,
      null, null,
      p_topic_id, p_subtopic_id,
      v_segments, null
    ) into v_record_id;

    select * into v_record from ingestion_records where id = v_record_id;
    v_entry_ids := coalesce(v_record.created_entry_ids, '{}'::uuid[]);

    -- Pair each entry back to the suggestion that produced it, in the order
    -- both were built.
    v_pos := 0;
    for s in
      select * from extraction_suggestions
       where run_id = p_run_id and id = any(p_suggestion_ids)
         and kind = 'knowledge_entry' and state <> 'confirmed'
       order by ordinal
    loop
      v_pos := v_pos + 1;
      update extraction_suggestions
         set state = 'confirmed',
             created_record_id = v_entry_ids[v_pos],
             created_record_kind = 'knowledge_entry'
       where id = s.id;
      v_created := v_created || jsonb_build_object(
        'suggestionId', s.id, 'kind', 'knowledge_entry', 'recordId', v_entry_ids[v_pos]);
    end loop;
  end if;

  -- --- Everything else, through its own repository's table ---------------
  for s in
    select * from extraction_suggestions
     where run_id = p_run_id and id = any(p_suggestion_ids)
       and kind <> 'knowledge_entry' and state <> 'confirmed'
     order by ordinal
  loop
    v_id := null;

    case s.kind
      when 'decision' then
        -- `proposed`. Never active, whatever the model suggested and whatever
        -- the user selected here: activation is a separate, visible act.
        insert into decisions (
          workspace_id, topic_id, subtopic_id, user_id, title, decision, reason,
          status, source_type, source_session_id, metadata
        ) values (
          v_run.workspace_id, p_topic_id, p_subtopic_id, auth.uid(),
          s.title, coalesce(s.content, s.title), s.reason,
          'proposed', 'manual', v_run.source_session_id,
          jsonb_build_object('extractionRunId', p_run_id, 'suggestionId', s.id,
                             'confidence', s.confidence, 'sourceReference', s.source_reference)
        ) returning id into v_id;

      when 'idea' then
        insert into ideas (
          workspace_id, topic_id, subtopic_id, user_id, title, rationale,
          status, source_type, source_session_id
        ) values (
          v_run.workspace_id, p_topic_id, p_subtopic_id, auth.uid(),
          s.title, coalesce(s.content, s.reason), 'suggested', 'manual',
          v_run.source_session_id
        ) returning id into v_id;

      when 'prompt' then
        -- The body is whatever is in `content`, verbatim. Version 1,
        -- `untested`, and no winning selection — an outcome nobody observed is
        -- not an outcome (6M).
        -- `prompts` carries no `source_session_id` column — provenance for a
        -- prompt lives in `metadata`, and the version below anchors the exact
        -- line it came from.
        insert into prompts (
          workspace_id, topic_id, subtopic_id, user_id, title, purpose,
          source_type, metadata
        ) values (
          v_run.workspace_id, p_topic_id, p_subtopic_id, auth.uid(),
          s.title, s.reason, 'manual',
          jsonb_build_object('extractionRunId', p_run_id, 'suggestionId', s.id,
                             'sourceSessionId', v_run.source_session_id,
                             'sourceReference', s.source_reference)
        ) returning id into v_id;

        select coalesce(max(version), 0) + 1 into v_version
          from prompt_versions where prompt_id = v_id;
        insert into prompt_versions (
          prompt_id, workspace_id, user_id, version, body, result, notes
        ) values (
          v_id, v_run.workspace_id, auth.uid(), v_version,
          coalesce(s.content, ''), 'untested', s.source_reference
        );

      when 'action' then
        select coalesce(max(position), 0) + 1 into v_pos from actions where topic_id = p_topic_id;
        insert into actions (
          workspace_id, topic_id, subtopic_id, user_id, kind, status, title,
          detail, position, source_session_id
        ) values (
          v_run.workspace_id, p_topic_id, p_subtopic_id, auth.uid(),
          coalesce(nullif(s.payload ->> 'actionKind', '')::action_kind, 'next_step'),
          coalesce(nullif(s.status_suggestion, '')::action_status, 'open'),
          s.title, s.content, v_pos, v_run.source_session_id
        ) returning id into v_id;

      when 'relationship' then
        -- Only between records that already exist, and only the polymorphic
        -- graph. Supersession has its own function and its own mandatory
        -- reason; routing it through here would be a way around that (6Q).
        if (s.payload ->> 'fromType') is not null and (s.payload ->> 'toType') is not null then
          insert into relationships (
            workspace_id, user_id, from_type, from_id, to_type, to_id,
            relationship_type, note
          ) values (
            v_run.workspace_id, auth.uid(),
            (s.payload ->> 'fromType')::entity_type, (s.payload ->> 'fromId')::uuid,
            (s.payload ->> 'toType')::entity_type, (s.payload ->> 'toId')::uuid,
            coalesce(nullif(s.payload ->> 'relationshipType', '')::relationship_type, 'relates_to'),
            s.reason
          )
          on conflict do nothing
          returning id into v_id;
        end if;

      when 'current_state' then
        -- Refused by name rather than ignored. Current State is compared and
        -- accepted in its own flow; letting it through a batch confirm is how
        -- a session summary would quietly become the project's state.
        v_skipped := v_skipped + 1;
        continue;

      else
        raise exception 'cannot confirm a suggestion of kind %', s.kind using errcode = '22023';
    end case;

    if v_id is not null then
      update extraction_suggestions
         set state = 'confirmed', created_record_id = v_id, created_record_kind = s.kind::text
       where id = s.id;
      v_created := v_created || jsonb_build_object(
        'suggestionId', s.id, 'kind', s.kind::text, 'recordId', v_id);
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  -- --- Counts, and what became of the source ----------------------------
  update extraction_runs
     set confirmed_count = (select count(*) from extraction_suggestions
                             where run_id = p_run_id and state = 'confirmed'),
         rejected_count  = (select count(*) from extraction_suggestions
                             where run_id = p_run_id and state = 'rejected')
   where id = p_run_id;

  -- The raw capture is never archived automatically while anything is still
  -- unreviewed (6AD): a half-reviewed item that disappeared from the Inbox
  -- would strand the rest of its suggestions.
  if v_run.ingestion_record_id is not null then
    update ingestion_records
       set status = case
             when exists (
               select 1 from extraction_suggestions
                where run_id = p_run_id and state in ('suggested', 'edited')
             ) then 'partially_processed'::ingestion_status
             else 'processed'::ingestion_status
           end,
           topic_id = coalesce(topic_id, p_topic_id),
           processed_at = now()
     where id = v_run.ingestion_record_id;
  end if;

  return jsonb_build_object(
    'runId', p_run_id,
    'created', v_created,
    'createdCount', jsonb_array_length(v_created),
    'skippedCount', v_skipped,
    'ingestionRecordId', v_record_id
  );
end;
$$;

-- PUBLIC first. PostgreSQL grants EXECUTE on a new function to PUBLIC by
-- default, and `anon` inherits it — so revoking from `anon` alone leaves the
-- function callable by an anonymous request. RLS would still refuse the writes,
-- because `auth.uid()` is null and no policy matches, but a function that
-- reaches a workspace's rows has no business being callable at all.
revoke all on function confirm_extraction_suggestions(uuid, uuid[], uuid, uuid) from public;
revoke all on function confirm_extraction_suggestions(uuid, uuid[], uuid, uuid) from anon;
grant execute on function confirm_extraction_suggestions(uuid, uuid[], uuid, uuid) to authenticated;
