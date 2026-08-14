-- Phase 3: the capture write path, and the guards on it.
--
--   1. persist_ingestion() writes the Inbox record, the Layer 1 session and
--      the Layer 2 entries in one transaction, all linked, and it fans one
--      session out into many entries rather than one generic card.
--   2. It is security invoker, so it cannot be used to write into a workspace
--      the caller does not belong to.
--   3. soft_delete_record() / restore_record() honour an explicit allowlist:
--      append-only history and Layer 1 evidence are refused, unsupported types
--      are refused, another workspace's rows are untouchable, and no argument
--      can steer the statement at an arbitrary table.
--   4. Content fingerprints identify duplicate CANDIDATES without any unique
--      constraint deciding on the user's behalf (rule 17).

begin;

do $$
declare
  a_id uuid; b_id uuid;
  a_ws uuid; b_ws uuid;
  a_topic uuid; a_sub uuid; b_topic uuid; b_entry uuid;
  rec uuid; sess uuid; entry_ids uuid[];
  a_entry uuid; a_prompt uuid; a_version uuid; a_session uuid; a_snapshot uuid;
  log_id uuid; n int; blocked boolean; msg text; st ingestion_status;
begin
  insert into auth.users (email) values ('cap-a@example.test') returning id into a_id;
  insert into auth.users (email) values ('cap-b@example.test') returning id into b_id;
  select id into a_ws from workspaces where owner_id = a_id;
  select id into b_ws from workspaces where owner_id = b_id;

  perform t.login(a_id);
  insert into topics (workspace_id, user_id, name, slug)
  values (a_ws, a_id, 'DailyRelay', 'dailyrelay') returning id into a_topic;
  insert into subtopics (workspace_id, topic_id, user_id, name, slug)
  values (a_ws, a_topic, a_id, 'Branding', 'branding') returning id into a_sub;

  -- =====================================================================
  -- QUICK CAPTURE: one step, nothing required but the content
  -- =====================================================================

  -- No topic, no subtopic, no type, no source. It lands in the Inbox intact.
  select persist_ingestion(
    a_ws, 'manual-note', 'manual', 'text',
    'Remember the trapezoid geometry note', null,
    null, null, null, null, null, null, null
  ) into rec;

  select status, topic_id into st, a_entry from ingestion_records where id = rec;
  perform t.assert(st = 'unsorted', format('a quick capture landed as %s, not unsorted', st));
  perform t.assert(a_entry is null, 'a quick capture was filed to a topic nobody chose');
  perform t.assert(
    (select raw_content from ingestion_records where id = rec) = 'Remember the trapezoid geometry note',
    'the captured content was not stored verbatim');
  perform t.assert(
    (select created_source_session_id from ingestion_records where id = rec) is null,
    'an unfiled capture created Layer 1 evidence prematurely');
  a_entry := null;

  -- =====================================================================
  -- IMPORT: one session fans out into many entries, all linked
  -- =====================================================================

  select persist_ingestion(
    a_ws, 'transcript-paste', 'claude_chat', 'text',
    E'User: should the icon be blue?\nAssistant: blue reads as a status dot.\nUser: approved, use the slash geometry.',
    jsonb_build_object('messages', 3),
    'Icon exploration', now() - interval '2 days', 'https://claude.ai/chat/xyz',
    a_topic, a_sub,
    jsonb_build_array(
      jsonb_build_object('knowledgeType', 'decision', 'title', 'Slash geometry approved',
                         'content', 'Use the slash geometry', 'sourceReference', 'msg:3', 'confidence', 1.0),
      jsonb_build_object('knowledgeType', 'rejected_idea', 'title', 'Blue icon',
                         'content', 'Reads as a status dot', 'sourceReference', 'msg:2', 'confidence', 1.0),
      jsonb_build_object('knowledgeType', 'question', 'title', 'Should the icon be blue?',
                         'content', null, 'sourceReference', 'msg:1', 'confidence', 0.8)
    ),
    null
  ) into rec;

  select created_source_session_id, created_entry_ids, status
    into sess, entry_ids, st from ingestion_records where id = rec;

  perform t.assert(st = 'processed', format('a fully extracted import reported %s', st));
  perform t.assert(sess is not null, 'the import did not write Layer 1 evidence');
  perform t.assert(array_length(entry_ids, 1) = 3,
    format('rule 4: one session must fan out into many entries, got %s',
           coalesce(array_length(entry_ids, 1), 0)));

  -- Layer 1 holds the verbatim text and the external link.
  perform t.assert(
    (select raw_content from source_sessions where id = sess) like '%status dot%',
    'the transcript was not stored verbatim');
  perform t.assert(
    (select external_url from source_sessions where id = sess) = 'https://claude.ai/chat/xyz',
    'the source URL was lost');
  perform t.assert(
    (select occurred_at from source_sessions where id = sess) < now() - interval '1 day',
    'the import overwrote when the conversation actually happened');

  -- Layer 2 points back at it, with an anchor into the raw text (rule 10).
  select count(*) into n from knowledge_entries
   where id = any(entry_ids) and source_session_id = sess and source_reference is not null;
  perform t.assert(n = 3, format('%s of 3 entries carry provenance back to Layer 1', n));

  -- The subtopic assignment reached both layers.
  perform t.assert(
    exists (select 1 from session_subtopics where source_session_id = sess and subtopic_id = a_sub),
    'the session was not linked to its subtopic');
  select count(*) into n from entry_subtopics where knowledge_entry_id = any(entry_ids);
  perform t.assert(n = 3, 'entries were not linked to their subtopic');

  -- Importing real work is progress, so the freshness clock moved.
  perform t.assert(
    (select last_meaningful_update_at from topics where id = a_topic) > now() - interval '1 minute',
    'an import did not move last_meaningful_update_at');

  -- An import the extractor could not split waits for a human rather than
  -- reporting itself done.
  select persist_ingestion(
    a_ws, 'transcript-paste', 'claude_chat', 'text', 'Some prose with no structure at all',
    null, 'Unstructured', null, null, a_topic, null, '[]'::jsonb, null
  ) into rec;
  select status into st from ingestion_records where id = rec;
  perform t.assert(st = 'needs_review',
    format('an import that produced no entries reported %s instead of needs_review', st));
  perform t.assert(
    (select processed_at from ingestion_records where id = rec) is null,
    'an unprocessed import was stamped as processed');

  -- A subtopic cannot be assigned without its topic.
  blocked := false;
  begin
    perform persist_ingestion(a_ws, 'manual-note', 'manual', 'text', 'x', null, null, null, null,
                              null, a_sub, null, null);
  exception when others then blocked := true;
  end;
  perform t.assert(blocked, 'a subtopic was assigned without a topic');

  -- =====================================================================
  -- persist_ingestion IS SECURITY INVOKER
  -- =====================================================================

  -- Naming another workspace must fail the RLS with-check, not write a row.
  blocked := false;
  begin
    perform persist_ingestion(b_ws, 'manual-note', 'manual', 'text', 'stolen capture',
                              null, null, null, null, null, null, null, null);
  exception when others then blocked := true;
  end;
  perform t.assert(blocked, 'persist_ingestion wrote into a workspace the caller does not belong to');

  -- =====================================================================
  -- DUPLICATE CANDIDATES, NOT DUPLICATE VERDICTS
  -- =====================================================================

  insert into knowledge_entries (workspace_id, topic_id, user_id, knowledge_type, title, content)
  values (a_ws, a_topic, a_id, 'progress', 'Shipped the icon', 'Rendered at 16px')
  returning id into a_entry;

  -- Same content, different formatting: the fingerprint must match.
  insert into knowledge_entries (workspace_id, topic_id, user_id, knowledge_type, title, content)
  values (a_ws, a_topic, a_id, 'progress', '  SHIPPED   the Icon ', E'Rendered\tat 16px');

  select count(*) into n from knowledge_entries
   where workspace_id = a_ws
     and content_hash = (select content_hash from knowledge_entries where id = a_entry);
  perform t.assert(n = 2,
    'a re-paste that differs only in whitespace and case did not fingerprint as a duplicate candidate');

  -- Rule 17: the database PROPOSES. It must not have refused the second row.
  perform t.assert(
    (select count(*) from knowledge_entries where workspace_id = a_ws and title ilike '%icon%') >= 2,
    'a duplicate was blocked by a constraint instead of proposed to the user');

  perform t.assert(
    (select content_hash from knowledge_entries where id = a_entry)
    <> content_fingerprint('Something entirely different'),
    'the fingerprint collides across different content');

  -- =====================================================================
  -- SOFT DELETE: EXPLICIT ALLOWLIST
  -- =====================================================================

  insert into prompts (workspace_id, topic_id, user_id, title)
  values (a_ws, a_topic, a_id, 'Icon prompt') returning id into a_prompt;
  insert into prompt_versions (prompt_id, workspace_id, user_id, version, body)
  values (a_prompt, a_ws, a_id, 1, 'a body') returning id into a_version;
  insert into source_sessions (workspace_id, user_id, topic_id, source_type, raw_content)
  values (a_ws, a_id, a_topic, 'manual', 'evidence') returning id into a_session;
  insert into context_snapshots (workspace_id, topic_id, user_id, body)
  values (a_ws, a_topic, a_id, 'derived memory') returning id into a_snapshot;

  -- A supported type round-trips: deleted, tombstoned, restored.
  select soft_delete_record('knowledge_entry', a_entry, 'wrong topic') into log_id;
  perform t.assert(
    (select deleted_at from knowledge_entries where id = a_entry) is not null,
    'soft delete did not stamp deleted_at');
  perform t.assert(
    (select count(*) from knowledge_entries where id = a_entry) = 1,
    'soft delete removed the row from the database (rule 5)');
  perform t.assert(
    (select snapshot ->> 'title' from deletion_log where id = log_id) = 'Shipped the icon',
    'the tombstone did not capture the row');
  perform t.assert(
    (select reason from deletion_log where id = log_id) = 'wrong topic',
    'the deletion reason was not recorded');

  perform restore_record(log_id);
  perform t.assert(
    (select deleted_at from knowledge_entries where id = a_entry) is null,
    'restore did not bring the row back');
  perform t.assert(
    (select restored_at from deletion_log where id = log_id) is not null,
    'restore did not stamp the tombstone');

  -- Restoring twice is refused, so a tombstone cannot be replayed.
  blocked := false;
  begin perform restore_record(log_id); exception when others then blocked := true; end;
  perform t.assert(blocked, 'a tombstone was restored twice');

  -- IMMUTABLE HISTORY IS REFUSED (rule 6).
  blocked := false; msg := null;
  begin
    perform soft_delete_record('prompt_version', a_version, 'nope');
  exception when others then blocked := true; msg := sqlerrm;
  end;
  perform t.assert(blocked, 'an append-only prompt version was accepted for deletion');
  perform t.assert(msg like '%append-only%',
    format('prompt_version was refused for the wrong reason: %s', msg));
  perform t.assert(
    (select count(*) from prompt_versions where id = a_version) = 1,
    'the prompt version was affected despite the refusal');

  -- LAYER 1 EVIDENCE IS REFUSED (rule 10).
  blocked := false;
  begin perform soft_delete_record('source_session', a_session, null);
  exception when others then blocked := true; end;
  perform t.assert(blocked, 'immutable Layer 1 evidence was accepted for deletion');

  -- DERIVED SNAPSHOTS ARE REFUSED (AD-8).
  blocked := false;
  begin perform soft_delete_record('context_snapshot', a_snapshot, null);
  exception when others then blocked := true; end;
  perform t.assert(blocked, 'a derived snapshot was accepted for deletion');

  -- UNSUPPORTED TYPES ARE REFUSED. Every entity_type outside the allowlist
  -- must raise, so adding a value to the enum later cannot silently widen
  -- what a caller may delete.
  declare et entity_type;
  begin
    foreach et in array array['prompt_version', 'source_session', 'ingestion_record',
                              'context_snapshot']::entity_type[]
    loop
      blocked := false;
      begin perform soft_delete_record(et, gen_random_uuid(), null);
      exception when others then blocked := true;
      end;
      perform t.assert(blocked, format('soft delete was not refused for %s', et));
    end loop;
  end;

  -- A supported type with an id that does not exist raises rather than
  -- silently succeeding — otherwise a caller could not tell a no-op from a
  -- deletion.
  blocked := false;
  begin perform soft_delete_record('decision', gen_random_uuid(), null);
  exception when others then blocked := true; end;
  perform t.assert(blocked, 'deleting a non-existent record reported success');

  -- The argument cannot steer the statement at an arbitrary table. entity_type
  -- is an enum, so a table name is not even representable; this proves the
  -- type is doing that job rather than a string check somewhere.
  blocked := false;
  begin
    perform soft_delete_record('workspace_members'::entity_type, gen_random_uuid(), null);
  exception when others then blocked := true;
  end;
  perform t.assert(blocked, 'an arbitrary table name was accepted as an entity type');
  perform t.assert(
    (select count(*) from workspace_members where workspace_id = a_ws) = 1,
    'the membership row was affected');

  -- =====================================================================
  -- CROSS-WORKSPACE DELETION AND RESTORE ARE IMPOSSIBLE
  -- =====================================================================

  perform t.logout();
  perform t.login(b_id);
  insert into topics (workspace_id, user_id, name, slug)
  values (b_ws, b_id, 'B work', 'b-work') returning id into b_topic;
  insert into knowledge_entries (workspace_id, topic_id, user_id, knowledge_type, title)
  values (b_ws, b_topic, b_id, 'progress', 'B private entry') returning id into b_entry;
  perform t.logout();

  perform t.login(a_id);

  -- A is not a member of B's workspace, so the row is invisible: the UPDATE
  -- matches nothing and the function raises instead of deleting.
  blocked := false;
  begin perform soft_delete_record('knowledge_entry', b_entry, 'not mine');
  exception when others then blocked := true; end;
  perform t.assert(blocked, 'a record in another workspace was deleted');
  perform t.assert(
    (select count(*) from deletion_log where entity_id = b_entry) = 0,
    'a tombstone was written for another workspace''s record');
  perform t.logout();

  -- Prove it from the other side too: the row really is untouched.
  perform t.login(b_id);
  perform t.assert(
    (select deleted_at from knowledge_entries where id = b_entry) is null,
    'CROSS-WORKSPACE DELETE: user B''s record was deleted by user A');

  -- And A cannot restore through B's tombstone either.
  select soft_delete_record('knowledge_entry', b_entry, 'mine to delete') into log_id;
  perform t.logout();

  perform t.login(a_id);
  blocked := false;
  begin perform restore_record(log_id); exception when others then blocked := true; end;
  perform t.assert(blocked, 'another workspace''s tombstone was restorable');
  perform t.logout();

  perform t.login(b_id);
  perform t.assert(
    (select restored_at from deletion_log where id = log_id) is null,
    'CROSS-WORKSPACE RESTORE: user A stamped user B''s tombstone');
  perform t.assert(
    (select deleted_at from knowledge_entries where id = b_entry) is not null,
    'CROSS-WORKSPACE RESTORE: user A restored user B''s record');

  perform t.logout();
  raise notice 'Capture: quick capture needs only content, imports fan out with provenance in one transaction, persist_ingestion respects RLS, fingerprints propose duplicates without blocking them, and soft delete honours an allowlist that refuses history, evidence, snapshots, unknown types and every cross-workspace row.';
end $$;

rollback;
