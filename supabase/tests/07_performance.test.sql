-- Phase 3: does retrieval still work at a realistic volume?
--
-- The honest failure this guards against is not slowness in the abstract. It is
-- a query that reads correctly on twelve rows and degrades to a sequential scan
-- of every transcript in the workspace once there are thousands — which is
-- exactly when a person stops trusting search and goes back to scrolling
-- through Claude conversations.
--
-- Asserts PLANS, not milliseconds. A wall-clock threshold measures the machine
-- running the test far more than the schema, and is the reason performance
-- tests get deleted six months later. "This query uses its index" is a claim
-- about the schema, stays true on any machine, and fails loudly when an index
-- is dropped or a predicate stops being sargable.
--
-- Everything is seeded inside a transaction and rolled back. No test data ever
-- reaches a real database — this suite never runs against hosted (see
-- scripts/db-test.sh, which points it at an ephemeral cluster).

begin;

do $$
declare
  u uuid; ws uuid; topic uuid;
  n int; plan text; rows_back int; h text;
  t0 timestamptz; ms numeric;
begin
  insert into auth.users (email) values ('perf@example.test') returning id into u;
  select id into ws from workspaces where owner_id = u;
  perform t.login(u);

  -- --- Seed ---------------------------------------------------------------
  -- 20 topics, 4,000 knowledge entries, 200 transcripts of ~2 KB each. Larger
  -- than a year of heavy single-user use, which is the point: the plan has to
  -- hold at the top of the range, not the middle.
  insert into topics (workspace_id, user_id, name, slug, goal, current_state)
  select ws, u, 'Topic ' || g, 'topic-' || g,
         'Ship milestone ' || g, 'Working through step ' || g
  from generate_series(1, 20) g;

  select id into topic from topics where workspace_id = ws order by slug limit 1;

  insert into knowledge_entries (workspace_id, topic_id, user_id, knowledge_type, title, content, occurred_at)
  select
    ws,
    (select id from topics where workspace_id = ws order by md5(slug || g::text) limit 1),
    u,
    (array['progress','decision','idea','bug','fix','research','requirement'])[1 + (g % 7)]::knowledge_type,
    'Entry ' || g || ' about the icon geometry',
    -- A distinctive term on roughly one entry in eight hundred. Real corpora
    -- are mostly rare words, and a search index only earns its keep on a
    -- SELECTIVE predicate: a term that appears in every row is correctly
    -- answered by a sequential scan, so seeding one would test nothing while
    -- looking like it did.
    'Body text for entry ' || g || '. Rendered at sixteen pixels, reviewed, and recorded.'
      || case when g % 800 = 0 then ' Filed under kumquat' || (g / 800) || '.' else '' end,
    now() - (g || ' minutes')::interval
  from generate_series(1, 4000) g;

  insert into source_sessions (workspace_id, user_id, topic_id, source_type, title, summary, raw_content, occurred_at)
  select
    ws, u,
    (select id from topics where workspace_id = ws order by md5(slug || g::text) limit 1),
    'claude_chat', 'Session ' || g, 'A conversation about step ' || g,
    repeat('User: what next? Assistant: keep going with the geometry review. ', 30)
      || ' The distinctive marker here is pomegranate' || g || '.',
    now() - (g || ' hours')::interval
  from generate_series(1, 200) g;

  -- ANALYZE belongs to the table owner, and everything above ran as the
  -- `authenticated` role on purpose — seeding through RLS is what makes the
  -- volume representative. Drop the role for the statistics, then pick it back
  -- up: planning against stale statistics would test nothing, since Postgres
  -- would be choosing plans for a table it still believes is empty.
  perform t.logout();
  reset role;
  analyze knowledge_entries;
  analyze source_sessions;
  analyze topics;
  perform t.login(u);

  select count(*) into n from knowledge_entries where workspace_id = ws;
  perform t.assert(n = 4000, format('seed produced %s entries', n));

  -- --- Search still finds one row among thousands --------------------------
  t0 := clock_timestamp();
  select count(*) into rows_back
  from search_records(ws, 'pomegranate7');
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  perform t.assert(rows_back = 1,
    format('a unique term among 4,200 records returned %s rows', rows_back));
  raise notice '  search for a unique term across 4,200 records: % rows in % ms', rows_back, round(ms, 1);

  -- =========================================================================
  -- THE LEAKPROOF LIMIT
  --
  -- Full-text search cannot use its GIN index for a real user. Not "does not
  -- today at this size" — cannot, at any size.
  --
  -- A row-level security policy is a security-barrier qualifier: PostgreSQL
  -- will not evaluate a NON-LEAKPROOF operator before it, because doing so
  -- could reveal values from rows the policy exists to hide. An index
  -- condition is evaluated inside the scan, before that qualifier — so a
  -- non-leakproof operator cannot be an index condition at all.
  --
  --   select proleakproof from pg_proc where proname = 'ts_match_vq';  -- f
  --
  -- `@@` and `ILIKE` are both marked not leakproof in stock PostgreSQL;
  -- equality is leakproof. So on every RLS-protected table:
  --
  --   * full-text search scans the rows the policy admits, however many GIN
  --     indexes exist
  --   * fingerprint equality, foreign keys and ordering all use their indexes
  --
  -- Establishing this took some care, because a casual plan reading suggests
  -- the opposite. With sequential scans merely discouraged the planner shows a
  -- Bitmap Heap Scan and looks fine — but the index it picks is
  -- `entries_workspace_recent_idx`, driven by the leakproof `workspace_id`
  -- equality, with `@@` applied afterwards as a filter. The search index is
  -- not involved. The probe below removes that ambiguity by dropping the
  -- workspace predicate entirely and penalising sequential scans by 1e10: at
  -- that price the planner would take any index available to it, and as
  -- `authenticated` it still scans, while the owner running the identical
  -- statement gets the GIN index.
  --
  -- Phase 3 did not introduce this. `entries_search_idx` has been unusable by
  -- real users since Phase 0, and it stayed invisible because plans had only
  -- ever been read as the table owner — which is why this suite runs as
  -- `authenticated`.
  --
  -- The cost today is bounded and measured (see the notice below). The fixes
  -- all change the authorisation model — marking the operator leakproof
  -- globally, or moving search behind a definer function with its own
  -- membership check — so none is applied unilaterally. Recorded in
  -- docs/DEVELOPMENT_STATE.md.
  --
  -- This asserts the CURRENT TRUTH, not the preference. If a later change makes
  -- full-text index-served, this is what notices, and it should then be
  -- inverted deliberately.
  -- =========================================================================
  set local enable_seqscan = off;

  execute 'explain (format json) select id from knowledge_entries
             where search_vector @@ websearch_to_tsquery(''english'', ''kumquat3'')'
    into plan;
  perform t.assert(plan like '%"Node Type": "Seq Scan"%',
    'full-text search is now index-served under RLS. That is an improvement — invert this assertion and update the note in docs/DEVELOPMENT_STATE.md deliberately.');

  -- The owner, same statement, same planner settings, same data. The only
  -- variable is whether row-level security applies, which is what makes the
  -- cause unambiguous: the index is correct, RLS is what puts it out of reach.
  perform t.logout();
  execute 'explain (format json) select id from knowledge_entries
             where search_vector @@ websearch_to_tsquery(''english'', ''kumquat3'')'
    into plan;
  perform t.assert(plan like '%entries_search_idx%',
    format('the GIN index is unreachable even for the owner, which would mean it is genuinely wrong: %s',
           left(plan, 300)));
  perform t.login(u);

  reset enable_seqscan;

  -- What that costs today, so the limitation is a number rather than a worry.
  t0 := clock_timestamp();
  perform count(*) from knowledge_entries
   where workspace_id = ws and search_vector @@ websearch_to_tsquery('english', 'kumquat3');
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice '  full-text across 4,000 entries as a real user: % ms (scan, not index)', round(ms, 1);

  -- --- What DOES stay index-served under RLS -------------------------------
  -- Leakproof predicates and orderings. These are the reads that must never
  -- regress, because nothing else is holding them up.

  -- Duplicate proposals: the one lookup a person waits on mid-triage.
  select content_hash into h from knowledge_entries
   where title = 'Entry 42 about the icon geometry' limit 1;
  perform t.assert(h is not null, 'the fingerprint fixture did not match a seeded row');
  execute 'explain (format json) select id from knowledge_entries
             where workspace_id = $1 and content_hash = $2 and deleted_at is null'
    into plan using ws, h;
  perform t.assert(plan not like '%"Node Type": "Seq Scan"%',
    format('duplicate lookup fell back to a sequential scan: %s', left(plan, 300)));

  -- The Topic page timeline.
  execute 'explain (format json) select id from knowledge_entries
             where topic_id = $1 and deleted_at is null
             order by occurred_at desc limit 50'
    into plan using topic;
  perform t.assert(plan like '%Index%',
    format('the topic timeline is not using an index: %s', left(plan, 300)));

  -- The cross-topic Timeline page.
  execute 'explain (format json) select id from knowledge_entries
             where workspace_id = $1 order by occurred_at desc limit 50'
    into plan using ws;
  perform t.assert(plan like '%Index%',
    format('the workspace timeline is not using an index: %s', left(plan, 300)));

  -- --- Paging is a window on one order, not a re-sort -----------------------
  declare page1 uuid[]; page2 uuid[];
  begin
    select array_agg(entity_id order by ord) into page1
    from (select entity_id, row_number() over () ord from search_records(ws, 'geometry', p_limit => 20)) x;
    select array_agg(entity_id order by ord) into page2
    from (select entity_id, row_number() over () ord
          from search_records(ws, 'geometry', p_limit => 20, p_offset => 20)) y;
    perform t.assert(coalesce(array_length(page1, 1), 0) = 20, 'page 1 was short');
    perform t.assert(not (page1 && page2),
      'pages overlap — the ranking is not a total order, so results repeat between pages');
  end;

  perform t.logout();
  raise notice 'Performance: 4,200 records seeded and read as the real authenticated role. Search is correct at volume; fingerprint lookups and both timelines are index-served; full-text scans rather than indexes because row-level security forbids indexing a non-leakproof operator, which is asserted here rather than assumed.';
end $$;

rollback;
