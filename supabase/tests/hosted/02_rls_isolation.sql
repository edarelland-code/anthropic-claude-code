-- ContextShelf — cross-user RLS isolation, run against the HOSTED project.
--
-- Run in the Supabase SQL Editor after applying the migration.
--
-- This is the same test as supabase/tests/02_rls.test.sql, adapted to a real
-- Supabase project: it creates two throwaway auth.users rows, exercises the
-- policies as the non-superuser `authenticated` role, and ROLLS BACK. Nothing
-- survives — no test users, no test data, no schema change.
--
-- It answers the question the local harness cannot: are the policies correct
-- *on this project*, not merely in the migration file.
--
-- Expected final output: one row reading 'ALL HOSTED RLS CHECKS PASSED'.

begin;

do $$
declare
  a_id uuid; b_id uuid;
  a_ws uuid; b_ws uuid;
  a_topic uuid; a_sub uuid; a_entry uuid; a_decision uuid; a_prompt uuid; a_version uuid;
  b_topic uuid; b_entry uuid;
  n int; blocked boolean;

  procedure_note text := 'run as the postgres role in the SQL Editor; t.login() is emulated inline';
begin
  -- --- Fixtures -----------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'rls-test-a@contextshelf.invalid', '', now(), now(), now())
  returning id into a_id;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'rls-test-b@contextshelf.invalid', '', now(), now(), now())
  returning id into b_id;

  -- The bootstrap trigger should have created a workspace for each.
  select id into a_ws from workspaces where owner_id = a_id;
  select id into b_ws from workspaces where owner_id = b_id;
  if a_ws is null then raise exception 'FAIL: handle_new_user() did not create a workspace for A'; end if;
  if b_ws is null then raise exception 'FAIL: handle_new_user() did not create a workspace for B'; end if;
  if a_ws = b_ws then raise exception 'FAIL: both users share a workspace'; end if;

  -- --- User A creates a realistic topic ------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', a_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  insert into topics (workspace_id, user_id, name, slug, goal)
  values (a_ws, a_id, 'RLS probe A', 'rls-probe-a', 'Ship v1') returning id into a_topic;

  insert into subtopics (workspace_id, topic_id, user_id, name, slug)
  values (a_ws, a_topic, a_id, 'Branding', 'branding') returning id into a_sub;

  insert into knowledge_entries (workspace_id, topic_id, user_id, knowledge_type, title, content)
  values (a_ws, a_topic, a_id, 'decision', 'Blue icon concept', 'private detail')
  returning id into a_entry;

  insert into entry_subtopics (knowledge_entry_id, subtopic_id) values (a_entry, a_sub);

  insert into decisions (workspace_id, topic_id, user_id, title, decision, reason)
  values (a_ws, a_topic, a_id, 'Icon direction', 'Slash geometry', 'Reads at 16px')
  returning id into a_decision;

  insert into prompts (workspace_id, topic_id, user_id, title)
  values (a_ws, a_topic, a_id, 'Icon prompt') returning id into a_prompt;

  insert into prompt_versions (prompt_id, workspace_id, user_id, version, body)
  values (a_prompt, a_ws, a_id, 1, 'secret prompt body') returning id into a_version;

  insert into actions (workspace_id, topic_id, user_id, kind, title)
  values (a_ws, a_topic, a_id, 'next_step', 'Test the nudge');

  insert into source_sessions (workspace_id, user_id, topic_id, source_type, title, raw_content)
  values (a_ws, a_id, a_topic, 'claude_chat', 'Icon chat', 'verbatim transcript');

  -- A can read their own work back.
  select count(*) into n from topics where id = a_topic;
  if n <> 1 then raise exception 'FAIL: A cannot read their own topic'; end if;

  -- A can modify their own work.
  update topics set goal = 'Ship v1.1' where id = a_topic;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: A cannot update their own topic'; end if;

  execute 'reset role';

  -- --- User B attempts to reach it ----------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', b_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- READ, across the whole relationship chain
  select count(*) into n from topics where id = a_topic;
  if n <> 0 then raise exception 'FAIL: B can read A''s topic'; end if;
  select count(*) into n from subtopics where id = a_sub;
  if n <> 0 then raise exception 'FAIL: B can read A''s subtopic'; end if;
  select count(*) into n from knowledge_entries where id = a_entry;
  if n <> 0 then raise exception 'FAIL: B can read A''s knowledge entry'; end if;
  select count(*) into n from decisions where id = a_decision;
  if n <> 0 then raise exception 'FAIL: B can read A''s decision'; end if;
  select count(*) into n from prompt_versions where id = a_version;
  if n <> 0 then raise exception 'FAIL: B can read A''s prompt body'; end if;
  select count(*) into n from actions where topic_id = a_topic;
  if n <> 0 then raise exception 'FAIL: B can read A''s actions'; end if;
  select count(*) into n from source_sessions where topic_id = a_topic;
  if n <> 0 then raise exception 'FAIL: B can read A''s raw transcript'; end if;
  select count(*) into n from entry_subtopics where knowledge_entry_id = a_entry;
  if n <> 0 then raise exception 'FAIL: B can read A''s entry links'; end if;
  select count(*) into n from workspaces where id = a_ws;
  if n <> 0 then raise exception 'FAIL: B can read A''s workspace'; end if;
  select count(*) into n from knowledge_entries;
  if n <> 0 then raise exception 'FAIL: an unfiltered scan leaks A''s entries to B'; end if;

  -- UPDATE
  update topics set name = 'hijacked' where id = a_topic;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B updated A''s topic'; end if;
  update knowledge_entries set title = 'hijacked' where id = a_entry;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B updated A''s entry'; end if;

  -- DELETE
  delete from topics where id = a_topic;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B deleted A''s topic'; end if;
  delete from knowledge_entries where id = a_entry;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B deleted A''s entry'; end if;

  -- ATTACH across workspaces (the composite-FK fix)
  blocked := false;
  begin
    insert into knowledge_entries (workspace_id, topic_id, user_id, knowledge_type, title)
    values (b_ws, a_topic, b_id, 'idea', 'graffiti');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL: B attached an entry to A''s topic'; end if;

  blocked := false;
  begin
    insert into subtopics (workspace_id, topic_id, user_id, name, slug)
    values (b_ws, a_topic, b_id, 'graffiti', 'graffiti');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL: B attached a subtopic to A''s topic'; end if;

  -- ATTACH claiming A's workspace outright
  blocked := false;
  begin
    insert into knowledge_entries (workspace_id, topic_id, user_id, knowledge_type, title)
    values (a_ws, a_topic, b_id, 'idea', 'graffiti');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL: B inserted into A''s workspace'; end if;

  -- JOIN TABLE: B links their own entry to A's subtopic
  insert into topics (workspace_id, user_id, name, slug)
  values (b_ws, b_id, 'RLS probe B', 'rls-probe-b') returning id into b_topic;
  insert into knowledge_entries (workspace_id, topic_id, user_id, knowledge_type, title)
  values (b_ws, b_topic, b_id, 'idea', 'B entry') returning id into b_entry;

  blocked := false;
  begin
    insert into entry_subtopics (knowledge_entry_id, subtopic_id) values (b_entry, a_sub);
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL: B linked their entry to A''s subtopic'; end if;

  -- MEMBERSHIP: the privilege-escalation fix
  blocked := false;
  begin
    insert into workspace_members (workspace_id, user_id, role) values (a_ws, b_id, 'owner');
  exception when others then blocked := true; end;
  if not blocked then raise exception 'FAIL: B joined A''s workspace'; end if;

  -- B still works normally in their own workspace.
  select count(*) into n from topics where id = b_topic;
  if n <> 1 then raise exception 'FAIL: B cannot see their own topic'; end if;

  execute 'reset role';

  -- --- Signed-out user ------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';

  begin
    select count(*) into n from topics;
    -- anon has no grants at all, so reaching here at all is a failure.
    raise exception 'FAIL: signed-out role could query topics (% rows)', n;
  exception
    when insufficient_privilege then null;   -- expected
    when others then
      if sqlerrm like 'FAIL:%' then raise; end if;
  end;

  execute 'reset role';

  -- --- A is untouched --------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', a_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into n from topics where id = a_topic;
  if n <> 1 then raise exception 'FAIL: A lost their topic'; end if;
  select count(*) into n from knowledge_entries where id = a_entry and title = 'Blue icon concept';
  if n <> 1 then raise exception 'FAIL: A''s entry was modified'; end if;

  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  raise notice 'ALL HOSTED RLS CHECKS PASSED (%)', procedure_note;
end $$;

select 'ALL HOSTED RLS CHECKS PASSED — nothing was persisted' as result;

-- Everything above is discarded. No test users or test rows remain.
rollback;
