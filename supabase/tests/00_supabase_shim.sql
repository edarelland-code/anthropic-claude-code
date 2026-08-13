-- Local-only emulation of the parts of a Supabase project that live outside
-- our migrations: the `auth` schema, the JWT-claim helpers, and the three
-- Supabase roles with their default grants.
--
-- This file is NEVER applied to a real Supabase project — Supabase provides
-- all of it. It exists so `npm run test:db` can execute the real migration and
-- exercise the real RLS policies against a real Postgres, instead of asserting
-- that the SQL "looks correct".
--
-- Keep this in sync with Supabase's own definitions; if the two drift, the
-- tests stop proving anything about production.

create schema if not exists auth;

create table if not exists auth.users (
  id                uuid primary key default gen_random_uuid(),
  email             text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

-- Supabase's definition: read `sub` out of the request's JWT claims GUC.
create or replace function auth.uid()
returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role()
returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

-- The roles PostgREST switches into. These role names are unchanged by the
-- publishable/secret API key naming — the keys resolve to these same roles.
-- `authenticated` is the one that matters:
-- it is NOT a superuser and does NOT have BYPASSRLS, so policies actually
-- apply to it — which is the whole point of the RLS test.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Test helpers (local only)
-- ---------------------------------------------------------------------------

create schema if not exists t;

create or replace function t.assert(cond boolean, msg text)
returns void language plpgsql as $$
begin
  if cond is not true then
    raise exception 'ASSERTION FAILED: %', msg;
  end if;
end;
$$;

/** Become a signed-in user, exactly as PostgREST does for a request. */
create or replace function t.login(user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

/** Drop back to the owner role so fixtures can be created. */
create or replace function t.logout()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

grant usage on schema t to anon, authenticated, service_role;
grant execute on all functions in schema t to anon, authenticated, service_role;
