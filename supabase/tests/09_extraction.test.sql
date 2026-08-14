-- Phase 6: suggestions, and the gate between them and the record.
--
-- Two questions this suite exists to answer:
--
--   1. Is an unreviewed suggestion as private as the source it came from? A
--      suggestion quotes the transcript that produced it, so leaking one leaks
--      the conversation — the tables holding them are as sensitive as
--      `source_sessions` and are tested that way.
--
--   2. Does confirmation stay a gate? A confirmed decision must land
--      `proposed`, an idea `suggested`, a prompt version `untested` and never
--      winning; Current State must be untouchable from a batch; and confirming
--      twice must not write twice.

begin;

do $$
declare
  a_id uuid; b_id uuid;
  a_ws uuid; b_ws uuid;
  a_topic uuid; a_sub uuid; b_topic uuid;
  a_record uuid; a_run uuid; b_run uuid;
  s_entry uuid; s_decision uuid; s_idea uuid; s_prompt uuid; s_action uuid; s_state uuid;
  receipt jsonb; replay jsonb;
  n int; msg text; blocked boolean; v_state text;
begin
  insert into auth.users (email) values ('ext-a@example.test') returning id into a_id;
  insert into auth.users (email) values ('ext-b@example.test') returning id into b_id;
  select id into a_ws from workspaces where owner_id = a_id;
  select id into b_ws from workspaces where owner_id = b_id;

  perform t.login(a_id);
  insert into topics (workspace_id, user_id, name, slug, current_state)
  values (a_ws, a_id, 'DailyRelay', 'dailyrelay', 'Export path half-built.')
  returning id into a_topic;
  insert into subtopics (workspace_id, topic_id, user_id, name, slug)
  values (a_ws, a_topic, a_id, 'Branding', 'branding') returning id into a_sub;

  select persist_ingestion(
    a_ws, 'transcript-paste', 'claude_chat', 'text',
    E'User: should we use a view?\nAssistant: yes.\nDecision: use a database view',
    null, 'Timeline chat', null, null, null, null, null, null
  ) into a_record;

  insert into extraction_runs (workspace_id, user_id, ingestion_record_id, topic_id,
                               provider, model, prompt_version, status, chunk_count, suggested_count)
  values (a_ws, a_id, a_record, a_topic, 'deterministic', null, '1', 'succeeded', 1, 6)
  returning id into a_run;

  insert into extraction_suggestions (workspace_id, run_id, ordinal, kind, knowledge_type, title,
                                      content, source_reference, confidence, basis, selected)
  values (a_ws, a_run, 0, 'knowledge_entry', 'implementation', 'Export button wired',
          'Handler and receipt row.', 'L2', 0.9, '["labelled explicitly"]'::jsonb, true)
  returning id into s_entry;

  insert into extraction_suggestions (workspace_id, run_id, ordinal, kind, title, content, reason,
                                      status_suggestion, source_reference, confidence, selected)
  values (a_ws, a_run, 1, 'decision', 'Use a database view', 'The timeline merge lives in a view',
          'Application merging drifts', 'proposed', 'L3', 1.0, true)
  returning id into s_decision;

  insert into extraction_suggestions (workspace_id, run_id, ordinal, kind, title, content,
                                      source_reference, confidence, selected)
  values (a_ws, a_run, 2, 'idea', 'Add a browser companion', 'Nothing decided yet', 'L1', 0.6, true)
  returning id into s_idea;

  insert into extraction_suggestions (workspace_id, run_id, ordinal, kind, title, content,
                                      source_reference, confidence, selected)
  values (a_ws, a_run, 3, 'prompt', 'Extraction prompt',
          E'Extract only what the source states.\n  Preserve  spacing.', 'L2', 0.8, true)
  returning id into s_prompt;

  insert into extraction_suggestions (workspace_id, run_id, ordinal, kind, title, status_suggestion,
                                      payload, source_reference, confidence, selected)
  values (a_ws, a_run, 4, 'action', 'Render the receipt ids', 'open',
          '{"actionKind":"next_step"}'::jsonb, 'L3', 0.9, true)
  returning id into s_action;

  insert into extraction_suggestions (workspace_id, run_id, ordinal, kind, title, content,
                                      source_reference, confidence, selected)
  values (a_ws, a_run, 5, 'current_state', 'Phase 6 in review',
          'Extraction is built; the review layer is next.', 'L3', 0.9, true)
  returning id into s_state;

  -- =====================================================================
  -- 1. CONFIRMATION IS A GATE, NOT A RUBBER STAMP
  -- =====================================================================
  receipt := confirm_extraction_suggestions(
    a_run, array[s_entry, s_decision, s_idea, s_prompt, s_action, s_state], a_topic, a_sub);

  perform t.assert((receipt ->> 'createdCount')::int = 5,
    format('expected 5 records, got %s', receipt ->> 'createdCount'));

  -- The entry went through persist_ingestion, so it has Layer 1 evidence.
  perform t.assert(
    (select count(*) from knowledge_entries
      where topic_id = a_topic and title = 'Export button wired'
        and source_session_id is not null) = 1,
    'the confirmed entry has no Layer 1 evidence behind it');

  -- A decision arrives PROPOSED. This is the whole authority model.
  perform t.assert(
    (select status from decisions where topic_id = a_topic) = 'proposed',
    'a confirmed suggestion created an ACTIVE decision');
  perform t.assert(
    (select status from ideas where topic_id = a_topic) = 'suggested',
    'a confirmed suggestion created an approved idea');

  -- The prompt body is byte-for-byte what was suggested (6M).
  perform t.assert(
    (select body from prompt_versions v join prompts p on p.id = v.prompt_id
      where p.topic_id = a_topic) = E'Extract only what the source states.\n  Preserve  spacing.',
    'the prompt body was rewritten on the way in');
  perform t.assert(
    (select result from prompt_versions v join prompts p on p.id = v.prompt_id
      where p.topic_id = a_topic) = 'untested'
    and (select is_winning from prompts where topic_id = a_topic) = false,
    'a confirmed prompt claimed an outcome nobody observed');

  perform t.assert(
    (select status from actions where topic_id = a_topic and title = 'Render the receipt ids') = 'open',
    'the confirmed action did not land open');

  -- Current State is refused by name, and the topic is untouched.
  perform t.assert((receipt ->> 'skippedCount')::int = 1, 'the Current State suggestion was not skipped');
  perform t.assert(
    (select current_state from topics where id = a_topic) = 'Export path half-built.',
    'a batch confirmation replaced Current State');
  perform t.assert(
    (select state from extraction_suggestions where id = s_state) <> 'confirmed',
    'the Current State suggestion was marked confirmed without being applied');

  -- =====================================================================
  -- 2. IDEMPOTENCY
  -- =====================================================================
  select count(*) into n from knowledge_entries where topic_id = a_topic;
  replay := confirm_extraction_suggestions(
    a_run, array[s_entry, s_decision, s_idea, s_prompt, s_action], a_topic, a_sub);
  perform t.assert((replay ->> 'createdCount')::int = 0,
    'confirming the same suggestions twice created records again');
  perform t.assert(
    (select count(*) from knowledge_entries where topic_id = a_topic) = n,
    'a repeated confirmation wrote a second entry');
  perform t.assert(
    (select count(*) from decisions where topic_id = a_topic) = 1,
    'a repeated confirmation wrote a second decision');

  -- The source is partially processed, because one suggestion is still open.
  perform t.assert(
    (select status from ingestion_records where id = a_record) = 'partially_processed',
    'an item with unreviewed suggestions was marked fully processed');

  -- =====================================================================
  -- 3. AN EDIT IS WHAT GETS FILED
  -- =====================================================================
  insert into extraction_suggestions (workspace_id, run_id, ordinal, kind, knowledge_type, title,
                                      original, source_reference, confidence, selected)
  values (a_ws, a_run, 6, 'knowledge_entry', 'bug', 'Clipbaord threw',
          '{"title":"Clipbaord threw"}'::jsonb, 'L2', 0.7, true)
  returning id into s_entry;

  update extraction_suggestions set title = 'Clipboard threw on Firefox', state = 'edited'
   where id = s_entry;

  perform confirm_extraction_suggestions(a_run, array[s_entry], a_topic, null);
  perform t.assert(
    (select count(*) from knowledge_entries
      where topic_id = a_topic and title = 'Clipboard threw on Firefox') = 1,
    'the user''s correction was not what got filed');
  perform t.assert(
    (select count(*) from knowledge_entries where topic_id = a_topic and title = 'Clipbaord threw') = 0,
    'the provider''s original was filed instead of the correction');
  perform t.assert(
    (select original ->> 'title' from extraction_suggestions where id = s_entry) = 'Clipbaord threw',
    'the original suggestion was lost, so the edit is no longer legible as an edit');

  -- =====================================================================
  -- 4. SCOPE
  -- =====================================================================
  blocked := false;
  begin
    perform confirm_extraction_suggestions(a_run, array[s_idea], gen_random_uuid(), null);
  exception when others then blocked := true; msg := sqlerrm;
  end;
  perform t.assert(blocked and msg = 'no such topic', 'a run filed into a topic that does not exist');

  blocked := false;
  begin
    perform confirm_extraction_suggestions(a_run, array[s_idea], a_topic, gen_random_uuid());
  exception when others then blocked := true; msg := sqlerrm;
  end;
  perform t.assert(blocked and msg = 'no such subtopic', 'a run filed into a foreign subtopic');

  perform t.logout();

  -- =====================================================================
  -- 5. CROSS-USER: A SUGGESTION IS AS PRIVATE AS ITS SOURCE
  -- =====================================================================
  perform t.login(b_id);
  insert into topics (workspace_id, user_id, name, slug)
  values (b_ws, b_id, 'Other', 'other') returning id into b_topic;

  select count(*) into n from extraction_runs;
  perform t.assert(n = 0, format('B reads %s of A''s extraction runs', n));
  select count(*) into n from extraction_suggestions;
  perform t.assert(n = 0, format('B reads %s of A''s suggestions', n));

  -- The suggestion bodies quote A's transcript. An unfiltered read is the
  -- query an attacker actually writes.
  select count(*) into n from extraction_suggestions where title is not null;
  perform t.assert(n = 0, 'an unfiltered read returned A''s suggestion text to B');

  blocked := false;
  begin
    insert into extraction_runs (workspace_id, user_id, provider, prompt_version)
    values (a_ws, b_id, 'deterministic', '1');
  exception when others then blocked := true; end;
  perform t.assert(blocked, 'B created an extraction run inside A''s workspace');

  blocked := false;
  begin
    insert into extraction_suggestions (workspace_id, run_id, kind, title, confidence)
    values (a_ws, a_run, 'decision', 'graffiti', 0.5);
  exception when others then blocked := true; end;
  perform t.assert(blocked, 'B wrote a suggestion into A''s run');

  -- Confirming A's run as B must create nothing, however the ids were obtained.
  select count(*) into n from decisions;
  blocked := false;
  begin
    perform confirm_extraction_suggestions(a_run, array[s_decision], b_topic, null);
  exception when others then blocked := true; msg := sqlerrm;
  end;
  perform t.assert(blocked, 'B confirmed a suggestion belonging to A');
  perform t.assert(msg = 'no such extraction run',
    format('the refusal told B that A''s run exists: %s', msg));
  perform t.assert((select count(*) from decisions) = n, 'B''s attempt wrote a record');

  perform t.assert(
    not has_function_privilege('anon',
      'confirm_extraction_suggestions(uuid,uuid[],uuid,uuid)', 'execute'),
    'anon can confirm suggestions');
  perform t.logout();

  -- A still has exactly what they had.
  perform t.login(a_id);
  perform t.assert((select count(*) from extraction_runs) = 1, 'A lost their run');
  perform t.assert((select count(*) from extraction_suggestions) = 7, 'A lost suggestions');
  perform t.assert(
    (select current_state from topics where id = a_topic) = 'Export path half-built.',
    'A''s Current State changed');
  perform t.logout();

  raise notice 'Extraction: confirmation files a decision proposed, an idea suggested and a prompt untested and never winning; Current State is refused by a batch and the topic is untouched; a second confirmation writes nothing; a user''s correction is what gets filed and the original stays legible as history; a run cannot file into a topic or subtopic that is not its own; and user B can neither read, write nor confirm any part of user A''s review.';
end $$;

rollback;
