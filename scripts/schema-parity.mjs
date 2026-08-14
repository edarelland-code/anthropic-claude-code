#!/usr/bin/env node
/**
 * ContextShelf — schema parity between the repository migrations and the
 * hosted project, without a Postgres connection.
 *
 *   node scripts/schema-parity.mjs
 *
 * `supabase db diff --linked` is the normal check and remains the preferred
 * one. It speaks the Postgres wire protocol directly, which some environments
 * cannot reach — the pooler ports are closed and the direct host is IPv6-only.
 * This is the fallback for exactly that case, and it is deliberately narrower
 * in what it claims.
 *
 * It reads the same catalogs from both sides and compares them:
 *
 *   - tables and their columns, types, nullability, and defaults
 *   - enum types and their ordered labels
 *   - RLS enablement and every policy's command, permissive flag, and
 *     USING / WITH CHECK expressions
 *   - indexes, by definition
 *   - constraints, by definition
 *   - triggers, by definition
 *   - functions, by identity and volatility, and whether they are SECURITY
 *     DEFINER
 *
 * Local side: a throwaway PostgreSQL cluster with the Supabase shim and the
 * real migration applied, the same harness `npm run test:db` uses.
 * Hosted side: the Management API, since HTTPS is reachable where 5432 is not.
 *
 * What this does NOT claim: it is a catalog comparison, not a byte-for-byte
 * DDL diff. It would not notice a difference invisible to these catalogs — a
 * comment, a storage parameter, a collation nuance. Anything it does report is
 * a real difference. Report it as "catalog parity", never as "db diff clean".
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REF = process.env.SUPABASE_PROJECT_REF ?? 'omhktzxwffaipmcoljic';
const TOKEN_PATH = process.env.SUPABASE_TOKEN_PATH ?? '/root/.supabase/access-token';

/* The catalog queries. Both sides run these verbatim. */
const PROBES = {
  columns: `
    select c.relname||'.'||a.attname as k,
           format_type(a.atttypid, a.atttypmod)||' null='||(not a.attnotnull)::text||
           ' def='||coalesce(pg_get_expr(d.adbin, d.adrelid), '-') as v
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
    where n.nspname = 'public' and c.relkind = 'r'`,
  enums: `
    select t.typname as k, string_agg(e.enumlabel, ',' order by e.enumsortorder) as v
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    join pg_enum e on e.enumtypid = t.oid
    where n.nspname = 'public'
    group by t.typname`,
  rls: `
    select c.relname as k, c.relrowsecurity::text as v
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'`,
  policies: `
    select tablename||'.'||policyname as k,
           cmd||' permissive='||permissive||' using='||coalesce(qual,'-')||
           ' check='||coalesce(with_check,'-') as v
    from pg_policies where schemaname = 'public'`,
  indexes: `
    select indexname as k, indexdef as v
    from pg_indexes where schemaname = 'public'`,
  constraints: `
    select conrelid::regclass::text||'.'||conname as k, pg_get_constraintdef(oid) as v
    from pg_constraint
    where connamespace = 'public'::regnamespace`,
  triggers: `
    select c.relname||'.'||t.tgname as k, pg_get_triggerdef(t.oid) as v
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and not t.tgisinternal`,
  // Extension-owned functions are excluded deliberately. The local shim
  // installs pgcrypto into `public`; hosted Supabase installs extensions into
  // a dedicated `extensions` schema. Comparing an extension's internals says
  // nothing about whether ContextShelf's own schema matches, and including
  // them reports 36 phantom differences.
  functions: `
    select p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as k,
           p.provolatile::text||' secdef='||p.prosecdef::text as v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
      )`,
};

/* ------------------------------------------------------------------ hosted */

const TOKEN = readFileSync(TOKEN_PATH, 'utf8').trim();

async function hosted(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`hosted query failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/* ------------------------------------------------------------------- local */

const PGBIN = process.env.PG_BIN ?? '/usr/lib/postgresql/16/bin';
// Postgres refuses to run as root, so as root every cluster command is
// re-executed as the `postgres` system user — the same accommodation
// scripts/db-test.sh makes.
const AS_PG = process.getuid?.() === 0;
const dir = mkdtempSync(join(tmpdir(), 'parity-'));
const DATA = join(dir, 'data');
const SOCK = join(dir, 'sock');

const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

/** Runs a shell command, as `postgres` when this process is root. */
function sh(command, { allowFailure = false } = {}) {
  const r = AS_PG
    ? spawnSync('su', ['postgres', '-c', command], { encoding: 'utf8' })
    : spawnSync('bash', ['-c', command], { encoding: 'utf8' });
  if (r.status !== 0 && !allowFailure) {
    throw new Error(`command failed: ${(r.stderr || r.stdout || '').slice(-600)}`);
  }
  return r;
}

function psql(sql, { file = false } = {}) {
  const base = `psql -h ${q(SOCK)} -U postgres -d postgres -v ON_ERROR_STOP=1 -t -A`;
  return sh(file ? `${base} -f ${q(sql)}` : `${base} -c ${q(sql)}`).stdout;
}

function buildLocal() {
  // The temp tree must be traversable and writable by `postgres`.
  spawnSync('bash', ['-c', `mkdir -p ${q(SOCK)} && chmod 711 ${q(dir)} && chown -R postgres ${q(dir)} 2>/dev/null || true`]);
  sh(`${q(join(PGBIN, 'initdb'))} -D ${q(DATA)} -U postgres -A trust --no-sync`);
  sh(`${q(join(PGBIN, 'pg_ctl'))} -D ${q(DATA)} -l ${q(join(dir, 'log'))} -w -o "-k ${SOCK} -h '' -c fsync=off" start`);
  psql(resolve(ROOT, 'supabase/tests/00_supabase_shim.sql'), { file: true });
  // Every migration, in order. Hardcoding 0001 made this script compare the
  // hosted database against a stale reference and report each new object as a
  // difference — a parity check that drifts is worse than none.
  const migrationsDir = resolve(ROOT, "supabase/migrations");
  const migrations = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  if (!migrations.length) throw new Error('no migrations found');
  for (const file of migrations) psql(join(migrationsDir, file), { file: true });
}
function localRows(sql) {
  const out = psql(`copy (${sql}) to stdout with (format csv)`);
  // Re-parse via a CSV read rather than splitting, so commas inside
  // expressions (which are everywhere in policy definitions) survive.
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < out.length; i += 1) {
    const ch = out[i];
    if (inQuotes) {
      if (ch === '"') {
        if (out[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length >= 2).map((r) => ({ k: r[0], v: r.slice(1).join(',') }));
}

/* ------------------------------------------------------------------ compare */

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function compare(name, localRows_, hostedRows_) {
  const L = new Map(localRows_.map((r) => [r.k, norm(r.v)]));
  const H = new Map(hostedRows_.map((r) => [r.k, norm(r.v)]));
  const missing = [...L.keys()].filter((k) => !H.has(k));
  const extra = [...H.keys()].filter((k) => !L.has(k));
  const differing = [...L.keys()].filter((k) => H.has(k) && H.get(k) !== L.get(k))
    .map((k) => ({ k, local: L.get(k), hosted: H.get(k) }));
  return { name, count: L.size, hostedCount: H.size, missing, extra, differing };
}

let exitCode = 0;
try {
  console.log('\x1b[1mSchema parity — repository migrations vs hosted project\x1b[0m');
  console.log(`\x1b[2mproject ${REF}\x1b[0m\n`);
  process.stdout.write('  building local reference cluster … ');
  buildLocal();
  console.log('done');

  const report = [];
  for (const [name, sql] of Object.entries(PROBES)) {
    const [l, h] = [localRows(sql), await hosted(sql)];
    report.push(compare(name, l, h.map((r) => ({ k: r.k, v: r.v }))));
  }

  console.log();
  let problems = 0;
  for (const r of report) {
    const bad = r.missing.length + r.extra.length + r.differing.length;
    problems += bad;
    const mark = bad === 0 ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    console.log(`  ${mark}  ${r.name.padEnd(13)} local ${String(r.count).padStart(4)}  hosted ${String(r.hostedCount).padStart(4)}`);
    for (const k of r.missing.slice(0, 12)) console.log(`         \x1b[31mmissing on hosted:\x1b[0m ${k}`);
    for (const k of r.extra.slice(0, 12)) console.log(`         \x1b[33monly on hosted:\x1b[0m ${k}`);
    for (const d of r.differing.slice(0, 12)) {
      console.log(`         \x1b[31mdiffers:\x1b[0m ${d.k}\n           local  ${d.local.slice(0, 160)}\n           hosted ${d.hosted.slice(0, 160)}`);
    }
  }

  console.log();
  if (problems === 0) {
    console.log('\x1b[32mCatalog parity holds: the hosted schema matches the repository migrations.\x1b[0m');
    console.log('\x1b[2mCatalog comparison, not a byte-for-byte db diff — see the header of this file.\x1b[0m');
  } else {
    console.log(`\x1b[31m${problems} difference(s) found.\x1b[0m`);
    exitCode = 1;
  }
} catch (e) {
  console.error(`\x1b[31mparity check failed:\x1b[0m ${e.message}`);
  exitCode = 1;
} finally {
  spawnSync(join(PGBIN, 'pg_ctl'), ['-D', DATA, '-m', 'immediate', 'stop'], { stdio: 'ignore' });
  rmSync(dir, { recursive: true, force: true });
}

process.exit(exitCode);
