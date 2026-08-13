-- The product's central promise: Current State never destroys history.
--
-- Models the brief's own example — blue icon proposed, checkmark rejected,
-- slash geometry approved — and asserts that Current shows only the newest
-- while the Timeline still holds all three.

begin;

do $$
declare
  u uuid; ws uuid; topic uuid;
  v1 uuid; v2 uuid; v3 uuid;
  p_id uuid; pv1 uuid;
  n int; blocked boolean; stored_body text;
begin
  insert into auth.users (email) values ('history@example.test') returning id into u;
  select id into ws from workspaces where owner_id = u;
  perform t.login(u);

  insert into topics (workspace_id, user_id, name, slug)
  values (ws, u, 'App Icon', 'app-icon') returning id into topic;

  -- Version 1: blue icon concept proposed
  insert into knowledge_entries (workspace_id, topic_id, user_id, knowledge_type, title, content, occurred_at)
  values (ws, topic, u, 'idea', 'Blue icon concept', 'Rounded blue square', now() - interval '10 days')
  returning id into v1;

  -- Version 2: checkmark concept, rejected outright (not superseded)
  insert into knowledge_entries (workspace_id, topic_id, user_id, knowledge_type, status, title, content, occurred_at)
  values (ws, topic, u, 'rejected_idea', 'rejected', 'Checkmark concept', 'Too generic', now() - interval '5 days')
  returning id into v2;

  -- Version 3: replaces version 1, with a reason
  select supersede_entry(v1, 'Slash to arrow to X geometry', 'Approved direction', 'decision',
                         'Blue square did not read at 16px') into v3;

  -- CURRENT STATE ---------------------------------------------------------
  select count(*) into n from knowledge_entries
   where topic_id = topic and status = 'active' and superseded_by_id is null and deleted_at is null;
  perform t.assert(n = 1, format('Current State should hold exactly the approved entry, found %s', n));

  perform t.assert(
    (select title from knowledge_entries
      where topic_id = topic and status = 'active' and superseded_by_id is null) = 'Slash to arrow to X geometry',
    'Current State is not showing the approved direction');

  -- HISTORY ---------------------------------------------------------------
  select count(*) into n from knowledge_entries where topic_id = topic and deleted_at is null;
  perform t.assert(n = 3, format('Timeline lost history: expected 3 entries, found %s', n));

  perform t.assert(
    exists (select 1 from knowledge_entries where id = v1 and status = 'superseded' and superseded_by_id = v3),
    'the superseded entry was destroyed instead of linked');
  perform t.assert(
    exists (select 1 from knowledge_entries where id = v2 and status = 'rejected'),
    'the rejected entry disappeared');

  -- The reason survives — this is what stops a future session re-proposing it.
  perform t.assert(
    (select supersedes_reason from knowledge_entries where id = v1) = 'Blue square did not read at 16px',
    'the supersede reason was not recorded');

  -- The supersession is also a traversable relationship edge.
  perform t.assert(
    exists (select 1 from relationships
             where from_type = 'knowledge_entry' and from_id = v3
               and relationship_type = 'supersedes' and to_id = v1),
    'no supersedes relationship edge was written');

  -- Superseding is real progress, so the freshness clock moved.
  perform t.assert(
    (select last_meaningful_update_at from topics where id = topic) > now() - interval '1 minute',
    'superseding did not update last_meaningful_update_at');

  -- A supersession with no reason must be refused (CLAUDE.md rule 7).
  blocked := false;
  begin
    perform supersede_entry(v3, 'Another direction', null, 'decision', '   ');
  exception when others then blocked := true;
  end;
  perform t.assert(blocked, 'superseding was allowed without a reason');

  -- APPEND-ONLY PROMPT VERSIONS -------------------------------------------
  insert into prompts (workspace_id, topic_id, user_id, title)
  values (ws, topic, u, 'Icon prompt') returning id into p_id;
  insert into prompt_versions (prompt_id, workspace_id, user_id, version, body, result)
  values (p_id, ws, u, 1, 'original body', 'worked') returning id into pv1;
  insert into prompt_versions (prompt_id, workspace_id, user_id, version, body)
  values (p_id, ws, u, 2, 'revised body');

  -- RLS has no UPDATE policy, so this silently affects zero rows.
  update prompt_versions set body = 'overwritten' where id = pv1;
  get diagnostics n = row_count;
  perform t.assert(n = 0, 'a prompt version was overwritten');

  delete from prompt_versions where id = pv1;
  get diagnostics n = row_count;
  perform t.assert(n = 0, 'a prompt version was deleted');

  select body into stored_body from prompt_versions where id = pv1;
  perform t.assert(stored_body = 'original body', 'v1 body changed');

  select count(*) into n from prompt_versions pv where pv.prompt_id = p_id;
  perform t.assert(n = 2, 'prompt version history is incomplete');

  -- SOFT DELETE IS RECOVERABLE ---------------------------------------------
  update knowledge_entries set deleted_at = now() where id = v2;
  insert into deletion_log (workspace_id, user_id, entity_type, entity_id, snapshot)
  values (ws, u, 'knowledge_entry', v2, jsonb_build_object('title', 'Checkmark concept'));

  select count(*) into n from knowledge_entries where topic_id = topic and deleted_at is null;
  perform t.assert(n = 2, 'soft delete did not hide the row from normal reads');
  select count(*) into n from knowledge_entries where id = v2;
  perform t.assert(n = 1, 'soft delete removed the row from the database');
  perform t.assert(
    exists (select 1 from deletion_log where entity_id = v2),
    'no tombstone was written');

  -- SUBTOPIC TREE ----------------------------------------------------------
  declare root uuid; child uuid;
  begin
    insert into subtopics (workspace_id, topic_id, user_id, name, slug)
    values (ws, topic, u, 'Branding', 'branding') returning id into root;
    insert into subtopics (workspace_id, topic_id, parent_subtopic_id, user_id, name, slug)
    values (ws, topic, root, u, 'App Icon', 'app-icon') returning id into child;

    perform t.assert(
      (select parent_subtopic_id from subtopics where id = child) = root,
      'nested subtopic lost its parent');

    -- The tree must stay a tree.
    blocked := false;
    begin
      update subtopics set parent_subtopic_id = child where id = root;
    exception when others then blocked := true;
    end;
    perform t.assert(blocked, 'a subtopic cycle was allowed');
  end;

  -- RELATIONSHIP INTEGRITY --------------------------------------------------
  blocked := false;
  begin
    insert into relationships (workspace_id, user_id, from_type, from_id, relationship_type, to_type, to_id)
    values (ws, u, 'knowledge_entry', v3, 'relates_to', 'decision', gen_random_uuid());
  exception when others then blocked := true;
  end;
  perform t.assert(blocked, 'a relationship to a non-existent row was accepted');

  perform t.logout();
  raise notice 'History: supersession preserves the trail, prompt versions are immutable, soft deletes are recoverable, the subtopic tree stays acyclic';
end $$;

rollback;
