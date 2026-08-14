#!/usr/bin/env node
/**
 * ContextShelf — apply supabase/migrations/ to the hosted project over HTTPS.
 *
 *   npm run db:push:hosted            apply anything not yet recorded
 *   npm run db:push:hosted -- --dry   list what would be applied
 *
 * Why this exists (AD-15): `supabase db push` needs the Postgres wire protocol
 * on :5432 or :6543, and some environments permit HTTPS but not those ports —
 * the pooler times out and the direct host is IPv6-only. The Management API's
 * query endpoint reaches the same database over 443, so "the migration is
 * applied" stays checkable rather than assumed. `db push` is still preferred
 * wherever it works, and this script keeps the SAME ledger it does, so the two
 * never disagree about what has run.
 *
 * Phase 2 applied 0002 by hand with curl. That worked once and left nothing
 * behind; this does the same job repeatably, records it, and refuses to guess.
 *
 * Deliberately NOT idempotent by re-running everything: a migration already in
 * supabase_migrations.schema_migrations is skipped. The migrations themselves
 * are written to be re-runnable (IF NOT EXISTS / CREATE OR REPLACE), but
 * skipping is what makes the ledger meaningful.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN_PATH = process.env.SUPABASE_TOKEN_PATH ?? '/root/.supabase/access-token';
const DRY = process.argv.includes('--dry');

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function accessToken() {
  const fromEnv = process.env.SUPABASE_ACCESS_TOKEN;
  if (fromEnv) return fromEnv.trim();
  try {
    return readFileSync(TOKEN_PATH, 'utf8').trim();
  } catch {
    throw new Error(
      `No Supabase access token. Set SUPABASE_ACCESS_TOKEN, or sign in with \`supabase login\` so a token lands at ${TOKEN_PATH}.`,
    );
  }
}

function projectRef() {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF.trim();
  const env = readFileSync(join(ROOT, '.env.local'), 'utf8');
  const url = /^NEXT_PUBLIC_SUPABASE_URL=(.+)$/m.exec(env)?.[1]?.trim();
  const ref = url && /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url)?.[1];
  if (!ref) throw new Error('Could not read the project ref from .env.local.');
  return ref;
}

const TOKEN = accessToken();
const REF = projectRef();

/**
 * One statement batch against the hosted database.
 *
 * The endpoint returns the driver's own message on failure, which is exactly
 * what a person debugging a migration needs — so it is surfaced verbatim rather
 * than replaced with something friendlier and less useful.
 */
async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.message ?? parsed.error ?? text;
    } catch {
      /* keep the raw body */
    }
    throw new Error(detail);
  }
  return text ? JSON.parse(text) : [];
}

async function applied() {
  await query(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text
    );
  `);
  const rows = await query(
    'select version from supabase_migrations.schema_migrations order by version',
  );
  return new Set(rows.map((r) => r.version));
}

async function main() {
  const dir = resolve(ROOT, 'supabase/migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const done = await applied();
  const pending = files.filter((f) => !done.has(f.split('_')[0]));

  console.log(`\x1b[1mHosted migrations — ${REF}\x1b[0m`);
  console.log(dim(`  ${done.size} already applied, ${pending.length} pending\n`));

  if (pending.length === 0) {
    console.log(green('Nothing to apply. The hosted project is up to date.'));
    return;
  }

  if (DRY) {
    for (const file of pending) console.log(`  would apply ${file}`);
    console.log(dim('\nDry run. Nothing was applied.'));
    return;
  }

  for (const file of pending) {
    const [version, ...rest] = file.replace(/\.sql$/, '').split('_');
    const name = rest.join('_');

    process.stdout.write(`  ${file} … `);
    const sql = readFileSync(join(dir, file), 'utf8');
    try {
      // Each FILE is its own request, and therefore its own transaction. That
      // is load-bearing rather than incidental: PostgreSQL refuses to USE an
      // enum value in the transaction that added it, which is exactly why
      // 0003 carries the enum values and 0004 the view that casts them.
      await query(sql);
      await query(
        `insert into supabase_migrations.schema_migrations (version, name)
         values ('${version}', '${name.replace(/'/g, "''")}')
         on conflict (version) do nothing`,
      );
      console.log(green('applied'));
    } catch (e) {
      console.log(red('FAILED'));
      console.error(`\n${red(e.message)}\n`);
      console.error(dim('Nothing was recorded for this migration, so it will be retried.'));
      process.exitCode = 1;
      return;
    }
  }

  console.log(`\n${green('All pending migrations applied.')}`);
  console.log(dim('Verify with: npm run schema:parity'));
}

main().catch((e) => {
  console.error(red(e.message));
  process.exitCode = 1;
});
