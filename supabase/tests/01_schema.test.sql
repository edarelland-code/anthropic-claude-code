-- Structural assertions: the objects the application depends on exist, with
-- the properties it depends on. Run against a real cluster by scripts/db-test.sh.

begin;

-- Every table carries RLS. A new table without it is a silent data leak.
do $$
declare missing text;
begin
  select string_agg(c.relname, ', ') into missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  perform t.assert(missing is null, format('tables without RLS: %s', missing));
end $$;

-- Every table with RLS has at least one policy. RLS with no policy denies
-- everything, which would be a different kind of bug.
do $$
declare missing text;
begin
  select string_agg(c.relname, ', ') into missing
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname);
  perform t.assert(missing is null, format('tables with RLS but no policy: %s', missing));
end $$;

-- CLAUDE.md rule 6: history tables are insert-only, enforced by the ABSENCE of
-- UPDATE/DELETE policies. If someone ever adds one, this fails loudly.
do $$
declare bad text;
begin
  select string_agg(format('%s:%s', tablename, cmd), ', ') into bad
  from pg_policies
  where schemaname = 'public'
    and tablename in ('prompt_versions', 'knowledge_entry_versions')
    and cmd in ('UPDATE', 'DELETE', 'ALL');
  perform t.assert(bad is null, format('append-only tables have mutating policies: %s', bad));
end $$;

-- The indexes the hot paths rely on.
do $$
declare idx text;
begin
  foreach idx in array array[
    'entries_timeline_idx', 'entries_current_idx', 'entries_search_idx',
    'topics_recent_idx', 'decisions_active_idx', 'relationships_from_idx',
    'sessions_raw_trgm_idx', 'prompt_versions_body_trgm_idx'
  ] loop
    perform t.assert(
      exists (select 1 from pg_indexes where schemaname = 'public' and indexname = idx),
      format('missing index %s', idx));
  end loop;
end $$;

-- updated_at is maintained by trigger, never by the client (CLAUDE.md rule 15).
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'topics', 'subtopics', 'knowledge_entries', 'decisions', 'ideas',
    'prompts', 'actions', 'file_references', 'milestones', 'ingestion_records'
  ] loop
    perform t.assert(
      exists (
        select 1 from pg_trigger tg
        join pg_class c on c.oid = tg.tgrelid
        where c.relname = tbl and tg.tgname = tbl || '_set_updated_at'),
      format('missing updated_at trigger on %s', tbl));
  end loop;
end $$;

-- Workspace consistency constraints (see the migration's rationale).
do $$
declare tbl text;
begin
  foreach tbl in array array[
    'subtopics', 'knowledge_entries', 'decisions', 'ideas', 'prompts',
    'file_references', 'actions', 'milestones', 'context_snapshots'
  ] loop
    perform t.assert(
      exists (select 1 from pg_constraint where conname = tbl || '_topic_workspace_fk'),
      format('missing composite workspace FK on %s', tbl));
  end loop;
end $$;

-- The functions the application calls by name.
do $$
begin
  perform t.assert(to_regprocedure('public.supersede_entry(uuid,text,text,knowledge_type,text)') is not null,
    'supersede_entry() missing or wrong signature');
  perform t.assert(to_regprocedure('public.is_workspace_member(uuid)') is not null,
    'is_workspace_member() missing');
  perform t.assert(
    (select prosecdef from pg_proc where proname = 'is_workspace_member'),
    'is_workspace_member must be security definer or the members policy recurses');
end $$;

-- Progress is a percentage; the domain type promises 0-100.
do $$
begin
  perform t.assert(
    exists (select 1 from pg_constraint where conrelid = 'topics'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%progress%'),
    'topics.progress is missing its range check');
end $$;

commit;
