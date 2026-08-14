-- Phase 2: the timeline_events projection and decision supersession.
--
-- Two things are proven here, and the first is a security property:
--
--   1. timeline_events does not leak across workspaces. A view runs as its
--      OWNER unless created with security_invoker, and an owner-run view reads
--      straight past row-level security on every table beneath it. That failure
--      is silent — the view works perfectly and quietly serves one user's
--      history to another — so it is asserted rather than assumed.
--
--   2. supersede_decision() preserves both decisions, refuses to run without a
--      reason, and leaves exactly one of the pair active.

begin;

do $$
declare
  a_id uuid; b_id uuid;
  a_ws uuid; b_ws uuid;
  a_topic uuid; a_sub uuid;
  a_entry uuid; a_decision uuid; a_decision2 uuid; a_idea uuid;
  a_prompt uuid; a_version uuid; a_action uuid; a_milestone uuid; a_file uuid;
  n int;
  blocked boolean;
  kinds text[];
begin
  insert into auth.users (email) values ('tl-a@example.test') returning id into a_id;
  insert into auth.users (email) values ('tl-b@example.test') returning id into b_id;
  select id into a_ws from workspaces where owner_id = a_id;
  select id into b_ws from workspaces where owner_id = b_id;
  perform t.assert(a_ws is not null and b_ws is not null, 'bootstrap did not create workspaces');

  perform t.login(a_id);

  insert into topics (workspace_id, user_id, name, slug, goal)
  values (a_ws, a_id, 'DailyRelay', 'dailyrelay', 'Ship v1') returning id into a_topic;

  insert into subtopics (workspace_id, topic_id, user_id, name, slug)
  values (a_ws, a_topic, a_id, 'Branding', 'branding') returning id into a_sub;

  insert into knowledge_entries (workspace_id, topic_id, user_id, knowledge_type, title, content, source_type)
  values (a_ws, a_topic, a_id, 'progress', 'Shipped the icon set', 'private detail', 'claude_code')
  returning id into a_entry;
  insert into entry_subtopics (knowledge_entry_id, subtopic_id) values (a_entry, a_sub);

  insert into decisions (workspace_id, topic_id, subtopic_id, user_id, title, decision, reason, status)
  values (a_ws, a_topic, a_sub, a_id, 'Blue icon', 'Use a blue circle', 'Matches the brand', 'active')
  returning id into a_decision;

  insert into ideas (workspace_id, topic_id, user_id, title, idea, status)
  values (a_ws, a_topic, a_id, 'Add a checkmark', 'Overlay a check', 'rejected')
  returning id into a_idea;

  insert into prompts (workspace_id, topic_id, user_id, title)
  values (a_ws, a_topic, a_id, 'Icon prompt') returning id into a_prompt;
  insert into prompt_versions (prompt_id, workspace_id, user_id, version, body, result)
  values (a_prompt, a_ws, a_id, 1, 'secret prompt body', 'worked') returning id into a_version;
  update prompts set current_version_id = a_version where id = a_prompt;
  -- Winning is a property of a version, declared by a selection row.
  insert into prompt_winning_selections (prompt_id, prompt_version_id, workspace_id, user_id, reason)
  values (a_prompt, a_version, a_ws, a_id, 'first version that worked');

  insert into actions (workspace_id, topic_id, user_id, kind, title)
  values (a_ws, a_topic, a_id, 'blocker', 'Waiting on brand sign-off') returning id into a_action;

  insert into milestones (workspace_id, topic_id, user_id, title, achieved_at)
  values (a_ws, a_topic, a_id, 'v1 shipped', now()) returning id into a_milestone;

  insert into file_references (workspace_id, topic_id, user_id, kind, path, display_name)
  values (a_ws, a_topic, a_id, 'repo_file', 'src/icon.svg', 'icon.svg') returning id into a_file;

  insert into source_sessions (workspace_id, user_id, topic_id, source_type, title, raw_content)
  values (a_ws, a_id, a_topic, 'claude_chat', 'Icon chat', 'verbatim transcript');

  -- --- 1. Every record type reaches the projection ------------------------
  -- Eight, not nine: `prompts` is the mutable head and contributes no event of
  -- its own; each prompt_version is the event.
  select count(*) into n from timeline_events where topic_id = a_topic;
  perform t.assert(n = 8, format('expected 8 timeline rows for the topic, found %s', n));

  select array_agg(distinct entity_type::text order by entity_type::text)
    into kinds from timeline_events where topic_id = a_topic;
  perform t.assert(
    kinds @> array['knowledge_entry','decision','idea','prompt_version','action','milestone','file_reference','source_session'],
    format('timeline is missing record types: %s', kinds)
  );

  -- --- 2. Ordering is newest-first ----------------------------------------
  perform t.assert(
    (select bool_and(ok) from (
      select occurred_at <= lag(occurred_at) over (order by occurred_at desc) is not false as ok
      from timeline_events where topic_id = a_topic
    ) s),
    'timeline is not ordered newest-first by occurred_at'
  );

  -- --- 3. Subtopic filtering works for entries and for typed rows ---------
  select count(*) into n from timeline_events
   where topic_id = a_topic and a_sub = any(subtopic_ids);
  -- the knowledge entry (via entry_subtopics) and the decision (via its column)
  perform t.assert(n = 2, format('expected 2 rows under the subtopic, found %s', n));

  -- --- 4. The winning prompt is labelled as such --------------------------
  perform t.assert(
    exists (select 1 from timeline_events where id = a_version and kind = 'winning_prompt'),
    'the winning version is not labelled winning_prompt in the timeline'
  );
  -- The derived flag on the prompt agrees with the selection.
  perform t.assert(
    (select is_winning from prompts where id = a_prompt),
    'prompts.is_winning was not synced from the winning selection'
  );

  -- --- 5. Soft-deleted rows leave the projection --------------------------
  update knowledge_entries set deleted_at = now() where id = a_entry;
  perform t.assert(
    not exists (select 1 from timeline_events where id = a_entry),
    'a soft-deleted entry is still visible in the timeline'
  );
  update knowledge_entries set deleted_at = null where id = a_entry;

  -- --- 6. THE SECURITY ASSERTION -----------------------------------------
  -- User B must see nothing of A's, through the view, in either direction.
  perform t.login(b_id);

  select count(*) into n from timeline_events where topic_id = a_topic;
  perform t.assert(n = 0, format('LEAK: user B sees %s of user A''s timeline rows', n));

  select count(*) into n from timeline_events where workspace_id = a_ws;
  perform t.assert(n = 0, 'LEAK: user B can read user A''s timeline by workspace');

  select count(*) into n from timeline_events;
  perform t.assert(n = 0, format('LEAK: an unfiltered timeline read returns %s rows for user B', n));

  -- B's own workspace is reachable, so the view is not simply broken.
  insert into topics (workspace_id, user_id, name, slug)
  values (b_ws, b_id, 'B topic', 'b-topic');
  insert into knowledge_entries (workspace_id, topic_id, user_id, knowledge_type, title)
  select b_ws, id, b_id, 'progress', 'B entry' from topics where workspace_id = b_ws limit 1;
  select count(*) into n from timeline_events;
  perform t.assert(n = 1, format('user B should see exactly their own 1 row, saw %s', n));

  -- --- 7. supersede_decision() -------------------------------------------
  perform t.login(a_id);

  insert into decisions (workspace_id, topic_id, user_id, title, decision, status)
  values (a_ws, a_topic, a_id, 'Slash geometry', 'slash -> arrow -> X', 'proposed')
  returning id into a_decision2;

  -- A reason is mandatory.
  blocked := false;
  begin
    perform supersede_decision(a_decision, a_decision2, '   ');
  exception when others then blocked := true;
  end;
  perform t.assert(blocked, 'superseding a decision without a reason was allowed');

  -- A decision cannot supersede itself.
  blocked := false;
  begin
    perform supersede_decision(a_decision, a_decision, 'nonsense');
  exception when others then blocked := true;
  end;
  perform t.assert(blocked, 'a decision was allowed to supersede itself');

  perform supersede_decision(a_decision, a_decision2, 'Blue circle read as a status dot at 16px');

  perform t.assert(
    (select status from decisions where id = a_decision) = 'superseded',
    'the old decision is not marked superseded'
  );
  perform t.assert(
    (select superseded_by_id from decisions where id = a_decision) = a_decision2,
    'the old decision does not point at its replacement'
  );
  perform t.assert(
    (select supersede_reason from decisions where id = a_decision) is not null,
    'the supersede reason was not recorded'
  );
  perform t.assert(
    (select status from decisions where id = a_decision2) = 'active',
    'the replacement decision was not promoted to active'
  );

  -- Both survive: history is preserved, Current State is the active one.
  select count(*) into n from decisions where topic_id = a_topic and deleted_at is null;
  perform t.assert(n = 2, format('expected both decisions to survive, found %s', n));
  select count(*) into n from decisions
   where topic_id = a_topic and status = 'active' and superseded_by_id is null;
  perform t.assert(n = 1, format('expected exactly 1 active decision, found %s', n));

  -- And the graph records the same fact (AD-7).
  perform t.assert(
    exists (
      select 1 from relationships
      where from_type = 'decision' and from_id = a_decision2
        and relationship_type = 'supersedes'
        and to_type = 'decision' and to_id = a_decision
    ),
    'supersession was not recorded in the relationship graph'
  );

  -- Superseding an already-superseded decision is refused.
  blocked := false;
  begin
    perform supersede_decision(a_decision, a_decision2, 'again');
  exception when others then blocked := true;
  end;
  perform t.assert(blocked, 'a decision was superseded twice');

  -- --- 8. The CHECK constraint holds independently of the function --------
  blocked := false;
  begin
    update decisions set superseded_by_id = a_decision2, supersede_reason = null
     where id = a_decision2;
  exception when others then blocked := true;
  end;
  perform t.assert(blocked, 'a decision was superseded with a null reason by direct UPDATE');

  -- --- 9. Prompt outcomes are append-only and latest-wins ----------------
  insert into prompt_version_outcomes (prompt_version_id, workspace_id, user_id, result, rating)
  values (a_version, a_ws, a_id, 'partially_worked', 3);

  perform t.assert(
    (select result from prompt_version_current_outcome where prompt_version_id = a_version)
      = 'partially_worked',
    'the newest outcome is not the current one'
  );

  insert into prompt_version_outcomes (prompt_version_id, workspace_id, user_id, result, rating)
  values (a_version, a_ws, a_id, 'failed', 1);

  perform t.assert(
    (select result from prompt_version_current_outcome where prompt_version_id = a_version) = 'failed',
    're-rating did not take effect'
  );
  select count(*) into n from prompt_version_outcomes where prompt_version_id = a_version;
  perform t.assert(n = 2, format('expected both judgements to survive, found %s', n));

  -- The version body itself is untouched by any of this.
  perform t.assert(
    (select body from prompt_versions where id = a_version) = 'secret prompt body',
    'the prompt body changed while recording an outcome'
  );

  -- Append-only: no UPDATE or DELETE is possible, as for the other two.
  blocked := false;
  begin
    update prompt_version_outcomes set result = 'worked' where prompt_version_id = a_version;
    blocked := not found;
  exception when others then blocked := true;
  end;
  perform t.assert(blocked, 'a prompt outcome was updated');

  blocked := false;
  begin
    delete from prompt_version_outcomes where prompt_version_id = a_version;
    blocked := not found;
  exception when others then blocked := true;
  end;
  perform t.assert(blocked, 'a prompt outcome was deleted');

  -- The timeline reports the current outcome, not the seed column.
  perform t.assert(
    (select status from timeline_events where id = a_version) = 'failed',
    'the timeline shows the version''s seed result rather than its current outcome'
  );

  -- --- 10. Outcomes do not leak across workspaces ------------------------
  perform t.login(b_id);
  select count(*) into n from prompt_version_outcomes;
  perform t.assert(n = 0, format('LEAK: user B sees %s of user A''s prompt outcomes', n));
  select count(*) into n from prompt_version_current_outcome;
  perform t.assert(n = 0, 'LEAK: user B reads user A''s outcomes through the view');
  perform t.login(a_id);

  -- --- 11. Winning is per version, and its history survives --------------
  declare
    a_version2 uuid;
  begin
    insert into prompt_versions (prompt_id, workspace_id, user_id, version, body)
    values (a_prompt, a_ws, a_id, 2, 'a much better prompt body') returning id into a_version2;

    -- A version from another prompt cannot be declared this prompt's winner.
    blocked := false;
    begin
      insert into prompt_winning_selections (prompt_id, prompt_version_id, workspace_id, user_id)
      values (a_prompt, a_entry, a_ws, a_id);
    exception when others then blocked := true;
    end;
    perform t.assert(blocked, 'a version from another prompt was accepted as the winner');

    insert into prompt_winning_selections (prompt_id, prompt_version_id, workspace_id, user_id, reason)
    values (a_prompt, a_version2, a_ws, a_id, 'v2 beat v1 on the 16px render');

    perform t.assert(
      (select prompt_version_id from prompt_current_winning where prompt_id = a_prompt) = a_version2,
      'the newest winning selection is not current'
    );
    perform t.assert(
      (select winning_body from prompt_current_winning where prompt_id = a_prompt)
        = 'a much better prompt body',
      'the winning body is not the winning version''s body'
    );

    -- The earlier selection is still readable: "we used to think v1 won".
    select count(*) into n from prompt_winning_selections where prompt_id = a_prompt;
    perform t.assert(n = 2, format('expected 2 winning selections in history, found %s', n));

    -- Only the winning version carries the label.
    perform t.assert(
      exists (select 1 from timeline_events where id = a_version2 and kind = 'winning_prompt'),
      'v2 is not labelled winning after being selected'
    );
    perform t.assert(
      exists (select 1 from timeline_events where id = a_version and kind = 'prompt'),
      'v1 still claims to be winning after v2 replaced it'
    );

    -- Clearing is recorded, not silent.
    insert into prompt_winning_selections (prompt_id, prompt_version_id, workspace_id, user_id, reason)
    values (a_prompt, null, a_ws, a_id, 'neither version holds up any more');
    perform t.assert(
      not exists (select 1 from prompt_current_winning where prompt_id = a_prompt),
      'clearing the winner did not take effect'
    );
    perform t.assert(
      not (select is_winning from prompts where id = a_prompt),
      'prompts.is_winning was not synced when the winner was cleared'
    );
    select count(*) into n from prompt_winning_selections where prompt_id = a_prompt;
    perform t.assert(n = 3, 'clearing did not append to the selection history');

    -- Append-only, like the other history tables.
    blocked := false;
    begin
      update prompt_winning_selections set reason = 'x' where prompt_id = a_prompt;
      blocked := not found;
    exception when others then blocked := true;
    end;
    perform t.assert(blocked, 'a winning selection was updated');

    -- And it does not leak.
    perform t.login(b_id);
    select count(*) into n from prompt_winning_selections;
    perform t.assert(n = 0, format('LEAK: user B sees %s winning selections', n));
    select count(*) into n from prompt_current_winning;
    perform t.assert(n = 0, 'LEAK: user B reads winning selections through the view');
    perform t.login(a_id);
  end;

  raise notice 'Timeline: all record types project, ordering holds, soft deletes drop out, and user B sees none of user A''s rows through the view. Decision supersession preserves both sides and requires a reason. Prompt outcomes append, latest wins, bodies stay immutable. Winning is per version, its history survives, and none of it leaks.';
end $$;

rollback;
