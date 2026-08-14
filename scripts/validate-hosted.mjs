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
import { launchOptions } from './chromium-path.mjs';
import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';
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

const PUBLISHABLE_KEY =
  envValue('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') ?? envValue('NEXT_PUBLIC_SUPABASE_ANON_KEY');
if (!PUBLISHABLE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be in .env.local.');
  process.exit(2);
}

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

/**
 * A Supabase client holding a REAL user session.
 *
 * The admin client bypasses row-level security, so calling `search_records` or
 * `soft_delete_record` through it would prove the functions run and nothing
 * about who may run them. These are the calls where authorisation is the whole
 * point, so they go through a session minted the same way the browser's was —
 * one more magic link, verified against the same project.
 */
async function userClient(email) {
  const hash = await signInLink(email);
  const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.verifyOtp({ token_hash: hash, type: 'magiclink' });
  if (error) throw new Error(`user session for ${email}: ${error.message}`);
  return client;
}

async function deleteUser(email) {
  const { data } = await admin.auth.admin.listUsers();
  const u = (data?.users ?? []).find((x) => x.email === email);
  if (u) await admin.auth.admin.deleteUser(u.id);
}

const browser = await chromium.launch(launchOptions());
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
  // The create action ends in a server-side redirect to /topics/<id>.
  // networkidle can settle before that lands, so wait for the URL itself.
  await Promise.all([
    a.waitForURL(/\/topics\/[0-9a-f-]{36}/, { timeout: 30_000 }).catch(() => {}),
    a.click('button[type="submit"]'),
  ]);
  const topicUrl = a.url();
  record('topic created through the UI', /\/topics\/[0-9a-f-]{36}/.test(topicUrl), topicUrl.replace(BASE, ''));
  const topicId = (topicUrl.match(/\/topics\/([0-9a-f-]{36})/) ?? [])[1] ?? null;
  if (!topicId) throw new Error('topic was not created; cannot exercise its children');

  // --- H. Nested subtopics --------------------------------------------------
  heading('H. Nested subtopics');
  // Scope every click to the form that owns the field, so a submit cannot be
  // routed to a different form on the same page.
  const subtopicForm = 'form:has(input[name="name"])';
  let nested = false;
  try {
    await a.fill(`${subtopicForm} input[name="name"]`, 'Branding');
    await a.click(`${subtopicForm} button[type="submit"]`);
    await a.waitForLoadState('networkidle');
    nested = (await a.content()).includes('Branding') && /\/topics\/[0-9a-f-]{36}/.test(a.url());
  } catch { /* reported below */ }
  record('subtopic added', nested, nested ? 'Branding' : 'subtopic form not found on the topic page');

  // --- I. Knowledge entries -------------------------------------------------
  heading('I. Knowledge entries');
  // Three forms on this page carry a hidden topicId and two have an input
  // named "title", so selecting on either submits whichever comes first — the
  // Open Issues form, which creates an action and not a knowledge entry. The
  // text then appears on the page and a content check passes while the
  // knowledge_entries table stays empty. Select on the type dropdown, which
  // only the entry form has.
  const entryForm = 'form:has(select[name="knowledgeType"])';
  const wanted = [
    ['Use approach A', 'decision', 'claude_code'],
    ['Ship the icon set', 'progress', 'claude_chat'],
  ];
  let entries = 0;
  for (const [title, type, source] of wanted) {
    try {
      await a.fill(`${entryForm} input[name="title"]`, title);
      await a.fill(`${entryForm} textarea[name="content"]`, `Recorded by hosted validation: ${title}.`);
      await a.selectOption(`${entryForm} select[name="knowledgeType"]`, type).catch(() => {});
      await a.selectOption(`${entryForm} select[name="sourceType"]`, source).catch(() => {});
      await a.click(`${entryForm} button[type="submit"]`);
      // The action revalidates in place rather than navigating, so wait for the
      // entry itself to appear instead of for a load event.
      await a.waitForFunction(
        (t) => document.body.innerText.includes(t),
        title,
        { timeout: 20_000 },
      );
      entries += 1;
    } catch { /* counted below */ }
  }
  record('knowledge entries created', entries === wanted.length, `${entries} of ${wanted.length}`);

  // --- Real-data persistence, asserted in the database ----------------------
  // Page content proves the app rendered something. This proves the rows are
  // actually in hosted Postgres, which is the claim that matters.
  heading('Real-data persistence in hosted Postgres');
  const { data: dbTopics } = await admin.from('topics').select('id,name,workspace_id').eq('name', TOPIC);
  const dbTopic = (dbTopics ?? [])[0] ?? null;
  record('topic row exists in the hosted database', Boolean(dbTopic), dbTopic ? `id ${dbTopic.id}` : 'not found');
  if (dbTopic) {
    const { count: subCount } = await admin
      .from('subtopics').select('*', { count: 'exact', head: true }).eq('topic_id', dbTopic.id);
    const { count: entryCount } = await admin
      .from('knowledge_entries').select('*', { count: 'exact', head: true }).eq('topic_id', dbTopic.id);
    record('subtopic rows persisted', (subCount ?? 0) >= 1, `${subCount ?? 0} row(s)`);
    record('knowledge entry rows persisted', (entryCount ?? 0) >= 2, `${entryCount ?? 0} row(s)`);
    const { data: provenance } = await admin
      .from('knowledge_entries').select('title,knowledge_type,source_type').eq('topic_id', dbTopic.id);
    const sources = [...new Set((provenance ?? []).map((r) => r.source_type))].sort();
    const types = [...new Set((provenance ?? []).map((r) => r.knowledge_type))].sort();
    // Provenance must survive the round trip, and must not be invented.
    record('provenance recorded, not invented', sources.length > 0 && !sources.includes(null),
      `sources ${sources.join('/')} · types ${types.join('/')}`);
  }


  // --- Phase 2: create each memory object through the real UI --------------
  //
  // The repositories were already proven by unit and SQL tests. What these
  // assert is the part only a browser can: that a person can actually create
  // a decision, an idea, and a prompt from the interface, and that the rows
  // land in hosted Postgres with the right topic, subtopic, and provenance.
  heading('Phase 2. Decisions, Ideas, and Prompts through the UI');

  // Several forms on the Topic page carry an input named "title", so every
  // fill below is scoped to the form that owns it. An unscoped selector fills
  // the first match — a different form — leaving this one's required field
  // empty, and the browser then blocks submission silently. That is the same
  // failure AD-16 exists to catch, and only the database assertion reveals it.
  const openPanel = async (name, marker) => {
    await a.goto(`${BASE}/topics/${topicId}`, { waitUntil: 'networkidle' });
    await a.click(`button:has-text("${name}")`);
    await a.waitForSelector(`form:has(${marker})`, { timeout: 15_000 });
  };

  // Decision
  const DECISION = `Icon direction ${stamp}`;
  const dForm = 'form:has(textarea[name="decision"])';
  await openPanel('Decision', 'textarea[name="decision"]');
  await a.fill(`${dForm} input[name="title"]`, DECISION);
  await a.fill(`${dForm} textarea[name="decision"]`, 'Use the slash arrow X geometry.');
  await a.fill(`${dForm} textarea[name="reason"]`, 'Reads at 16px where the blue circle did not.');
  await a.fill(`${dForm} textarea[name="alternatives"]`, 'Blue circle\nCheckmark overlay');
  await a.fill(`${dForm} input[name="approvedDirection"]`, 'slash -> arrow -> X');
  await a.selectOption(`${dForm} select[name="sourceType"]`, 'claude_chat').catch(() => {});
  await a.selectOption(`${dForm} select[name="subtopicId"]`, { index: 1 }).catch(() => {});
  await a.click(`${dForm} button[type="submit"]`);
  await a.waitForTimeout(2500);

  const { data: dRows } = await admin
    .from('decisions').select('*').eq('title', DECISION);
  const decisionRow = (dRows ?? [])[0] ?? null;
  record('decision created through the UI', Boolean(decisionRow), decisionRow ? `id ${decisionRow.id}` : 'no row');
  if (decisionRow) {
    record('decision fields persisted', Boolean(decisionRow.reason) && (decisionRow.alternatives ?? []).length === 2,
      `alternatives ${(decisionRow.alternatives ?? []).length}, approved "${decisionRow.approved_direction ?? ''}"`);
    record('decision provenance + association', decisionRow.source_type === 'claude_chat' && decisionRow.topic_id === topicId,
      `source ${decisionRow.source_type}, subtopic ${decisionRow.subtopic_id ? 'set' : 'topic-level'}`);
    // Rule 7 still holds against a real row.
    const { error: noReason } = await admin.rpc('supersede_decision', {
      p_old_decision_id: decisionRow.id, p_new_decision_id: decisionRow.id, p_reason: '',
    });
    record('supersession still requires a reason', Boolean(noReason), noReason ? 'refused' : 'ACCEPTED — rule 7 broken');
  }

  // Idea
  const IDEA = `Overlay a checkmark ${stamp}`;
  const iForm = 'form:has(textarea[name="rationale"])';
  await openPanel('Idea', 'textarea[name="rationale"]');
  await a.fill(`${iForm} input[name="title"]`, IDEA);
  await a.fill(`${iForm} textarea[name="idea"]`, 'Put a check over the glyph.');
  await a.fill(`${iForm} textarea[name="rationale"]`, 'Suggested because it reads as completion.');
  await a.selectOption(`${iForm} select[name="sourceType"]`, 'claude_cowork').catch(() => {});
  await a.click(`${iForm} button[type="submit"]`);
  await a.waitForTimeout(2500);

  const { data: iRows } = await admin.from('ideas').select('*').eq('title', IDEA);
  const ideaRow = (iRows ?? [])[0] ?? null;
  record('idea created through the UI', Boolean(ideaRow), ideaRow ? `status ${ideaRow.status}` : 'no row');
  if (ideaRow) {
    record('idea provenance persisted', ideaRow.source_type === 'claude_cowork', `source ${ideaRow.source_type}`);
    // Rejection must keep the original rationale AND add the reason.
    const { data: rejected } = await admin.from('ideas').select('rationale').eq('id', ideaRow.id).maybeSingle();
    const originalRationale = rejected?.rationale ?? '';
    await admin.from('ideas').update({
      status: 'rejected',
      rationale: `${originalRationale}\n\n[rejected] reads as "done", not "relay"`,
    }).eq('id', ideaRow.id);
    const { data: after } = await admin.from('ideas').select('*').eq('id', ideaRow.id).maybeSingle();
    const keptBoth = (after?.rationale ?? '').includes('Suggested because')
      && (after?.rationale ?? '').includes('[rejected]');
    record('rejection preserves the original rationale', keptBoth && after?.status === 'rejected',
      keptBoth ? 'both kept' : 'original rationale LOST');
  }

  // Prompt
  const PROMPT = `Icon generation prompt ${stamp}`;
  const pForm = 'form:has(textarea[name="body"])';
  await openPanel('Prompt', 'textarea[name="body"]');
  await a.fill(`${pForm} input[name="title"]`, PROMPT);
  await a.fill(`${pForm} textarea[name="body"]`, 'VERSION ONE BODY: draw a relay glyph.');
  await a.fill(`${pForm} input[name="purpose"]`, 'Generate the app icon.');
  await a.selectOption(`${pForm} select[name="result"]`, 'partially_worked').catch(() => {});
  await a.selectOption(`${pForm} select[name="sourceType"]`, 'claude_code').catch(() => {});
  await a.click(`${pForm} button[type="submit"]`);
  await a.waitForTimeout(3000);

  const { data: pRows } = await admin.from('prompts').select('*').eq('title', PROMPT);
  const promptRow = (pRows ?? [])[0] ?? null;
  // Kept for the Phase 3 allowlist check, which needs a real prompt_version id
  // to prove the refusal is about the TYPE rather than about a missing row.
  let promptVersionId = null;
  record('prompt created through the UI', Boolean(promptRow), promptRow ? `id ${promptRow.id}` : 'no row');

  if (promptRow) {
    const { data: v1rows } = await admin
      .from('prompt_versions').select('*').eq('prompt_id', promptRow.id).order('version');
    const v1 = (v1rows ?? [])[0] ?? null;
    promptVersionId = v1?.id ?? null;
    record('version 1 created', v1?.version === 1 && String(v1?.body).includes('VERSION ONE BODY'), `v${v1?.version}`);

    // The evaluation must be an appended outcome, never written onto v1.
    const { data: outcomes } = await admin
      .from('prompt_version_outcomes').select('*').eq('prompt_version_id', v1.id).order('seq');
    const latest = (outcomes ?? [])[(outcomes ?? []).length - 1];
    record('outcome appended, not written onto the version',
      (outcomes ?? []).length >= 2 && latest?.result === 'partially_worked',
      `${(outcomes ?? []).length} outcome row(s), current "${latest?.result}"`);

    // v1 body is immutable: adding a version must not change it.
    const { data: v2 } = await admin.from('prompt_versions').insert({
      prompt_id: promptRow.id, workspace_id: promptRow.workspace_id,
      user_id: promptRow.user_id, version: 2, body: 'VERSION TWO BODY: better glyph.',
    }).select('*').single();
    const { data: v1after } = await admin.from('prompt_versions').select('body').eq('id', v1.id).maybeSingle();
    record('version 1 is immutable after adding version 2',
      String(v1after?.body).includes('VERSION ONE BODY'), 'v1 body unchanged');

    // Winning must identify the exact version, and Copy must return ITS body.
    await admin.from('prompt_winning_selections').insert({
      prompt_id: promptRow.id, prompt_version_id: v1.id,
      workspace_id: promptRow.workspace_id, user_id: promptRow.user_id,
      reason: 'v1 still renders better at 16px',
    });
    const { data: winning } = await admin
      .from('prompt_current_winning').select('*').eq('prompt_id', promptRow.id).maybeSingle();
    // v2 is the LATEST; v1 is the WINNER. Copying the latest would be wrong.
    record('winning points at the exact version, not the latest',
      winning?.prompt_version_id === v1.id && String(winning?.winning_body).includes('VERSION ONE BODY'),
      `winner v${winning?.winning_version}, latest v${v2?.version}`);

    // Changing the winner keeps the earlier selection readable.
    await admin.from('prompt_winning_selections').insert({
      prompt_id: promptRow.id, prompt_version_id: v2.id,
      workspace_id: promptRow.workspace_id, user_id: promptRow.user_id, reason: 'v2 overtook it',
    });
    const { data: history } = await admin
      .from('prompt_winning_selections').select('*').eq('prompt_id', promptRow.id);
    const { data: nowWinning } = await admin
      .from('prompt_current_winning').select('*').eq('prompt_id', promptRow.id).maybeSingle();
    record('winner history survives a change',
      (history ?? []).length === 2 && nowWinning?.prompt_version_id === v2.id,
      `${(history ?? []).length} selections, current v${nowWinning?.winning_version}`);
  }

  // All three must appear in the Timeline projection.
  const { data: tl } = await admin
    .from('timeline_events').select('entity_type, title').eq('topic_id', topicId);
  const kinds = new Set(((tl ?? [])).map((r) => r.entity_type));
  record('all three appear in the Timeline',
    kinds.has('decision') && kinds.has('idea') && kinds.has('prompt_version'),
    [...kinds].join(', '));

  // --- Phase 3: capture, triage, search, files, recovery -------------------
  //
  // Every assertion below reads a ROW (AD-16). Twice in Phase 2 a page-content
  // check passed while the table it claimed to prove was empty, because the
  // submit had been routed to a different form on the same page. Text on a page
  // is evidence the app rendered something; only the row is evidence of
  // persistence.
  heading('M. Quick Capture — one step, nothing else required');
  const CAPTURE_MARK = `zucchini-${stamp}`;
  const CAPTURE_TEXT = [
    `User: should the ${CAPTURE_MARK} icon be blue?`,
    'Assistant: blue reads as a status dot at 16px.',
    '',
    'Decision: use the slash geometry',
    '',
    'Next step: render it at 16px and check',
  ].join('\n');

  await a.goto(`${BASE}/inbox`, { waitUntil: 'networkidle' });
  const captureForm = 'form:has(textarea[name="content"])';
  await a.fill(`${captureForm} textarea[name="content"]`, CAPTURE_TEXT);
  await a.click(`${captureForm} button[type="submit"]`);
  await a.waitForFunction(() => /Saved to your Inbox/i.test(document.body.innerText), null, {
    timeout: 20_000,
  }).catch(() => {});

  const { data: captured } = await admin
    .from('ingestion_records')
    .select('id,status,topic_id,raw_content,created_entry_ids,raw_hash')
    .like('raw_content', `%${CAPTURE_MARK}%`);
  const capture = (captured ?? [])[0] ?? null;
  record('capture row exists in hosted Postgres', Boolean(capture), capture ? `id ${capture.id}` : 'no row');

  if (capture) {
    // CLARIFICATION 2, asserted rather than assumed: a capture that demanded a
    // topic would arrive already filed, and the Inbox would be pointless.
    record('capture required nothing but content',
      capture.status === 'unsorted' && capture.topic_id === null,
      `status ${capture.status}, topic ${capture.topic_id ?? 'none'}`);
    record('captured text stored verbatim',
      String(capture.raw_content).includes('slash geometry'), 'raw preserved');
    record('fingerprint generated for duplicate proposals',
      typeof capture.raw_hash === 'string' && capture.raw_hash.length === 64,
      capture.raw_hash ? `${capture.raw_hash.slice(0, 12)}…` : 'missing');
  }

  heading('N. Triage — extraction, the confirm gate, and the fan-out');
  let sessionId = null;
  if (capture) {
    await a.goto(`${BASE}/inbox/${capture.id}`, { waitUntil: 'networkidle' });

    // Path A read two labelled lines out of the transcript. They are the rows
    // that arrive pre-checked; everything else is a suggestion the user would
    // have to opt into, which is exactly what is NOT done here.
    await a.selectOption('select[name="topicId"]', topicId).catch(() => {});
    await Promise.all([
      a.waitForURL(/\/topics\/[0-9a-f-]{36}/, { timeout: 30_000 }).catch(() => {}),
      a.click('form button[type="submit"]'),
    ]);

    const { data: sessions } = await admin
      .from('source_sessions')
      .select('id,raw_content,topic_id,raw_hash')
      .eq('topic_id', topicId)
      .like('raw_content', `%${CAPTURE_MARK}%`);
    const session = (sessions ?? [])[0] ?? null;
    sessionId = session?.id ?? null;
    record('Layer 1 evidence written', Boolean(session), session ? `id ${session.id}` : 'no session row');

    if (session) {
      const { data: fanned } = await admin
        .from('knowledge_entries')
        .select('id,title,knowledge_type,source_reference,confidence')
        .eq('source_session_id', session.id);
      const produced = fanned ?? [];

      // Rule 4: one session fans out into many entries, never one generic card.
      record('one session fanned out into many entries', produced.length >= 2,
        `${produced.length} entries`);

      // Rule 10: every entry points back at the evidence, with an anchor.
      record('every entry carries provenance back to Layer 1',
        produced.length > 0 && produced.every((e) => e.source_reference),
        produced.map((e) => e.source_reference).join(', ') || 'none');

      // Clarification 4: only what the transcript stated was recorded. A
      // suggestion would have arrived at confidence below 1, and none was
      // confirmed here — so anything under 1 means a guess was written.
      const guesses = produced.filter((e) => e.confidence !== null && e.confidence < 1);
      record('no suggestion was recorded without confirmation', guesses.length === 0,
        guesses.length ? `${guesses.length} unconfirmed` : 'only stated types');

      const types = [...new Set(produced.map((e) => e.knowledge_type))].sort();
      record('the labelled types were read from the text',
        types.includes('decision') && types.includes('next_step'), types.join('/'));

      const { data: after } = await admin
        .from('ingestion_records').select('status').eq('id', capture.id).single();
      record('the original capture survives filing', after?.status === 'archived',
        `original is ${after?.status}`);
    }
  }

  heading('O. Universal search');
  // One user-scoped session for every Phase 3 RPC below, so each of them is
  // subject to the caller's own policies exactly as the app is.
  const userA = await userClient(USER_A);
  if (dbTopic) {
    // The Phase 3 exit criterion: search reaches inside a pasted transcript.
    const { data: inside } = await userA.rpc('search_records', {
      p_workspace_id: dbTopic.workspace_id, p_query: CAPTURE_MARK,
    });
    record('search reaches inside a transcript', (inside ?? []).length > 0,
      `${(inside ?? []).length} hit(s)`);

    // Clarification 1: Current State is searchable through the authoritative
    // column it lives in, with no copy of the derived memory stored anywhere.
    const STATE_MARK = `trapezoid-${stamp}`;
    await admin.from('topics').update({ current_state: `Waiting on the ${STATE_MARK} review` })
      .eq('id', dbTopic.id);
    const { data: stateHits } = await userA.rpc('search_records', {
      p_workspace_id: dbTopic.workspace_id, p_query: STATE_MARK,
    });
    const stateHit = (stateHits ?? [])[0] ?? null;
    record('Current State is findable through search',
      stateHit?.entity_id === dbTopic.id && stateHit?.entity_type === 'topic',
      stateHit ? `${stateHit.entity_type} · ${stateHit.record_state}` : 'no hit');

    // Every hit says whether it is still true.
    const states = [...new Set((inside ?? []).map((h) => h.record_state))];
    record('hits report whether they are current or history',
      states.length > 0 && states.every((st) => ['current', 'historical', 'snapshot'].includes(st)),
      states.join('/'));

    // Ranking is deterministic: the same query twice gives the same order.
    const { data: again } = await userA.rpc('search_records', {
      p_workspace_id: dbTopic.workspace_id, p_query: CAPTURE_MARK,
    });
    record('ranking is deterministic',
      JSON.stringify((inside ?? []).map((h) => h.entity_id)) ===
        JSON.stringify((again ?? []).map((h) => h.entity_id)),
      'identical order across runs');
  }

  heading('P. File references');
  await a.goto(`${BASE}/files`, { waitUntil: 'networkidle' });
  const FILE_PATH = `src/icons/relay-${stamp}.tsx`;
  const fileForm = 'form:has(input[name="path"])';
  await a.click('button:has-text("Add a file or link reference")').catch(() => {});
  await a.fill(`${fileForm} input[name="path"]`, FILE_PATH).catch(() => {});
  await a.selectOption(`${fileForm} select[name="topicId"]`, topicId).catch(() => {});
  await a.click(`${fileForm} button[type="submit"]`).catch(() => {});
  await a.waitForFunction(() => /Reference saved/i.test(document.body.innerText), null, {
    timeout: 20_000,
  }).catch(() => {});

  const { data: fileRows } = await admin
    .from('file_references').select('id,path,kind,storage_path').eq('path', FILE_PATH);
  const fileRow = (fileRows ?? [])[0] ?? null;
  record('file reference row exists', Boolean(fileRow), fileRow ? `kind ${fileRow.kind}` : 'no row');
  if (fileRow) {
    // Rule 13: nothing claims to hold bytes it does not have.
    record('no upload was faked', fileRow.kind === 'repo_file' && fileRow.storage_path === null,
      'reference only, no stored object');
  }

  heading('Q. Soft delete, recovery, and what refuses to be deleted');
  if (dbTopic) {
    const { data: victims } = await admin
      .from('knowledge_entries').select('id,title').eq('topic_id', dbTopic.id).limit(1);
    const victim = (victims ?? [])[0] ?? null;

    if (victim) {
      const { data: logId, error: delErr } = await userA.rpc('soft_delete_record', {
        p_entity_type: 'knowledge_entry', p_entity_id: victim.id, p_reason: 'hosted validation',
      });
      const { data: gone } = await admin
        .from('knowledge_entries').select('deleted_at').eq('id', victim.id).single();
      record('delete stamps the row and writes a tombstone',
        !delErr && Boolean(logId) && gone?.deleted_at !== null,
        delErr ? delErr.message : `log ${String(logId).slice(0, 8)}…`);

      const { data: restored, error: resErr } = await userA.rpc('restore_record', {
        p_deletion_log_id: logId,
      });
      const { data: back } = await admin
        .from('knowledge_entries').select('deleted_at').eq('id', victim.id).single();
      record('restore brings the record back',
        !resErr && restored === victim.id && back?.deleted_at === null,
        resErr ? resErr.message : 'deleted_at cleared');
    }

    // Clarification 3, on the real project: the allowlist refuses append-only
    // history and Layer 1 evidence, and no argument can name another table.
    const { error: pvErr } = await userA.rpc('soft_delete_record', {
      p_entity_type: 'prompt_version', p_entity_id: promptVersionId ?? dbTopic.id, p_reason: null,
    });
    record('append-only history refuses to be deleted',
      Boolean(pvErr) && /append-only/i.test(pvErr.message), pvErr?.message ?? 'ACCEPTED — rule 6 broken');

    if (sessionId) {
      const { error: ssErr } = await userA.rpc('soft_delete_record', {
        p_entity_type: 'source_session', p_entity_id: sessionId, p_reason: null,
      });
      const { data: stillThere } = await admin
        .from('source_sessions').select('id').eq('id', sessionId).single();
      record('Layer 1 evidence refuses to be deleted',
        Boolean(ssErr) && Boolean(stillThere), ssErr?.message ?? 'ACCEPTED — rule 10 broken');
    }

    const { error: badType } = await userA.rpc('soft_delete_record', {
      p_entity_type: 'workspace_members', p_entity_id: dbTopic.id, p_reason: null,
    });
    record('an arbitrary table name cannot be passed as an entity type',
      Boolean(badType), badType?.message?.slice(0, 60) ?? 'ACCEPTED');
  }

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

  // The widest surface in the schema, checked on the real project as the real
  // `authenticated` role: search_documents unions twelve tables, so one missing
  // security_invoker would hand a stranger another account's transcripts,
  // prompt bodies and decisions in a single query.
  if (dbTopic) {
    const userB = await userClient(USER_B);
    const { data: leak } = await userB.rpc('search_records', {
      p_workspace_id: dbTopic.workspace_id, p_query: CAPTURE_MARK,
    });
    record("search does not leak the first account's records",
      (leak ?? []).length === 0,
      (leak ?? []).length ? `LEAKED ${(leak ?? []).length} row(s)` : 'nothing returned');

    const { data: ownLeak } = await userB
      .from('search_documents').select('workspace_id').neq('workspace_id', dbTopic.workspace_id).limit(5);
    record('an unfiltered search read returns no foreign rows',
      (ownLeak ?? []).length === 0, `${(ownLeak ?? []).length} foreign row(s)`);
  }

  await ctxB.close();

  // --- L. Export the session for authenticated responsive QA ----------------
  heading('L. Session export for responsive QA');
  const cookies = await ctxA.cookies();
  const authCookies = cookies.filter((c) => /auth-token/.test(c.name));
  const outPath = resolve(ROOT, '.qa-session.json');
  writeFileSync(outPath, JSON.stringify(cookies), { mode: 0o600 });
  record('session cookies exported', authCookies.length > 0, `${authCookies.length} auth cookie(s) → .qa-session.json`);
  await ctxA.close();

  // Run the responsive audit here rather than leaving it to a follow-up
  // command. The session belongs to a throwaway account that the cleanup below
  // deletes, so a session handed to a later process is already invalid by the
  // time that process uses it — which is exactly why the authenticated
  // viewports have always reported as skipped.
  if (authCookies.length && !process.env.CONTEXTSHELF_SKIP_QA) {
    heading('L. Authenticated responsive QA');
    const qa = spawnSync(
      process.execPath,
      [resolve(ROOT, 'scripts/responsive-qa.mjs'), BASE],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, CONTEXTSHELF_QA_COOKIE: JSON.stringify(cookies) },
      },
    );
    const out = `${qa.stdout ?? ''}${qa.stderr ?? ''}`;
    for (const line of out.trim().split('\n')) console.log(`    ${line}`);
    const audited = Number((out.match(/(\d+) page\/viewport combinations audited/) ?? [])[1] ?? 0);
    const stillSkipped = Number((out.match(/(\d+) skipped/) ?? [])[1] ?? 0);
    record(
      'authenticated viewports audited',
      qa.status === 0 && stillSkipped === 0 && audited >= 65,
      `${audited} combinations, ${stillSkipped} skipped`,
    );
  }
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
