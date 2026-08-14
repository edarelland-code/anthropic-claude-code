#!/usr/bin/env node
/**
 * Runs the hosted SQL suites over the Management API.
 *
 * `supabase db query --linked` is the preferred path and remains so. It needs
 * the Postgres wire protocol, which some environments do not permit (AD-15) —
 * and when it is unreachable, "the hosted database is correct" quietly stops
 * being checkable and starts being assumed. This runner keeps it checkable:
 * the same two files, the same assertions, over HTTPS.
 *
 *   node scripts/verify-hosted.mjs                    # both suites
 *   node scripts/verify-hosted.mjs supabase/tests/hosted/01_verify_schema.sql
 *
 * It writes nothing. 01 only reads catalogs; 02 opens a transaction, exercises
 * the policies as two throwaway users, and rolls back.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN_PATH = process.env.SUPABASE_TOKEN_PATH ?? '/root/.supabase/access-token';

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function accessToken() {
  const fromEnv = process.env.SUPABASE_ACCESS_TOKEN;
  if (fromEnv) return fromEnv.trim();
  return readFileSync(TOKEN_PATH, 'utf8').trim();
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

const SUITES = [
  'supabase/tests/hosted/01_verify_schema.sql',
  'supabase/tests/hosted/02_rls_isolation.sql',
];

const files = process.argv.slice(2).length > 0 ? process.argv.slice(2) : SUITES;
let failed = 0;

for (const file of files) {
  console.log(`\n${bold(file)}`);
  const sql = readFileSync(resolve(ROOT, file), 'utf8');

  let rows;
  try {
    rows = await query(sql);
  } catch (cause) {
    // A raised exception IS the failure signal in 02 — the suite asserts by
    // raising, so the driver message is the finding rather than noise.
    console.log(`  ${red('FAIL')}  ${cause.message}`);
    failed += 1;
    continue;
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    console.log(`  ${red('FAIL')}  the suite returned no rows`);
    failed += 1;
    continue;
  }

  for (const row of rows) {
    const verdict = row.verdict ?? (String(row.result ?? '').includes('PASSED') ? 'PASS' : null);
    const label = row.check_name ?? row.result ?? JSON.stringify(row);
    const detail = row.check_name ? String(row.result ?? '') : '';
    if (verdict === 'PASS') {
      console.log(`  ${green('PASS')}  ${label}${detail ? ` ${dim(`— ${detail}`)}` : ''}`);
    } else {
      console.log(`  ${red('FAIL')}  ${label} — ${verdict ?? 'no verdict'} ${detail}`);
      failed += 1;
    }
  }
}

console.log(
  failed === 0
    ? `\n${green('All hosted SQL checks passed.')}`
    : `\n${red(`${failed} hosted SQL check(s) failed.`)}`,
);
process.exit(failed === 0 ? 0 : 1);
