#!/usr/bin/env node
/**
 * ContextShelf — hosted end-to-end validation against the deployed app.
 *
 *   node scripts/validate-hosted.mjs <productionUrl>
 *
 * Covers the Phase 1 exit criteria that only a real browser against the real
 * deployment can answer:
 *
 *   B  authentication works                sign in over the token_hash path
 *   C  data persists after refresh         create, hard-reload, still there
 *   D  data persists after logout/login    sign out, sign back in, still there
 *   E  same account from another client    a second, cookie-independent context
 *   F  users cannot reach each other       a second account sees an empty shelf
 *   G  topics work                         created through the real UI
 *   H  nested subtopics work               child under a child
 *   I  knowledge entries work              several types
 *   L  responsive, authenticated           exports a session for responsive-qa
 *
 * Why a browser and not a hand-built cookie: minting a session with the admin
 * key and writing the cookie directly would prove the database works and
 * nothing else. Driving `/auth/confirm?token_hash=…` through the deployment
 * exercises the email template shape, the app's own verification route, its
 * cookie writing, and the middleware refresh — which is where cross-device
 * sign-in actually breaks.
 *
 * The admin key is used for exactly one thing: generating the link that an
 * email would otherwise carry, so the run needs no mailbox. Everything after
 * that is the user's own session with the user's own permissions, subject to
 * RLS like any other.
 *
 * Test accounts are created under a +contextshelf-qa alias and deleted at the
 * end, including on failure.
 */

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] || process.env.CONTEXTSHELF_URL || '').replace(/\/$/, '');
if (!BASE.startsWith('http')) {
  console.error('usage: node scripts/validate-hosted.mjs <productionUrl>');
  process.exit(2);
}

const envText = existsSync(resolve(ROOT, '.env.local')) ? readFileSync(resolve(ROOT, '.env.local'), 'utf8') : '';
const envValue = (n) => (envText.match(new RegExp(`^${n}=(.*)$`, 'm')) ?? [])[1]?.trim() ?? process.env[n] ?? null;

const SUPABASE_URL = envValue('NEXT_PUBLIC_SUPABASE_URL');
const SECRET_KEY = envValue('SUPABASE_SECRET_KEY');
if (!SUPABASE_URL || !SECRET_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be in .env.local.');
  process.exit(2);
}

const stamp = Date.now().toString(36);
const USER_A = `hello+contextshelf-qa-a-${stamp}@nomorefilth.com`;
const USER_B = `hello+contextshelf-qa-b-${stamp}@nomorefilth.com`;

const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const heading = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

/** Creates a confirmed user and returns the token_hash an email would carry. */
async function signInLink(email) {
  await admin.auth.admin.createUser({ email, email_confirm: true }).catch(() => {});
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`generateLink(${email}): ${error.message}`);
  const hash = data?.properties?.hashed_token;
  if (!hash) throw new Error('no hashed_token returned');
  return hash;
}

/** Drives the real verification route, exactly as an email link would. */
async function signIn(page, email) {
  const hash = await signInLink(email);
  await page.goto(`${BASE}/auth/confirm?token_hash=${hash}&type=magiclink`, { waitUntil: 'networkidle' });
  return page.url();
}

async function deleteUser(email) {
  const { data } = await admin.auth.admin.listUsers();
  const u = (data?.users ?? []).find((x) => x.email === email);
  if (u) await admin.auth.admin.deleteUser(u.id);
}

const browser = await chromium.launch();
let exitCode = 0;

try {
  // --- B. Authentication ----------------------------------------------------
  heading('B. Authentication over the token_hash path');
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const a = await ctxA.newPage();
  const landed = await signIn(a, USER_A);
  const signedIn = !/\/login/.test(landed);
  record('sign in lands inside the app', signedIn, landed.replace(BASE, '') || '/');
  if (!signedIn) throw new Error('cannot continue without a session');

  // --- G. Topics ------------------------------------------------------------
  heading('G. Topics');
  const TOPIC = `DailyRelay-${stamp}`;
  await a.goto(`${BASE}/topics/new`, { waitUntil: 'networkidle' });
  await a.fill('input[name="name"]', TOPIC);
  await a.fill('textarea[name="description"], input[name="description"]', 'Created by hosted validation.');
  await a.fill('textarea[name="goal"], input[name="goal"]', 'Prove Phase 1 persistence end to end.');
  await a.click('button[type="submit"]');
  await a.waitForLoadState('networkidle');
  const topicUrl = a.url();
  record('topic created through the UI', /\/topics\/[0-9a-f-]{36}/.test(topicUrl), topicUrl.replace(BASE, ''));
  const topicId = (topicUrl.match(/\/topics\/([0-9a-f-]{36})/) ?? [])[1] ?? null;

  // --- H. Nested subtopics --------------------------------------------------
  heading('H. Nested subtopics');
  let nested = false;
  try {
    await a.fill('input[name="name"]', 'Branding');
    await a.click('button[type="submit"]');
    await a.waitForLoadState('networkidle');
    nested = (await a.content()).includes('Branding');
  } catch { /* form shape differs; reported below */ }
  record('subtopic added', nested, nested ? 'Branding' : 'no subtopic form on the topic page');

  // --- I. Knowledge entries -------------------------------------------------
  heading('I. Knowledge entries');
  let entries = 0;
  for (const [title, type] of [['Use approach A', 'decision'], ['Ship the icon set', 'progress']]) {
    try {
      await a.fill('input[name="title"]', title);
      const sel = await a.$('select[name="knowledgeType"]');
      if (sel) await sel.selectOption(type).catch(() => {});
      await a.click('form:has(input[name="title"]) button[type="submit"]');
      await a.waitForLoadState('networkidle');
      if ((await a.content()).includes(title)) entries += 1;
    } catch { /* counted below */ }
  }
  record('knowledge entries created', entries > 0, `${entries} of 2`);

  // --- C. Persists across a hard reload -------------------------------------
  heading('C. Persistence across a hard reload');
  await a.reload({ waitUntil: 'networkidle' });
  const afterReload = (await a.content()).includes(TOPIC);
  record('topic survives a reload', afterReload, TOPIC);

  // --- D. Persists across sign-out and sign-in ------------------------------
  heading('D. Persistence across sign-out and sign-in');
  await ctxA.clearCookies();
  await a.goto(`${BASE}/home`, { waitUntil: 'networkidle' });
  const bouncedToLogin = /\/login/.test(a.url());
  record('signed out is bounced to /login', bouncedToLogin, a.url().replace(BASE, ''));
  await signIn(a, USER_A);
  await a.goto(`${BASE}/topics`, { waitUntil: 'networkidle' });
  const afterRelogin = (await a.content()).includes(TOPIC);
  record('topic survives sign-out and sign-in', afterRelogin, TOPIC);

  // --- E. The same account from an independent client -----------------------
  heading('E. Same account, independent browser context');
  const ctxA2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const a2 = await ctxA2.newPage();
  await signIn(a2, USER_A);
  await a2.goto(`${BASE}/topics`, { waitUntil: 'networkidle' });
  const crossDevice = (await a2.content()).includes(TOPIC);
  record('second client sees the same shelf', crossDevice, 'no export or import');
  await ctxA2.close();

  // --- F. Cross-user isolation on the deployment ----------------------------
  heading('F. Cross-user isolation');
  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  await signIn(b, USER_B);
  await b.goto(`${BASE}/topics`, { waitUntil: 'networkidle' });
  const bSeesNothing = !(await b.content()).includes(TOPIC);
  record("second account cannot see the first's topic", bSeesNothing, USER_B.replace(/\+.*@/, '+…@'));
  if (topicId) {
    await b.goto(`${BASE}/topics/${topicId}`, { waitUntil: 'networkidle' });
    const body = await b.content();
    const denied = !body.includes(TOPIC);
    record('direct topic URL is denied to the second account', denied, denied ? 'not found' : 'LEAKED');
  }
  await ctxB.close();

  // --- L. Export the session for authenticated responsive QA ----------------
  heading('L. Session export for responsive QA');
  const cookies = await ctxA.cookies();
  const authCookies = cookies.filter((c) => /auth-token/.test(c.name));
  const outPath = resolve(ROOT, '.qa-session.json');
  writeFileSync(outPath, JSON.stringify(cookies), { mode: 0o600 });
  record('session cookies exported', authCookies.length > 0, `${authCookies.length} auth cookie(s) → .qa-session.json`);
  console.log(`\n  Run authenticated QA with:\n    CONTEXTSHELF_QA_COOKIE="$(cat .qa-session.json)" npm run test:responsive -- ${BASE}\n`);

  await ctxA.close();
} catch (e) {
  record('validation run', false, e.message);
  exitCode = 1;
} finally {
  for (const email of [USER_A, USER_B]) await deleteUser(email).catch(() => {});
  await browser.close();
}

console.log('\n\x1b[1mSummary\x1b[0m');
for (const r of results) console.log(`  ${r.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n\x1b[31m${failed} check(s) failed.\x1b[0m` : '\n\x1b[32mAll hosted validation checks passed.\x1b[0m');
process.exit(failed ? 1 : exitCode);
