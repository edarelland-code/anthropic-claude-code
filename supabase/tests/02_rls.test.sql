-- Cross-user isolation, executed as the non-superuser `authenticated` role
-- that PostgREST switches into for a real request.
--
-- User A creates data. User B must not be able to read it, update it, delete
-- it, or attach records to it — and that must hold for child tables, not just
-- topics. Anything protected only by application-side filtering is a defect.

begin;

do $$
declare
  a_id uuid; b_id uuid;
  a_ws uuid; b_ws uuid;
  a_topic uuid; a_sub uuid; a_entry uuid; a_decision uuid; a_prompt uuid; a_version uuid;
  b_topic uuid; b_entry uuid;
  n int;
  blocked boolean;
begin
  -- --- Fixtures, created as the owner role -------------------------------
  insert into auth.users (email) values ('a@example.test') returning id into a_id;
  insert into auth.users (email) values ('b@example.test') returning id into b_id;

  -- The bootstrap trigger should have given each of them a workspace.
  select id into a_ws from workspaces where owner_id = a_id;
  select id into b_ws from workspaces where owner_id = b_id;
  perform t.assert(a_ws is not null, 'user A got no workspace from handle_new_user()');
  perform t.assert(b_ws is not null, 'user B got no workspace from handle_new_user()');
  perform t.assert(a_ws <> b_ws, 'users share a workspace');

  -- --- User A builds a realistic topic ------------------------------------
  perform t.login(a_id);

  insert into topics (workspace_id, user_id, name, slug, goal)
  values (a_ws, a_id, 'DailyRelay', 'dailyrelay', 'Ship v1') returning id into a_topic;

  insert into subtopics (workspace_id, topic_id, user_id, name, slug)
  values (a_ws, a_topic, a_id, 'Branding', 'branding') returning id into a_sub;

  insert into knowledge_entries (workspace_id, topic_id, user_id, knowledge_type, title, content)
  values (a_ws, a_topic, a_id, 'decision', 'Blue icon concept', 'private detail')
  returning id into a_entry;

  insert into entry_subtopics (knowledge_entry_id, subtopic_id) values (a_entry, a_sub);

  insert into decisions (workspace_id, topic_id, user_id, title, decision, reason)
  values (a_ws, a_topic, a_id, 'Icon direction', 'Use the slash geometry', 'Reads at 16px')
  returning id into a_decision;

  insert into prompts (workspace_id, topic_id, user_id, title)
  values (a_ws, a_topic, a_id, 'Icon prompt') returning id into a_prompt;

  insert into prompt_versions (prompt_id, workspace_id, user_id, version, body)
  values (a_prompt, a_ws, a_id, 1, 'secret prompt body') returning id into a_version;

  insert into actions (workspace_id, topic_id, user_id, kind, title)
  values (a_ws, a_topic, a_id, 'next_step', 'Test the nudge');

  insert into source_sessions (workspace_id, user_id, topic_id, source_type, title, raw_content)
  values (a_ws, a_id, a_topic, 'claude_chat', 'Icon chat', 'verbatim transcript');

  perform t.logout();

  -- --- User B tries to reach it -------------------------------------------
  perform t.login(b_id);

  -- READ: every table in the chain, not just topics.
  select count(*) into n from topics where id = a_topic;
  perform t.assert(n = 0, 'B can read A''s topic');
  select count(*) into n from subtopics where id = a_sub;
  perform t.assert(n = 0, 'B can read A''s subtopic');
  select count(*) into n from knowledge_entries where id = a_entry;
  perform t.assert(n = 0, 'B can read A''s knowledge entry');
  select count(*) into n from decisions where id = a_decision;
  perform t.assert(n = 0, 'B can read A''s decision');
  select count(*) into n from prompts where id = a_prompt;
  perform t.assert(n = 0, 'B can read A''s prompt');
  select count(*) into n from prompt_versions where id = a_version;
  perform t.assert(n = 0, 'B can read A''s prompt body');
  select count(*) into n from actions where topic_id = a_topic;
  perform t.assert(n = 0, 'B can read A''s actions');
  select count(*) into n from source_sessions where topic_id = a_topic;
  perform t.assert(n = 0, 'B can read A''s raw transcript');
  select count(*) into n from entry_subtopics where knowledge_entry_id = a_entry;
  perform t.assert(n = 0, 'B can read A''s entry/subtopic links');
  select count(*) into n from workspaces where id = a_ws;
  perform t.assert(n = 0, 'B can read A''s workspace');

  -- Unscoped scans leak nothing either.
  select count(*) into n from knowledge_entries;
  perform t.assert(n = 0, 'an unfiltered scan returns A''s entries to B');

  -- UPDATE: silently affects nothing rather than succeeding.
  update topics set name = 'hijacked' where id = a_topic;
  get diagnostics n = row_count;
  perform t.assert(n = 0, 'B updated A''s topic');
  update knowledge_entries set title = 'hijacked' where id = a_entry;
  get diagnostics n = row_count;
  perform t.assert(n = 0, 'B updated A''s entry');
  update decisions set decision = 'hijacked' where id = a_decision;
  get diagnostics n = row_count;
  perform t.assert(n = 0, 'B updated A''s decision');

  -- DELETE
  delete from topics where id = a_topic;
  get diagnostics n = row_count;
  perform t.assert(n = 0, 'B deleted A''s topic');
  delete from knowledge_entries where id = a_entry;
  get diagnostics n = row_count;
  perform t.assert(n = 0, 'B deleted A''s entry');

  -- ATTACH: B claims their own workspace but points at A's topic. The RLS
  -- with-check alone would allow this; the composite workspace FK must not.
  blocked := false;
  begin
    insert into knowledge_entries (workspace_id, topic_id, user_id, knowledge_type, title)
    values (b_ws, a_topic, b_id, 'idea', 'graffiti');
  exception when others then blocked := true;
  end;
  perform t.assert(blocked, 'B attached an entry to A''s topic across workspaces');

  blocked := false;
  begin
    insert into subtopics (workspace_id, topic_id, user_id, name, slug)
    values (b_ws, a_topic, b_id, 'graffiti', 'graffiti');
  exception when others then blocked := true;
  end;
  perform t.assert(blocked, 'B attached a subtopic to A''s topic across workspaces');

  -- ATTACH with A's workspace_id is refused by the policy itself.
  blocked := false;
  begin
    insert into knowledge_entries (workspace_id, topic_id, user_id, knowledge_type, title)
    values (a_ws, a_topic, b_id, 'idea', 'graffiti');
  exception when others then blocked := true;
  end;
  perform t.assert(blocked, 'B inserted into A''s workspace directly');

  -- JOIN TABLE: B links their own entry to A's subtopic.
  insert into topics (workspace_id, user_id, name, slug)
  values (b_ws, b_id, 'B topic', 'b-topic') returning id into b_topic;
  insert into knowledge_entries (workspace_id, topic_id, user_id, knowledge_type, title)
  values (b_ws, b_topic, b_id, 'idea', 'B entry') returning id into b_entry;

  blocked := false;
  begin
    insert into entry_subtopics (knowledge_entry_id, subtopic_id) values (b_entry, a_sub);
  exception when others then blocked := true;
  end;
  perform t.assert(blocked, 'B linked their entry to A''s subtopic');

  -- B can still work normally in their own workspace.
  select count(*) into n from topics where id = b_topic;
  perform t.assert(n = 1, 'B cannot see their own topic');

  -- MEMBERSHIP: B cannot add themselves to A's workspace.
  blocked := false;
  begin
    insert into workspace_members (workspace_id, user_id, role) values (a_ws, b_id, 'owner');
  exception when others then blocked := true;
  end;
  perform t.assert(blocked, 'B granted themselves membership of A''s workspace');

  perform t.logout();

  -- --- A still has everything ---------------------------------------------
  perform t.login(a_id);
  select count(*) into n from topics where id = a_topic;
  perform t.assert(n = 1, 'A lost their topic');
  select count(*) into n from knowledge_entries where id = a_entry and title = 'Blue icon concept';
  perform t.assert(n = 1, 'A''s entry was modified');
  perform t.logout();

  raise notice 'RLS: cross-user isolation holds across topics, subtopics, entries, decisions, prompts, prompt bodies, actions, transcripts, join tables, and membership';
end $$;

rollback;
