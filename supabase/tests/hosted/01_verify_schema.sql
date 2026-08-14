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
         ('deletion_log'),('prompt_version_outcomes'),('prompt_winning_selections')
),
checks as (

  select 1 as ord, 'tables present' as check_name,
         count(*)::text || ' / 26' as result,
         case when count(*) = 26 then 'PASS' else 'FAIL: missing ' ||
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
         count(*)::text || ' / 13',
         case when count(*) = 13 then 'PASS' else 'FAIL' end
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
)
select check_name, result, verdict from checks order by ord;
