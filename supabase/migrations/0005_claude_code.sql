-- ContextShelf — Phase 5: Claude Code ingestion.
--
-- Phase 0 modelled almost all of this: `ingestion_tokens` already existed with a
-- unique `token_hash`, and `source_sessions` already carried `repo_url`,
-- `branch`, `commit_sha`, the three file arrays, `build_status` and
-- `test_summary`. What was missing was the part that makes a token usable
-- without a browser session, and the part that makes a retry safe.
--
-- Three things are added here:
--
--   1. Token scope and identity — a prefix so a token can be recognised in a
--      list without storing the secret, an optional default Topic/Subtopic, an
--      expiry, and a link to the token it replaced.
--
--   2. `ingestion_deliveries` — the Idempotency-Key ledger. A retry with the
--      same token and key returns the original receipt and writes nothing.
--      This is NOT duplicate detection: duplicate detection compares content
--      and proposes a merge to a person (rule 17); idempotency compares a key
--      the client chose and refuses to act twice on one delivery.
--
--   3. `ingest_from_token()` — the only way a token becomes writes.
--
-- On (3), the design point worth stating: it does NOT contain its own copy of
-- the ingestion logic. `persist_ingestion()` is still the single write path
-- (rule 20). The function resolves the token, then *becomes the token's owner*
-- — sets the JWT claims and `set local role authenticated` — and calls the same
-- function the Inbox calls. Every RLS policy therefore applies to a token
-- request exactly as it applies to that person in a browser, rather than being
-- re-implemented in a second, subtly different place that could drift.
--
-- The workspace comes from the token row and nothing else. A workspace id in
-- the payload is not read, because a caller who could name their own workspace
-- would only need a valid token from anywhere to write into any workspace.

-- ---------------------------------------------------------------------------
-- 1. Token scope and identity
-- ---------------------------------------------------------------------------

alter table ingestion_tokens
  add column if not exists token_prefix      text,
  add column if not exists scope_topic_id    uuid,
  add column if not exists scope_subtopic_id uuid,
  add column if not exists expires_at        timestamptz,
  add column if not exists rotated_from_id   uuid;

do $$
begin
  -- Composite, per AD-11: RLS authorises on the row's own workspace_id, so a
  -- plain FK to topics(id) would let a token in workspace B name a topic in
  -- workspace A and still satisfy the with-check.
  if not exists (select 1 from pg_constraint where conname = 'ingestion_tokens_scope_topic_fk') then
    alter table ingestion_tokens
      add constraint ingestion_tokens_scope_topic_fk
      foreign key (scope_topic_id, workspace_id) references topics (id, workspace_id)
      on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ingestion_tokens_scope_subtopic_fk') then
    alter table ingestion_tokens
      add constraint ingestion_tokens_scope_subtopic_fk
      foreign key (scope_subtopic_id, workspace_id) references subtopics (id, workspace_id)
      on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ingestion_tokens_rotated_from_fk') then
    alter table ingestion_tokens
      add constraint ingestion_tokens_rotated_from_fk
      foreign key (rotated_from_id) references ingestion_tokens (id) on delete set null;
  end if;
  -- A subtopic without its topic is not a scope, it is an ambiguity.
  if not exists (select 1 from pg_constraint where conname = 'ingestion_tokens_scope_ck') then
    alter table ingestion_tokens
      add constraint ingestion_tokens_scope_ck
      check (scope_subtopic_id is null or scope_topic_id is not null);
  end if;
end $$;

create index if not exists tokens_workspace_idx
  on ingestion_tokens (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. The delivery ledger
-- ---------------------------------------------------------------------------

create table if not exists ingestion_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references workspaces(id) on delete cascade,
  token_id            uuid not null references ingestion_tokens(id) on delete cascade,
  idempotency_key     text not null,
  -- A hash of the request body. A retry that reuses a key for DIFFERENT
  -- content is a client bug, and returning the first receipt for it would hide
  -- the bug and lose the second delivery. It is refused instead.
  request_fingerprint text not null,
  ingestion_record_id uuid references ingestion_records(id) on delete set null,
  receipt             jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create unique index if not exists deliveries_key_uk
  on ingestion_deliveries (token_id, idempotency_key);
create index if not exists deliveries_workspace_idx
  on ingestion_deliveries (workspace_id, created_at desc);

alter table ingestion_deliveries enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ingestion_deliveries'
      and policyname = 'ingestion_deliveries_member_all'
  ) then
    create policy ingestion_deliveries_member_all on ingestion_deliveries for all
      using (is_workspace_member(workspace_id))
      with check (is_workspace_member(workspace_id));
  end if;
end $$;

grant select, insert, update, delete on ingestion_deliveries to authenticated;

-- ---------------------------------------------------------------------------
-- 3. persist_ingestion learns the rest of the Claude Code state
-- ---------------------------------------------------------------------------
--
-- Unchanged except for three columns. `build_status` and `test_summary` were
-- in the table from Phase 0 and were never written, which meant the Phase 4
-- Claude Code Resume had a "Build / Tests" line that could only ever read
-- empty. Same single write path; it now carries the fields the schema already
-- had room for.

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
      files_changed, files_added, files_removed,
      build_status, test_summary, artifacts, metadata
    ) values (
      p_workspace_id, auth.uid(), p_topic_id, coalesce(p_source_type, 'manual'),
      p_title, p_external_url, coalesce(p_occurred_at, now()), p_raw,
      p_code ->> 'repoUrl', p_code ->> 'branch', p_code ->> 'commitSha',
      coalesce(p_code -> 'filesChanged', '[]'::jsonb),
      coalesce(p_code -> 'filesAdded', '[]'::jsonb),
      coalesce(p_code -> 'filesRemoved', '[]'::jsonb),
      p_code ->> 'buildStatus', p_code ->> 'testSummary',
      coalesce(p_code -> 'artifacts', '[]'::jsonb),
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

-- ---------------------------------------------------------------------------
-- 4. Token-authenticated ingestion
-- ---------------------------------------------------------------------------

/**
 * What a delivery is allowed to change.
 *
 * An explicit allowlist, in the spirit of AD-20. Silently ignoring an unknown
 * key would be the worst outcome: a client that sent `supersedeDecisions`
 * would get a 200 and believe a decision had been replaced. Naming the key in
 * the error is what makes "Claude Code cannot do that" checkable rather than
 * merely intended.
 */
create or replace function assert_ingest_work_allowed(p_work jsonb)
returns void language plpgsql immutable parallel safe as $$
declare
  k text;
begin
  if p_work is null or p_work = '{}'::jsonb then return; end if;
  if jsonb_typeof(p_work) <> 'object' then
    raise exception 'work must be an object' using errcode = '22023';
  end if;

  for k in select jsonb_object_keys(p_work) loop
    if k not in ('completedActions', 'nextActions', 'proposedDecisions') then
      raise exception
        'a delivery cannot perform "%". An ingestion token may record technical work; replacing Current State, superseding or rejecting a decision, rejecting an idea, choosing a winning prompt, deleting a record or resolving a conflict are review operations and are only available to a signed-in person.',
        k
      using errcode = '42501';
    end if;
  end loop;
end;
$$;

/**
 * The whole endpoint, as one transaction.
 *
 * SECURITY INVOKER, and EXECUTE is granted to `service_role` alone — the API
 * route holds that key. No browser client can call this and neither can a
 * signed-in user, which matters because the first argument is a token hash:
 * anyone who could call it with a hash they had obtained could write as its
 * owner.
 *
 * **What enforces the workspace boundary here is this function's own checks,
 * not row-level security.** That is worth stating plainly rather than leaving
 * to be discovered. `service_role` bypasses RLS by design — it has to, because
 * an ingestion request carries no Supabase session for a policy to read — so
 * the topic and subtopic lookups below are deliberately scoped to
 * `v_token.workspace_id`, and every write derives its workspace from the token
 * row rather than from any argument. The original design dropped to
 * `authenticated` so the ordinary policies would apply; PostgreSQL forbids
 * `SET ROLE` inside a SECURITY DEFINER function, and a version that silently
 * failed to switch would have looked identical while enforcing nothing. The
 * checks are therefore asserted in `08_ingest.test.sql` rather than assumed —
 * user B's token reaching user A's topic is a test, not a policy.
 *
 * The JWT claim IS still set, because `auth.uid()` is how `persist_ingestion`
 * and every trigger stamp authorship. Without it the rows would be written
 * with no author at all.
 */
create or replace function ingest_from_token(
  p_token_hash          text,
  p_idempotency_key     text,
  p_request_fingerprint text,
  p_topic_id            uuid,
  p_subtopic_id         uuid,
  p_adapter_id          text,
  p_source_type         source_type,
  p_content_type        text,
  p_raw                 text,
  p_payload             jsonb,
  p_title               text,
  p_occurred_at         timestamptz,
  p_external_url        text,
  p_segments            jsonb,
  p_code                jsonb,
  p_work                jsonb
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_token      ingestion_tokens%rowtype;
  v_topic_id   uuid;
  v_subtopic_id uuid;
  v_existing   ingestion_deliveries%rowtype;
  v_record     ingestion_records%rowtype;
  v_session_id uuid;
  v_receipt    jsonb;
  v_file_ids   uuid[] := '{}';
  v_done_ids   uuid[] := '{}';
  v_next_ids   uuid[] := '{}';
  v_decision_ids uuid[] := '{}';
  v_record_id  uuid;
  v_id         uuid;
  v_path       text;
  v_change     text;
  v_match_id   uuid;
  v_pos        integer;
  item         jsonb;
begin
  perform assert_ingest_work_allowed(p_work);

  -- --- The token is the authentication ------------------------------------
  select * into v_token from ingestion_tokens where token_hash = p_token_hash;
  if not found or v_token.revoked_at is not null
     or (v_token.expires_at is not null and v_token.expires_at <= now()) then
    -- One message for absent, revoked and expired alike. Distinguishing them
    -- would tell an attacker which of their guesses had ever been real.
    raise exception 'that ingestion token is not valid' using errcode = '28000';
  end if;

  -- --- Idempotency, before anything is written ----------------------------
  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    select * into v_existing from ingestion_deliveries
     where token_id = v_token.id and idempotency_key = p_idempotency_key;
    if found then
      if v_existing.request_fingerprint is distinct from p_request_fingerprint then
        raise exception
          'that Idempotency-Key was already used for a different payload'
          using errcode = '23505';
      end if;
      return v_existing.receipt || jsonb_build_object('replayed', true);
    end if;
  end if;

  -- --- Scope. The token's workspace is authoritative ----------------------
  v_topic_id    := coalesce(p_topic_id, v_token.scope_topic_id);
  v_subtopic_id := coalesce(p_subtopic_id, case when p_topic_id is null then v_token.scope_subtopic_id end);

  if v_topic_id is not null then
    -- Checked against the TOKEN's workspace. A topic that exists in someone
    -- else's workspace is reported exactly as one that does not exist at all.
    if not exists (
      select 1 from topics
       where id = v_topic_id and workspace_id = v_token.workspace_id and deleted_at is null
    ) then
      raise exception 'no such topic' using errcode = '42P01';
    end if;
  end if;
  if v_subtopic_id is not null then
    if v_topic_id is null then
      raise exception 'a subtopic cannot be given without its topic' using errcode = '22023';
    end if;
    if not exists (
      select 1 from subtopics
       where id = v_subtopic_id and topic_id = v_topic_id
         and workspace_id = v_token.workspace_id and deleted_at is null
    ) then
      raise exception 'no such subtopic' using errcode = '42P01';
    end if;
  end if;

  -- --- Write as the token's owner ------------------------------------------
  --
  -- Transaction-local. `auth.uid()` reads this claim, so the Inbox record, the
  -- Layer 1 session and every entry below are authored by the person who
  -- created the token rather than by nobody.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_token.user_id, 'role', 'authenticated')::text, true);

  -- The same function the Inbox calls. Not a copy of it (rule 20).
  select persist_ingestion(
    v_token.workspace_id, p_adapter_id, coalesce(p_source_type, 'claude_code'),
    coalesce(p_content_type, 'application/json'), p_raw, p_payload, p_title,
    p_occurred_at, p_external_url, v_topic_id, v_subtopic_id, p_segments, p_code
  ) into v_record_id;

  select * into v_record from ingestion_records where id = v_record_id;
  v_session_id := v_record.created_source_session_id;

  if v_topic_id is not null then
    -- --- File references, one per path the session touched ----------------
    --
    -- References, never uploads (rule: do not fake file uploads). `last_seen_at`
    -- is what makes a re-touched file update rather than accumulate.
    for v_path, v_change in
      select value #>> '{}', kind
        from (
          select 'changed'::text as kind, value from jsonb_array_elements(coalesce(p_code -> 'filesChanged', '[]'::jsonb))
          union all
          select 'added', value from jsonb_array_elements(coalesce(p_code -> 'filesAdded', '[]'::jsonb))
          union all
          select 'removed', value from jsonb_array_elements(coalesce(p_code -> 'filesRemoved', '[]'::jsonb))
        ) f
    loop
      if v_path is null or btrim(v_path) = '' then continue; end if;

      -- Cleared every iteration on purpose: plpgsql leaves a RETURNING target
      -- untouched when no row matched, so a stale id here would silently skip
      -- the insert and report the previous file's id as this one's.
      v_id := null;

      update file_references
         set last_seen_at = now(),
             commit_sha = coalesce(p_code ->> 'commitSha', commit_sha),
             branch     = coalesce(p_code ->> 'branch', branch),
             source_session_id = coalesce(v_session_id, source_session_id),
             metadata = metadata || jsonb_build_object('lastChange', v_change)
       where topic_id = v_topic_id and path = v_path and deleted_at is null
      returning id into v_id;

      if v_id is null then
        insert into file_references (
          workspace_id, topic_id, subtopic_id, user_id, kind, path,
          repo_url, branch, commit_sha, source_session_id, last_seen_at, metadata
        ) values (
          v_token.workspace_id, v_topic_id, v_subtopic_id, v_token.user_id,
          'repo_file', v_path, p_code ->> 'repoUrl', p_code ->> 'branch',
          p_code ->> 'commitSha', v_session_id, now(),
          jsonb_build_object('lastChange', v_change)
        ) returning id into v_id;
      end if;

      v_file_ids := v_file_ids || v_id;
    end loop;

    -- --- Actions that the session says are finished -----------------------
    --
    -- Only what the payload NAMES. An action absent from a later delivery is
    -- not evidence it was completed — it is evidence of nothing, and closing it
    -- would silently lose work the user still intends to do.
    for item in select * from jsonb_array_elements(coalesce(p_work -> 'completedActions', '[]'::jsonb))
    loop
      v_id := null;
      -- Cast only what is shaped like a uuid. A malformed id is a bad request,
      -- not an abort halfway through a delivery that has already written rows.
      v_match_id := case
        when (item ->> 'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (item ->> 'id')::uuid
      end;

      update actions
         set status = 'done',
             resolved_at = now(),
             source_session_id = coalesce(v_session_id, source_session_id)
       where topic_id = v_topic_id
         and deleted_at is null
         and status not in ('done', 'dropped')
         and (
           (v_match_id is not null and id = v_match_id)
           or (v_match_id is null and lower(btrim(title)) = lower(btrim(coalesce(item ->> 'title', ''))))
         )
      returning id into v_id;
      if v_id is not null then
        v_done_ids := v_done_ids || v_id;
      end if;
    end loop;

    -- --- The new next steps ------------------------------------------------
    select coalesce(max(position), 0) into v_pos from actions where topic_id = v_topic_id;
    for item in select * from jsonb_array_elements(coalesce(p_work -> 'nextActions', '[]'::jsonb))
    loop
      if coalesce(btrim(item ->> 'title'), '') = '' then continue; end if;
      v_pos := v_pos + 1;
      insert into actions (
        workspace_id, topic_id, subtopic_id, user_id, kind, status, title, detail,
        position, source_session_id
      ) values (
        v_token.workspace_id, v_topic_id, v_subtopic_id, v_token.user_id,
        coalesce((item ->> 'kind')::action_kind, 'next_step'), 'open',
        btrim(item ->> 'title'), item ->> 'detail', v_pos, v_session_id
      ) returning id into v_id;
      v_next_ids := v_next_ids || v_id;
    end loop;

    -- --- Decisions arrive PROPOSED ----------------------------------------
    --
    -- Never `active`. A decision is the most authoritative record in the
    -- product and an automated delivery does not get to make one — it gets to
    -- put one in front of a person. `proposed` is a real status from Phase 0,
    -- so nothing new had to be invented to hold a thing that is not yet true.
    for item in select * from jsonb_array_elements(coalesce(p_work -> 'proposedDecisions', '[]'::jsonb))
    loop
      if coalesce(btrim(item ->> 'title'), '') = ''
         or coalesce(btrim(item ->> 'decision'), '') = '' then continue; end if;
      insert into decisions (
        workspace_id, topic_id, subtopic_id, user_id, title, decision, reason,
        alternatives, status, source_type, source_session_id, metadata
      ) values (
        v_token.workspace_id, v_topic_id, v_subtopic_id, v_token.user_id,
        btrim(item ->> 'title'), btrim(item ->> 'decision'), item ->> 'reason',
        coalesce(item -> 'alternatives', '[]'::jsonb), 'proposed',
        coalesce(p_source_type, 'claude_code'), v_session_id,
        jsonb_build_object('proposedBy', 'claude_code', 'awaitingReview', true)
      ) returning id into v_id;
      v_decision_ids := v_decision_ids || v_id;
    end loop;
  end if;

  perform set_config('request.jwt.claims', '', true);

  v_receipt := jsonb_build_object(
    'ingestionRecordId', v_record.id,
    'status',            v_record.status,
    'topicId',           v_topic_id,
    'subtopicId',        v_subtopic_id,
    'sourceSessionId',   v_session_id,
    'entryIds',          to_jsonb(coalesce(v_record.created_entry_ids, '{}'::uuid[])),
    'fileReferenceIds',  to_jsonb(v_file_ids),
    'completedActionIds',to_jsonb(v_done_ids),
    'nextActionIds',     to_jsonb(v_next_ids),
    'proposedDecisionIds', to_jsonb(v_decision_ids),
    'replayed',          false
  );

  -- Housekeeping as the definer again: `last_used_at` is how a person spots a
  -- token that is still live on a machine they have forgotten about.
  update ingestion_tokens set last_used_at = now() where id = v_token.id;

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    insert into ingestion_deliveries (
      workspace_id, token_id, idempotency_key, request_fingerprint,
      ingestion_record_id, receipt
    ) values (
      v_token.workspace_id, v_token.id, p_idempotency_key, p_request_fingerprint,
      v_record.id, v_receipt
    );
  end if;

  return v_receipt;
end;
$$;

revoke all on function ingest_from_token(
  text, text, text, uuid, uuid, text, source_type, text, text, jsonb, text,
  timestamptz, text, jsonb, jsonb, jsonb
) from public;
revoke all on function ingest_from_token(
  text, text, text, uuid, uuid, text, source_type, text, text, jsonb, text,
  timestamptz, text, jsonb, jsonb, jsonb
) from anon, authenticated;
grant execute on function ingest_from_token(
  text, text, text, uuid, uuid, text, source_type, text, text, jsonb, text,
  timestamptz, text, jsonb, jsonb, jsonb
) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Deliveries participate in search as history, like every other record
-- ---------------------------------------------------------------------------
-- They do not. A delivery holds a key and a hash — nothing a person would ever
-- search for — so it gets no search vector. Recorded here because "why is this
-- table missing from search_documents" is a question worth answering once.
