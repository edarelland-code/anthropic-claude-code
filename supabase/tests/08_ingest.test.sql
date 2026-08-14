-- Phase 5: token-authenticated ingestion.
--
-- The endpoint is the first way into ContextShelf that is not a signed-in
-- browser, so the questions this suite has to answer are different from every
-- other suite's:
--
--   1. Is the token the only authority? A workspace id in the payload must be
--      unreadable, and user B's token must not reach user A's topic — reported
--      identically to a topic that does not exist.
--   2. Is a retry safe? Same token + same key returns the first receipt and
--      writes nothing. A reused key with different content is refused rather
--      than quietly answered with the wrong receipt.
--   3. Is delivery separated from authority? Technical facts land; Current
--      State, supersession, rejection, winning prompts and deletion do not, and
--      the refusal is explicit rather than a silent no-op.
--   4. Does an action close only when the session NAMES it? Omission must mean
--      nothing, or a delivery that forgot to mention an action would silently
--      complete work the user still intends to do.
--   5. Can anyone but the server call the function at all?
--
-- Everything runs against real policies: `ingest_from_token` resolves the
-- token, then drops to `authenticated` with that user's claims, so a failure
-- here is a real authorization failure and not a mocked one.

begin;

do $$
declare
  a_id uuid; b_id uuid;
  a_ws uuid; b_ws uuid;
  a_topic uuid; a_sub uuid; b_topic uuid;
  a_token uuid; b_token uuid; revoked_token uuid; expired_token uuid;
  a_hash text := 'hash-a-' || gen_random_uuid()::text;
  b_hash text := 'hash-b-' || gen_random_uuid()::text;
  rev_hash text := 'hash-rev-' || gen_random_uuid()::text;
  exp_hash text := 'hash-exp-' || gen_random_uuid()::text;
  keep_action uuid; done_action uuid; keep_by_id uuid;
  receipt jsonb; replay jsonb;
  n int; msg text; blocked boolean; sess uuid; rec uuid;
begin
  insert into auth.users (email) values ('ing-a@example.test') returning id into a_id;
  insert into auth.users (email) values ('ing-b@example.test') returning id into b_id;
  select id into a_ws from workspaces where owner_id = a_id;
  select id into b_ws from workspaces where owner_id = b_id;

  perform t.login(a_id);
  insert into topics (workspace_id, user_id, name, slug, goal, current_state)
  values (a_ws, a_id, 'DailyRelay', 'dailyrelay', 'Ship the relay', 'Icon work in progress')
  returning id into a_topic;
  insert into subtopics (workspace_id, topic_id, user_id, name, slug)
  values (a_ws, a_topic, a_id, 'Branding', 'branding') returning id into a_sub;

  -- The action that a later delivery will report as finished, and one it will
  -- never mention. Both start open.
  insert into actions (workspace_id, topic_id, user_id, kind, title, position)
  values (a_ws, a_topic, a_id, 'next_step', 'Wire the export button', 1)
  returning id into done_action;
  insert into actions (workspace_id, topic_id, user_id, kind, title, position)
  values (a_ws, a_topic, a_id, 'next_step', 'Write the migration guide', 2)
  returning id into keep_action;
  insert into actions (workspace_id, topic_id, user_id, kind, title, position)
  values (a_ws, a_topic, a_id, 'next_step', 'Close by id, not by title', 3)
  returning id into keep_by_id;

  insert into ingestion_tokens (workspace_id, user_id, name, token_hash, token_prefix, scope_topic_id)
  values (a_ws, a_id, 'Work laptop', a_hash, 'cs_live_aaaa', a_topic) returning id into a_token;
  insert into ingestion_tokens (workspace_id, user_id, name, token_hash, token_prefix, revoked_at)
  values (a_ws, a_id, 'Old laptop', rev_hash, 'cs_live_rrrr', now() - interval '1 day')
  returning id into revoked_token;
  insert into ingestion_tokens (workspace_id, user_id, name, token_hash, token_prefix, expires_at)
  values (a_ws, a_id, 'Short lived', exp_hash, 'cs_live_eeee', now() - interval '1 minute')
  returning id into expired_token;

  perform t.logout();
  perform t.login(b_id);
  insert into topics (workspace_id, user_id, name, slug)
  values (b_ws, b_id, 'Other project', 'other-project') returning id into b_topic;
  insert into ingestion_tokens (workspace_id, user_id, name, token_hash, token_prefix)
  values (b_ws, b_id, 'B laptop', b_hash, 'cs_live_bbbb') returning id into b_token;
  perform t.logout();

  -- =====================================================================
  -- 1. A REAL DELIVERY
  -- =====================================================================
  -- No workspace is passed. There is no parameter for one: the token's
  -- workspace is the only workspace this call can reach.

  receipt := ingest_from_token(
    a_hash, 'delivery-1', 'fingerprint-1',
    null, null,                                   -- scope comes from the token
    'claude-session-json', 'claude_code', 'application/json',
    E'User: implement the export button\nAssistant: done, tests pass.',
    jsonb_build_object('version', 1, 'source', 'claude_code'),
    'Export button', now(), null,
    jsonb_build_array(
      jsonb_build_object('knowledgeType', 'implementation', 'title', 'Export button wired',
                         'content', 'Added the handler and the receipt row.', 'sourceReference', 'msg:2'),
      jsonb_build_object('knowledgeType', 'bug', 'title', 'Clipboard threw on Firefox',
                         'content', 'writeText rejected without a user gesture.'),
      jsonb_build_object('knowledgeType', 'fix', 'title', 'Fall back to selecting the text')
    ),
    jsonb_build_object(
      'repoUrl', 'https://github.com/example/dailyrelay',
      'branch', 'phase-5',
      'commitSha', 'abc123def456',
      'filesChanged', jsonb_build_array('src/export.ts', 'src/export.test.ts'),
      'filesAdded', jsonb_build_array('src/receipt.ts'),
      'filesRemoved', jsonb_build_array('src/legacy-export.ts'),
      'buildStatus', 'passed',
      'testSummary', '163 passed, 0 failed'
    ),
    jsonb_build_object(
      'completedActions', jsonb_build_array(
        jsonb_build_object('title', 'Wire the export button'),
        jsonb_build_object('id', keep_by_id::text)
      ),
      'nextActions', jsonb_build_array(
        jsonb_build_object('kind', 'next_step', 'title', 'Ship the receipt view',
                           'detail', 'The endpoint returns ids; nothing renders them yet.')
      ),
      'proposedDecisions', jsonb_build_array(
        jsonb_build_object('title', 'Drop the legacy exporter',
                           'decision', 'Remove src/legacy-export.ts entirely',
                           'reason', 'Nothing has imported it since the rewrite.')
      )
    )
  );

  perform t.assert((receipt ->> 'replayed')::boolean = false, 'a first delivery reported itself as a replay');
  perform t.assert((receipt ->> 'topicId')::uuid = a_topic, 'the token scope did not select the topic');
  rec  := (receipt ->> 'ingestionRecordId')::uuid;
  sess := (receipt ->> 'sourceSessionId')::uuid;
  perform t.assert(sess is not null, 'no Layer 1 session was written');

  -- The funnel ran: Inbox record → Layer 1 → Layer 2, all linked (rule 10).
  perform t.assert(
    (select workspace_id from ingestion_records where id = rec) = a_ws,
    'the delivery was recorded against the wrong workspace');
  perform t.assert(
    (select count(*) from knowledge_entries where source_session_id = sess) = 3,
    'one session did not fan out into three entries');
  perform t.assert(
    (select count(*) from knowledge_entries
      where source_session_id = sess and knowledge_type in ('bug', 'fix')) = 2,
    'the bug and the fix did not both land');
  perform t.assert(
    (select count(*) from knowledge_entries where source_session_id = sess and source_reference is not null) >= 1,
    'provenance back into the transcript was lost');
  perform t.assert(
    (select raw_content from source_sessions where id = sess) like '%implement the export button%',
    'Layer 1 did not keep the verbatim session');

  -- Repository state, which is the whole point of automating this source.
  perform t.assert(
    (select repo_url from source_sessions where id = sess) = 'https://github.com/example/dailyrelay'
    and (select branch from source_sessions where id = sess) = 'phase-5'
    and (select commit_sha from source_sessions where id = sess) = 'abc123def456',
    'repository, branch or commit was not persisted');
  perform t.assert(
    (select build_status from source_sessions where id = sess) = 'passed'
    and (select test_summary from source_sessions where id = sess) = '163 passed, 0 failed',
    'build and test state were not persisted');

  -- Four paths were named across the three arrays.
  select count(*) into n from file_references where topic_id = a_topic and deleted_at is null;
  perform t.assert(n = 4, format('expected 4 file references, found %s', n));
  perform t.assert(
    (select count(*) from file_references
      where topic_id = a_topic and kind = 'repo_file' and storage_path is null and url is null) = 4,
    'a file reference claimed a stored object — nothing is uploaded');
  perform t.assert(
    (select metadata ->> 'lastChange' from file_references where path = 'src/legacy-export.ts') = 'removed',
    'the kind of change was not recorded on the reference');

  -- =====================================================================
  -- 2. ACTIONS: named, never inferred
  -- =====================================================================
  perform t.assert(
    (select status from actions where id = done_action) = 'done',
    'an action the delivery named as complete is still open');
  perform t.assert(
    (select status from actions where id = keep_by_id) = 'done',
    'an action named by id was not closed');
  perform t.assert(
    (select status from actions where id = keep_action) = 'open',
    'an action the delivery never mentioned was closed — omission is not evidence');
  perform t.assert(
    (select resolved_at from actions where id = done_action) is not null
    and (select source_session_id from actions where id = done_action) = sess,
    'a completed action lost its provenance');
  perform t.assert(
    (select count(*) from actions where topic_id = a_topic and status = 'open'
       and title = 'Ship the receipt view') = 1,
    'the new next action was not created');

  -- =====================================================================
  -- 3. AUTHORITY: a decision arrives PROPOSED
  -- =====================================================================
  perform t.assert(
    (select status from decisions where topic_id = a_topic) = 'proposed',
    'an automated delivery created an ACTIVE decision');
  perform t.assert(
    (select source_session_id from decisions where topic_id = a_topic) = sess,
    'the proposed decision has no provenance');
  perform t.assert(
    (select current_state from topics where id = a_topic) = 'Icon work in progress',
    'a delivery replaced Current State');

  -- The refusal is explicit. A silently ignored key would let a client believe
  -- a decision had been superseded when nothing happened.
  blocked := false;
  begin
    perform ingest_from_token(a_hash, null, null, null, null, 'claude-session-json',
      'claude_code', 'application/json', 'x', null, null, null, null, '[]'::jsonb, null,
      jsonb_build_object('supersedeDecisions', jsonb_build_array(jsonb_build_object('id', '1'))));
  exception when others then blocked := true; msg := sqlerrm;
  end;
  perform t.assert(blocked, 'a delivery was allowed to ask for a decision to be superseded');
  perform t.assert(msg like '%supersedeDecisions%', format('the refusal did not name the operation: %s', msg));

  blocked := false;
  begin
    perform ingest_from_token(a_hash, null, null, null, null, 'claude-session-json',
      'claude_code', 'application/json', 'x', null, null, null, null, '[]'::jsonb, null,
      jsonb_build_object('currentState', 'everything is finished'));
  exception when others then blocked := true; msg := sqlerrm;
  end;
  perform t.assert(blocked and msg like '%currentState%', 'a delivery was allowed to set Current State');

  -- =====================================================================
  -- 4. IDEMPOTENCY
  -- =====================================================================
  select count(*) into n from knowledge_entries where topic_id = a_topic;

  replay := ingest_from_token(
    a_hash, 'delivery-1', 'fingerprint-1', null, null,
    'claude-session-json', 'claude_code', 'application/json',
    E'User: implement the export button\nAssistant: done, tests pass.',
    null, 'Export button', now(), null,
    jsonb_build_array(jsonb_build_object('knowledgeType', 'implementation', 'title', 'Export button wired')),
    null, null
  );

  perform t.assert((replay ->> 'replayed')::boolean = true, 'a repeated Idempotency-Key was not reported as a replay');
  perform t.assert(replay ->> 'ingestionRecordId' = rec::text, 'a replay returned a different receipt');
  perform t.assert(
    (select count(*) from knowledge_entries where topic_id = a_topic) = n,
    'a replay created records');

  -- Same key, different payload: refused rather than answered with the wrong
  -- receipt. This is a client bug and hiding it would lose a real delivery.
  blocked := false;
  begin
    perform ingest_from_token(a_hash, 'delivery-1', 'DIFFERENT-fingerprint', null, null,
      'claude-session-json', 'claude_code', 'application/json', 'other content', null,
      null, null, null, '[]'::jsonb, null, null);
  exception when others then blocked := true; msg := sqlerrm;
  end;
  perform t.assert(blocked, 'one Idempotency-Key was accepted for two different payloads');
  perform t.assert(msg like '%Idempotency-Key%', format('unhelpful conflict message: %s', msg));

  -- Idempotency is not duplicate detection: the SAME content under a NEW key
  -- is a new delivery, and it is the user who decides whether it is a
  -- duplicate (rule 17).
  receipt := ingest_from_token(
    a_hash, 'delivery-2', 'fingerprint-2', null, null,
    'claude-session-json', 'claude_code', 'application/json',
    E'User: implement the export button\nAssistant: done, tests pass.',
    null, 'Export button', now(), null,
    jsonb_build_array(jsonb_build_object('knowledgeType', 'implementation', 'title', 'Export button wired')),
    null, null
  );
  perform t.assert((receipt ->> 'replayed')::boolean = false, 'a new key was treated as a replay');
  perform t.assert(receipt ->> 'ingestionRecordId' <> rec::text, 'a new delivery reused the first record');
  perform t.assert(
    (select count(*) from knowledge_entries where topic_id = a_topic) = n + 1,
    'the second delivery of the same content did not create its own entry');

  -- =====================================================================
  -- 5. THE TOKEN IS THE ONLY AUTHORITY
  -- =====================================================================

  -- B's token, A's topic. Reported exactly as a topic that does not exist —
  -- a different message would confirm that A's topic id is real.
  blocked := false;
  begin
    perform ingest_from_token(b_hash, null, null, a_topic, null, 'claude-session-json',
      'claude_code', 'application/json', 'trying to write into A', null, null, null, null,
      jsonb_build_array(jsonb_build_object('knowledgeType', 'progress', 'title', 'should never exist')),
      null, null);
  exception when others then blocked := true; msg := sqlerrm;
  end;
  perform t.assert(blocked, 'user B''s token reached user A''s topic');
  perform t.assert(msg = 'no such topic', format('the refusal leaked something: %s', msg));
  perform t.assert(
    (select count(*) from knowledge_entries where topic_id = a_topic and title = 'should never exist') = 0,
    'a cross-workspace delivery wrote a row');

  -- A random uuid gets the same answer as a real topic in another workspace.
  blocked := false;
  begin
    perform ingest_from_token(b_hash, null, null, gen_random_uuid(), null, 'claude-session-json',
      'claude_code', 'application/json', 'x', null, null, null, null, '[]'::jsonb, null, null);
  exception when others then blocked := true; msg := sqlerrm;
  end;
  perform t.assert(blocked and msg = 'no such topic',
    'an absent topic and another user''s topic answered differently');

  -- A subtopic of A's topic, named by B.
  blocked := false;
  begin
    perform ingest_from_token(b_hash, null, null, b_topic, a_sub, 'claude-session-json',
      'claude_code', 'application/json', 'x', null, null, null, null, '[]'::jsonb, null, null);
  exception when others then blocked := true; msg := sqlerrm;
  end;
  perform t.assert(blocked and msg = 'no such subtopic', 'a foreign subtopic was accepted');

  -- Revoked, expired, and never-existed are one answer.
  for msg in select unnest(array[rev_hash, exp_hash, 'hash-that-was-never-issued'])
  loop
    blocked := false;
    begin
      perform ingest_from_token(msg, null, null, null, null, 'claude-session-json',
        'claude_code', 'application/json', 'x', null, null, null, null, '[]'::jsonb, null, null);
    exception when others then blocked := true;
    end;
    perform t.assert(blocked, 'an invalid token was accepted');
  end loop;

  blocked := false;
  begin
    perform ingest_from_token(rev_hash, null, null, null, null, 'claude-session-json',
      'claude_code', 'application/json', 'x', null, null, null, null, '[]'::jsonb, null, null);
  exception when others then blocked := true; msg := sqlerrm;
  end;
  perform t.assert(msg = 'that ingestion token is not valid',
    format('a revoked token got a distinguishable message: %s', msg));

  -- The rows a delivery writes belong to the token's owner, not to whoever
  -- happened to be connected.
  perform t.assert(
    (select user_id from source_sessions where id = sess) = a_id,
    'the session was attributed to the wrong user');
  perform t.assert(
    (select last_used_at from ingestion_tokens where id = a_token) is not null,
    'last_used_at was not stamped, so a live token on a forgotten machine is invisible');

  -- =====================================================================
  -- 6. THE RECORDS REACH THE REST OF THE PRODUCT
  -- =====================================================================
  perform t.login(a_id);
  perform t.assert(
    (select count(*) from timeline_events where topic_id = a_topic
       and entity_type = 'knowledge_entry') >= 3,
    'ingested work is missing from the Timeline');
  perform t.assert(
    (select count(*) from search_documents
      where topic_id = a_topic and search_vector @@ websearch_to_tsquery('english', 'clipboard')) >= 1,
    'ingested work is not findable through search');
  -- The delivery ledger is the user's own; it is not a global log.
  perform t.assert(
    (select count(*) from ingestion_deliveries where workspace_id = a_ws) = 2,
    'the delivery ledger did not record both keyed deliveries');
  perform t.logout();

  perform t.login(b_id);
  perform t.assert(
    (select count(*) from ingestion_deliveries) = 0,
    'user B can read user A''s delivery ledger');
  perform t.assert(
    (select count(*) from ingestion_tokens) = 1,
    'user B can see user A''s tokens');

  -- Nobody but the server may call the function. `authenticated` holding
  -- EXECUTE would mean any signed-in user could ingest as anyone whose token
  -- hash they could obtain.
  perform t.assert(
    not has_function_privilege('authenticated',
      'ingest_from_token(text,text,text,uuid,uuid,text,source_type,text,text,jsonb,text,timestamptz,text,jsonb,jsonb,jsonb)',
      'execute'),
    'authenticated can execute ingest_from_token');
  perform t.assert(
    not has_function_privilege('anon',
      'ingest_from_token(text,text,text,uuid,uuid,text,source_type,text,text,jsonb,text,timestamptz,text,jsonb,jsonb,jsonb)',
      'execute'),
    'anon can execute ingest_from_token');
  perform t.assert(
    has_function_privilege('service_role',
      'ingest_from_token(text,text,text,uuid,uuid,text,source_type,text,text,jsonb,text,timestamptz,text,jsonb,jsonb,jsonb)',
      'execute'),
    'the server cannot execute ingest_from_token');
  perform t.logout();

  raise notice 'Ingestion: a token authenticates and its workspace is the only one reachable; revoked, expired and unknown tokens are one answer; a retry replays its receipt and writes nothing while a reused key with new content is refused; technical facts land, decisions arrive proposed, Current State is untouched and forbidden operations are named rather than ignored; an action closes only when the delivery names it; and the work reaches the Timeline and search.';
end $$;

rollback;
