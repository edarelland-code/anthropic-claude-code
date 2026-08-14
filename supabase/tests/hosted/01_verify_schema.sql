-- ContextShelf — hosted schema verification
--
-- Run this in the Supabase SQL Editor AFTER applying the migration. It changes
-- nothing: it only reports what the hosted database actually contains, so the
-- claim "the schema is deployed" can be checked rather than assumed.
--
-- Copy the whole result table back and it can be compared against what
-- `npm run test:db` proves locally.

with expected_tables(name) as (
  values ('profiles'),('workspaces'),('workspace_members'),('topics'),('subtopics'),
         ('source_sessions'),('session_subtopics'),('knowledge_entries'),('entry_subtopics'),
         ('knowledge_entry_versions'),('decisions'),('ideas'),('prompts'),('prompt_versions'),
         ('file_references'),('actions'),('milestones'),('relationships'),('tags'),
         ('taggables'),('context_snapshots'),('ingestion_records'),('ingestion_tokens'),
         ('deletion_log'),('prompt_version_outcomes'),('prompt_winning_selections'),
         ('ingestion_deliveries'),('extraction_runs'),('extraction_suggestions')
),
checks as (

  select 1 as ord, 'tables present' as check_name,
         count(*)::text || ' / 29' as result,
         case when count(*) = 29 then 'PASS' else 'FAIL: missing ' ||
           coalesce((select string_agg(e.name, ', ') from expected_tables e
                     where not exists (select 1 from pg_tables p
                                       where p.schemaname='public' and p.tablename=e.name)), '?')
         end as verdict
  from pg_tables p join expected_tables e on e.name = p.tablename
  where p.schemaname = 'public'

  union all
  select 2, 'RLS enabled on every table',
         count(*) filter (where c.relrowsecurity)::text || ' / ' || count(*)::text,
         case when count(*) = count(*) filter (where c.relrowsecurity) then 'PASS'
              else 'FAIL: ' || string_agg(c.relname, ', ') filter (where not c.relrowsecurity)
         end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'

  union all
  select 3, 'every table has at least one policy',
         count(*)::text || ' tables without a policy',
         case when count(*) = 0 then 'PASS' else 'FAIL: ' || string_agg(relname, ', ') end
  from (
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relkind='r'
      and not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=c.relname)
  ) s

  union all
  -- CLAUDE.md rule 6: history tables must have NO mutating policy.
  select 4, 'history tables are append-only',
         coalesce(string_agg(tablename || ':' || cmd, ', '), 'no mutating policies'),
         case when count(*) = 0 then 'PASS' else 'FAIL — versions can be overwritten' end
  from pg_policies
  where schemaname='public' and tablename in ('prompt_versions','knowledge_entry_versions','prompt_version_outcomes','prompt_winning_selections')
    and cmd in ('UPDATE','DELETE','ALL')

  union all
  -- The privilege-escalation fix: joining a workspace must require ownership.
  select 5, 'workspace_members insert requires ownership',
         coalesce((select with_check from pg_policies
                   where schemaname='public' and tablename='workspace_members' and cmd='INSERT'
                   limit 1), '(no INSERT policy)'),
         case when exists (
                select 1 from pg_policies
                where schemaname='public' and tablename='workspace_members' and cmd='INSERT'
                  and with_check like '%owner_id%'
                  and with_check not like '%user_id = auth.uid()%'
              ) then 'PASS'
              else 'FAIL — a user may be able to join an arbitrary workspace' end

  union all
  select 6, 'composite workspace foreign keys',
         count(*)::text || ' / 9',
         case when count(*) = 9 then 'PASS' else 'FAIL — cross-workspace attachment possible' end
  from pg_constraint
  where conname like '%\_topic\_workspace\_fk' escape '\'

  union all
  select 7, 'join-table workspace triggers',
         count(*)::text || ' / 2',
         case when count(*) = 2 then 'PASS' else 'FAIL' end
  from pg_trigger
  where tgname in ('entry_subtopics_same_workspace','session_subtopics_same_workspace')

  union all
  select 8, 'updated_at triggers',
         count(*)::text || ' / 15',
         case when count(*) = 15 then 'PASS' else 'FAIL' end
  from pg_trigger where tgname like '%\_set\_updated\_at' escape '\'

  union all
  select 9, 'required indexes',
         count(*)::text || ' / 8',
         case when count(*) = 8 then 'PASS' else 'FAIL' end
  from pg_indexes
  where schemaname='public' and indexname in (
    'entries_timeline_idx','entries_current_idx','entries_search_idx','topics_recent_idx',
    'decisions_active_idx','relationships_from_idx','sessions_raw_trgm_idx',
    'prompt_versions_body_trgm_idx')

  union all
  select 10, 'functions',
         count(*)::text || ' / 6',
         case when count(*) = 6 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname in (
    'set_updated_at','is_workspace_member','subtopics_no_cycle','entity_exists',
    'relationships_validate','supersede_entry')

  union all
  select 11, 'supersede_entry requires a reason',
         case when pg_get_functiondef(p.oid) like '%a supersede reason is required%'
              then 'reason check present' else 'reason check MISSING' end,
         case when pg_get_functiondef(p.oid) like '%a supersede reason is required%'
              then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='supersede_entry'

  union all
  select 12, 'is_workspace_member is security definer',
         case when p.prosecdef then 'security definer' else 'security invoker' end,
         case when p.prosecdef then 'PASS' else 'FAIL — members policy will recurse' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='is_workspace_member'

  union all
  select 13, 'new-user bootstrap trigger',
         count(*)::text || ' / 1',
         case when count(*) = 1 then 'PASS' else 'FAIL — new sign-ups get no workspace' end
  from pg_trigger where tgname = 'on_auth_user_created'

  union all
  select 14, 'anon has no table privileges',
         count(*)::text || ' grants to anon',
         case when count(*) = 0 then 'PASS' else 'FAIL' end
  from information_schema.role_table_grants
  where grantee = 'anon' and table_schema = 'public'

  union all
  select 15, 'authenticated can reach the tables',
         count(distinct table_name)::text || ' tables granted',
         case when count(distinct table_name) >= 26 then 'PASS' else 'FAIL' end
  from information_schema.role_table_grants
  where grantee = 'authenticated' and table_schema = 'public'

  -- Phase 3 ------------------------------------------------------------------
  -- Note what is NOT here: a new table. Phase 3 added none. The Inbox, Layer 1
  -- evidence, file references, tags and the deletion log were all modelled in
  -- Phase 0; the count above is still 26.

  union all
  -- AD-17. A view runs as its OWNER by default and reads past RLS on every
  -- table beneath it. Every derived read model must opt out of that.
  select 16, 'derived views are security_invoker',
         count(*) filter (where array_to_string(c.reloptions, ',') like '%security_invoker=true%')::text
           || ' / ' || count(*)::text,
         case when count(*) = 4
               and count(*) = count(*) filter (
                     where array_to_string(c.reloptions, ',') like '%security_invoker=true%')
              then 'PASS'
              else 'FAIL — a view is reading past row-level security: ' ||
                   coalesce(string_agg(c.relname, ', ') filter (
                     where array_to_string(c.reloptions, ',') not like '%security_invoker=true%'),
                     'expected 4 views')
         end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and c.relname in ('timeline_events','prompt_version_current_outcome',
                      'prompt_current_winning','search_documents')

  union all
  select 17, 'Phase 3 functions',
         count(*)::text || ' / 6',
         case when count(*) = 6 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname in (
    'content_fingerprint','persist_ingestion','soft_delete_record','restore_record',
    'search_records','search_type_counts')

  union all
  -- Writing through a definer function would let a caller name any workspace
  -- and have RLS check the function owner's membership instead of theirs.
  select 18, 'capture functions are security invoker',
         coalesce(string_agg(p.proname || ':' ||
           case when p.prosecdef then 'definer' else 'invoker' end, ', '), '(none found)'),
         case when count(*) = 5 and count(*) filter (where p.prosecdef) = 0 then 'PASS'
              else 'FAIL — a write or search path bypasses the caller''s row-level security' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname in ('persist_ingestion','soft_delete_record','restore_record',
                                             'search_records','search_type_counts')

  union all
  -- The allowlist is the security boundary. If these functions ever start
  -- building a table name, a client-supplied entity_type chooses what gets
  -- written to.
  select 19, 'soft delete uses no dynamic SQL',
         count(*)::text || ' function(s) containing EXECUTE',
         case when count(*) = 0 then 'PASS'
              else 'FAIL — a mutating function interpolates a table name' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname in ('soft_delete_record','restore_record')
    and upper(pg_get_functiondef(p.oid)) like '%EXECUTE FORMAT%'

  union all
  select 20, 'soft delete refuses append-only history',
         case when pg_get_functiondef(p.oid) like '%append-only history and cannot be deleted%'
              then 'prompt_version refused' else 'refusal MISSING' end,
         case when pg_get_functiondef(p.oid) like '%append-only history and cannot be deleted%'
               and pg_get_functiondef(p.oid) like '%immutable Layer 1 evidence%'
              then 'PASS' else 'FAIL — rule 6 or rule 10 is unenforced' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname='soft_delete_record'

  union all
  select 21, 'search vectors across record types',
         count(*)::text || ' / 13',
         case when count(*) = 13 then 'PASS' else 'FAIL — a record type is unsearchable' end
  from information_schema.columns
  where table_schema='public' and column_name='search_vector'
    and table_name in ('topics','subtopics','knowledge_entries','decisions','ideas','prompts',
                       'prompt_versions','source_sessions','file_references','actions',
                       'milestones','ingestion_records','context_snapshots')

  union all
  -- Current State and Master Topic Memory are derived reads, so they are
  -- searched through the authoritative columns they are assembled from rather
  -- than through a stored copy of the memory.
  select 22, 'Current State is searchable at source',
         case when pg_get_viewdef('search_documents'::regclass) like '%current_state%'
              then 'topics.current_state feeds the topic vector' else 'NOT reachable' end,
         case when exists (
                select 1 from pg_attrdef d join pg_class c on c.oid = d.adrelid
                join pg_attribute a on a.attrelid = c.oid and a.attnum = d.adnum
                where c.relname='topics' and a.attname='search_vector'
                  and pg_get_expr(d.adbin, d.adrelid) like '%current_state%')
              then 'PASS' else 'FAIL — a phrase remembered from memory cannot be found' end

  union all
  select 23, 'duplicate fingerprints',
         count(*)::text || ' / 4',
         case when count(*) = 4 then 'PASS' else 'FAIL' end
  from information_schema.columns
  where table_schema='public' and column_name in ('content_hash','body_hash','raw_hash')
    and table_name in ('knowledge_entries','prompt_versions','source_sessions','ingestion_records')

  union all
  -- Rule 17: detection PROPOSES. A unique constraint would decide instead.
  select 24, 'fingerprints do not enforce uniqueness',
         count(*)::text || ' unique constraints on a hash column',
         case when count(*) = 0 then 'PASS'
              else 'FAIL — a duplicate would be refused rather than proposed' end
  from pg_indexes
  where schemaname='public' and indexdef like '%UNIQUE%'
    and (indexdef like '%content_hash%' or indexdef like '%body_hash%' or indexdef like '%raw_hash%')

  union all
  select 25, 'Phase 3 indexes',
         count(*)::text || ' / 8',
         case when count(*) = 8 then 'PASS' else 'FAIL' end
  from pg_indexes
  where schemaname='public' and indexname in (
    'topics_search_idx','decisions_search_idx','sessions_search_idx','ingestion_search_idx',
    'entries_content_hash_idx','sessions_raw_hash_idx','ingestion_status_idx','deletion_log_open_idx')

  union all
  select 26, 'search_documents is reachable by authenticated, not anon',
         coalesce(string_agg(grantee || ':' || privilege_type, ', '), '(no grants)'),
         case when count(*) filter (where grantee='anon') = 0
               and count(*) filter (where grantee='authenticated' and privilege_type='SELECT') = 1
              then 'PASS' else 'FAIL' end
  from information_schema.role_table_grants
  where table_schema='public' and table_name='search_documents'

  union all
  select 27, 'Phase 5 ingestion functions',
         count(*)::text || ' / 2',
         case when count(*) = 2 then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('ingest_from_token', 'assert_ingest_work_allowed')

  union all
  -- The whole authorization boundary for the endpoint. `authenticated`
  -- holding EXECUTE would mean any signed-in user could ingest as anyone
  -- whose token hash they had obtained.
  select 28, 'only the server may call ingest_from_token',
         coalesce(nullif(concat_ws(', ',
           case when has_function_privilege('anon', p.oid, 'execute') then 'anon' end,
           case when has_function_privilege('authenticated', p.oid, 'execute') then 'authenticated' end,
           case when has_function_privilege('service_role', p.oid, 'execute') then 'service_role' end
         ), ''), '(nobody)'),
         case when not has_function_privilege('anon', p.oid, 'execute')
               and not has_function_privilege('authenticated', p.oid, 'execute')
               and has_function_privilege('service_role', p.oid, 'execute')
              then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'ingest_from_token'

  union all
  -- One delivery per key per token, enforced by the database rather than by
  -- the endpoint remembering to check.
  select 29, 'one Idempotency-Key per token, enforced by an index',
         coalesce(string_agg(indexname, ', '), '(none)'),
         case when count(*) = 1 then 'PASS' else 'FAIL' end
  from pg_indexes
  where schemaname = 'public' and tablename = 'ingestion_deliveries' and indexdef like '%UNIQUE%'
    and indexdef like '%token_id%' and indexdef like '%idempotency_key%'

  union all
  -- Token scope is composite (AD-11). A plain FK to topics(id) would let a
  -- token in workspace B default to a topic in workspace A.
  select 30, 'token scope foreign keys are composite',
         count(*)::text || ' / 2',
         case when count(*) = 2 then 'PASS' else 'FAIL' end
  from pg_constraint
  where conname in ('ingestion_tokens_scope_topic_fk', 'ingestion_tokens_scope_subtopic_fk')
    and array_length(conkey, 1) = 2

  union all
  select 31, 'the session records build and test state',
         count(*)::text || ' / 3',
         case when count(*) = 3 then 'PASS' else 'FAIL' end
  from information_schema.columns
  where table_schema = 'public' and table_name = 'source_sessions'
    and column_name in ('build_status', 'test_summary', 'artifacts')

  union all
  select 32, 'the delivery ledger is workspace-scoped',
         coalesce(string_agg(policyname, ', '), '(no policy)'),
         case when count(*) >= 1 then 'PASS' else 'FAIL' end
  from pg_policies
  where schemaname = 'public' and tablename = 'ingestion_deliveries'

  union all
  -- Phase 6. A suggestion is not a record, and the table that holds one must
  -- still be workspace-scoped: an unreviewed proposal quotes the source it came
  -- from, so leaking one leaks the transcript.
  select 33, 'suggestion tables are workspace-scoped and RLS-enabled',
         count(*) filter (where c.relrowsecurity)::text || ' / 2 with RLS, '
           || (select count(*) from pg_policies
                where schemaname = 'public'
                  and tablename in ('extraction_runs', 'extraction_suggestions'))::text || ' policies',
         case when count(*) filter (where c.relrowsecurity) = 2
               and (select count(*) from pg_policies
                     where schemaname = 'public'
                       and tablename in ('extraction_runs', 'extraction_suggestions')) >= 2
              then 'PASS' else 'FAIL' end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('extraction_runs', 'extraction_suggestions')

  union all
  select 34, 'confirmation is security invoker',
         coalesce(string_agg(p.proname || ':' || case when p.prosecdef then 'definer' else 'invoker' end, ', '), '(missing)'),
         case when count(*) = 1 and bool_and(not p.prosecdef) then 'PASS' else 'FAIL' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'confirm_extraction_suggestions'
)
select check_name, result, verdict from checks order by ord;
