-- Phase 3: the search_documents projection.
--
-- The security property comes first, for the same reason it does in
-- 04_timeline.test.sql. search_documents unions twelve tables. A view runs as
-- its OWNER unless it is created with security_invoker = true, and an
-- owner-run view reads straight past row-level security on every table beneath
-- it. The failure is silent — search works perfectly and quietly returns one
-- user's transcripts, prompts and decisions to another — so it is asserted
-- here rather than assumed.
--
-- Deleting `with (security_invoker = true)` from 0004 makes the block marked
-- ISOLATION below fail. That is the check.
--
-- The rest proves the retrieval guarantees Phase 3 exists for:
--   * search reaches inside a pasted transcript, not only its summary
--   * search reaches the authoritative fields Current State and Master Topic
--     Memory are assembled from, without a second copy of derived memory
--   * every hit says whether it is current, historical, or a saved snapshot

begin;

do $$
declare
  a_id uuid; b_id uuid;
  a_ws uuid; b_ws uuid;
  a_topic uuid; a_sub uuid; b_topic uuid;
  a_entry uuid; a_old uuid; a_new uuid;
  a_decision uuid; a_prompt uuid; a_v1 uuid; a_v2 uuid;
  a_session uuid; a_snapshot uuid; a_inbox uuid;
  n int; s text;
begin
  insert into auth.users (email) values ('search-a@example.test') returning id into a_id;
  insert into auth.users (email) values ('search-b@example.test') returning id into b_id;
  select id into a_ws from workspaces where owner_id = a_id;
  select id into b_ws from workspaces where owner_id = b_id;

  perform t.login(a_id);

  insert into topics (workspace_id, user_id, name, slug, goal, current_state)
  values (a_ws, a_id, 'DailyRelay', 'dailyrelay',
          'Ship the vermilion launcher by October',
          'Waiting on the trapezoid geometry review')
  returning id into a_topic;

  insert into subtopics (workspace_id, topic_id, user_id, name, slug, current_state)
  values (a_ws, a_topic, a_id, 'Branding', 'branding', 'Palette narrowed to periwinkle')
  returning id into a_sub;

  insert into knowledge_entries (workspace_id, topic_id, user_id, knowledge_type, title, content)
  values (a_ws, a_topic, a_id, 'progress', 'Shipped the icon set', 'Rendered at sixteen pixels')
  returning id into a_entry;

  insert into decisions (workspace_id, topic_id, user_id, title, decision, reason)
  values (a_ws, a_topic, a_id, 'Use a marmalade accent', 'Adopt marmalade', 'Reads at small sizes')
  returning id into a_decision;

  insert into prompts (workspace_id, topic_id, user_id, title, purpose)
  values (a_ws, a_topic, a_id, 'Icon prompt', 'Generate launcher icons')
  returning id into a_prompt;
  insert into prompt_versions (prompt_id, workspace_id, user_id, version, body)
  values (a_prompt, a_ws, a_id, 1, 'Draw a chartreuse glyph') returning id into a_v1;
  insert into prompt_versions (prompt_id, workspace_id, user_id, version, body)
  values (a_prompt, a_ws, a_id, 2, 'Draw a heliotrope glyph') returning id into a_v2;
  update prompts set current_version_id = a_v2 where id = a_prompt;

  -- A pasted transcript. The distinctive word appears ONLY in the raw body,
  -- never in the title or summary.
  insert into source_sessions (workspace_id, user_id, topic_id, source_type, title, summary, raw_content)
  values (a_ws, a_id, a_topic, 'claude_chat', 'Icon exploration', 'Discussed the icon',
          'User: what about a zucchini silhouette? Assistant: it reads as a blob at 16px.')
  returning id into a_session;

  insert into context_snapshots (workspace_id, topic_id, user_id, target, body)
  values (a_ws, a_topic, a_id, 'Claude Code', 'Saved memory mentioning the bergamot direction')
  returning id into a_snapshot;

  insert into ingestion_records (workspace_id, user_id, source_type, raw_content, source_hint)
  values (a_ws, a_id, 'manual', 'A pasted note about the aubergine variant', 'Quick capture')
  returning id into a_inbox;

  -- =====================================================================
  -- RETRIEVAL
  -- =====================================================================

  -- Search reaches INSIDE the transcript. This is the Phase 3 exit criterion.
  select count(*) into n from search_documents
   where workspace_id = a_ws and search_vector @@ websearch_to_tsquery('english', 'zucchini');
  perform t.assert(n = 1, format('search did not reach inside the transcript, found %s', n));
  perform t.assert(
    (select entity_type from search_documents
      where workspace_id = a_ws and search_vector @@ websearch_to_tsquery('english', 'zucchini'))
    = 'source_session',
    'the transcript hit was attributed to the wrong record type');

  -- CLARIFICATION 1 — Current State is searchable through the authoritative
  -- column it is stored in, not through a copy of the derived read.
  select count(*) into n from search_documents
   where workspace_id = a_ws and search_vector @@ websearch_to_tsquery('english', 'trapezoid');
  perform t.assert(n = 1, 'topics.current_state is not searchable');
  perform t.assert(
    (select entity_id from search_documents
      where workspace_id = a_ws and search_vector @@ websearch_to_tsquery('english', 'trapezoid')) = a_topic,
    'a Current State hit did not resolve to the topic that holds it');

  -- The same for a topic goal, which Master Topic Memory renders as "Current
  -- objective", and for a subtopic's own current state.
  select count(*) into n from search_documents
   where workspace_id = a_ws and search_vector @@ websearch_to_tsquery('english', 'vermilion');
  perform t.assert(n = 1, 'a topic goal is not searchable');
  select count(*) into n from search_documents
   where workspace_id = a_ws and search_vector @@ websearch_to_tsquery('english', 'periwinkle');
  perform t.assert(n = 1, 'a subtopic current state is not searchable');

  -- Every prompt version is searchable, not only the head — the winning text
  -- is often an older one (rule 9a).
  select count(*) into n from search_documents
   where workspace_id = a_ws and search_vector @@ websearch_to_tsquery('english', 'chartreuse');
  perform t.assert(n = 1, 'an older prompt version fell out of search');

  -- Inbox items are searchable before they are filed, so a quick capture is
  -- findable the moment it is saved.
  select count(*) into n from search_documents
   where workspace_id = a_ws and search_vector @@ websearch_to_tsquery('english', 'aubergine');
  perform t.assert(n = 1, 'an unfiled inbox item is not searchable');

  -- =====================================================================
  -- RECORD STATE — current vs historical vs snapshot
  -- =====================================================================

  select record_state into s from search_documents where entity_id = a_entry;
  perform t.assert(s = 'current', format('an active entry reported record_state %s', s));

  select record_state into s from search_documents where entity_id = a_session;
  perform t.assert(s = 'historical', 'Layer 1 evidence should read as historical');

  select record_state into s from search_documents where entity_id = a_snapshot;
  perform t.assert(s = 'snapshot',
    'a saved memory snapshot must be labelled a snapshot, never a current record (AD-8)');

  -- The head version is current; the one it replaced is history.
  select record_state into s from search_documents where entity_id = a_v2;
  perform t.assert(s = 'current', 'the head prompt version is not current');
  select record_state into s from search_documents where entity_id = a_v1;
  perform t.assert(s = 'historical', 'a replaced prompt version is not history');

  -- Superseding flips the state without removing the row from search.
  insert into knowledge_entries (workspace_id, topic_id, user_id, knowledge_type, title, content)
  values (a_ws, a_topic, a_id, 'decision', 'Blue icon', 'Use a blue circle') returning id into a_old;
  select supersede_entry(a_old, 'Slash geometry', 'Approved direction', 'decision',
                         'blue read as a status dot') into a_new;

  select record_state into s from search_documents where entity_id = a_old;
  perform t.assert(s = 'historical', 'a superseded entry still reports as current');
  select record_state into s from search_documents where entity_id = a_new;
  perform t.assert(s = 'current', 'the replacement entry is not current');
  perform t.assert(
    (select count(*) from search_documents where entity_id in (a_old, a_new)) = 2,
    'superseding removed a row from search instead of relabelling it');

  -- Soft-deleted rows leave search. They are not gone — deletion_log and the
  -- Recovery screen hold them — but a deleted record is not a search result.
  perform soft_delete_record('knowledge_entry', a_entry, 'test');
  perform t.assert(
    not exists (select 1 from search_documents where entity_id = a_entry),
    'a soft-deleted record is still returned by search');

  -- =====================================================================
  -- ISOLATION  ← this is the block that fails without security_invoker
  -- =====================================================================

  perform t.logout();
  perform t.login(b_id);

  insert into topics (workspace_id, user_id, name, slug)
  values (b_ws, b_id, 'B private work', 'b-private') returning id into b_topic;

  -- Every distinctive term above belongs to user A alone.
  select count(*) into n from search_documents
   where search_vector @@ websearch_to_tsquery(
     'english', 'zucchini or trapezoid or marmalade or chartreuse or heliotrope or bergamot or aubergine or periwinkle or vermilion');
  perform t.assert(n = 0,
    format('SEARCH LEAK: user B received %s of user A''s records through search_documents', n));

  -- And an unfiltered read returns B's own rows and nothing else. Asserting
  -- zero here would be wrong — B has a topic in this fixture.
  select count(*) into n from search_documents where workspace_id <> b_ws;
  perform t.assert(n = 0,
    format('SEARCH LEAK: user B saw %s rows belonging to another workspace', n));

  select count(*) into n from search_documents where workspace_id = b_ws;
  perform t.assert(n = 1, format('user B should see exactly their own topic, saw %s', n));

  -- Naming a row directly does not fetch it either.
  perform t.assert(
    not exists (select 1 from search_documents where entity_id = a_session),
    'SEARCH LEAK: user B fetched user A''s transcript by id');

  perform t.logout();
  raise notice 'Search: transcripts, Current State fields, goals and every prompt version are retrievable; current, historical and snapshot hits are distinguished; soft deletes drop out; and user B sees none of user A''s records.';
end $$;

rollback;
