#!/usr/bin/env node
/**
 * ContextShelf — live model-provider validation (Phase 6, provider connection).
 *
 *   node scripts/validate-provider.mjs <deploymentUrl> [--bypass <secret>]
 *
 * Phase 6 Core shipped with the deterministic provider and an Anthropic client
 * that was written and deliberately inert. This script is the gate between that
 * state and calling Phase 6 complete: it drives ONE real request to the
 * configured model provider through the deployed application and then asserts,
 * in the database rather than on the page, that everything the phase promised
 * about authority still holds when a model is the one proposing.
 *
 * It is a separate script from `validate-hosted.mjs` on purpose. That one must
 * keep passing with no key configured at all — the deterministic floor is the
 * product's honest baseline — so the checks that REQUIRE a live provider cannot
 * live there without making a paid dependency mandatory for validation.
 *
 * The source is one temporary QA transcript carrying, deliberately, nine things
 * a model has to tell apart:
 *
 *   1  a recommendation that was made and NOT approved
 *   2  a direction that was explicitly approved
 *   3  an idea, parked
 *   4  an exact prompt body that must survive verbatim
 *   5  a bug
 *   6  a fix
 *   7  an explicit next action
 *   8  a paragraph that is genuinely ambiguous
 *   9  enough structure that every suggestion can cite a real line
 *
 * The classification expectations are asserted against that list. The point is
 * not that the model is clever; it is that a recommendation never becomes an
 * active decision, an approval still lands as `proposed`, and nothing the model
 * returns can reach Current State, a winning prompt, a supersession or a
 * deletion without a person.
 *
 * Every QA account, workspace and row it creates is deleted at the end,
 * including on failure.
 */

import { chromium } from 'playwright';
import { launchOptions } from './chromium-path.mjs';
import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const BASE = (argv.find((x) => x.startsWith('http')) ?? process.env.CONTEXTSHELF_URL ?? '').replace(/\/$/, '');
const bypassFlag = argv.indexOf('--bypass');
const BYPASS =
  (bypassFlag >= 0 ? argv[bypassFlag + 1] : null) ?? process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? null;

if (!BASE.startsWith('http')) {
  console.error('usage: node scripts/validate-provider.mjs <deploymentUrl> [--bypass <secret>]');
  process.exit(2);
}

const envText = existsSync(resolve(ROOT, '.env.local')) ? readFileSync(resolve(ROOT, '.env.local'), 'utf8') : '';
const envValue = (n) => (envText.match(new RegExp(`^${n}=(.*)$`, 'm')) ?? [])[1]?.trim() ?? process.env[n] ?? null;

const SUPABASE_URL = envValue('NEXT_PUBLIC_SUPABASE_URL');
const SECRET_KEY = envValue('SUPABASE_SECRET_KEY');
const PUBLISHABLE_KEY =
  envValue('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') ?? envValue('NEXT_PUBLIC_SUPABASE_ANON_KEY');
if (!SUPABASE_URL || !SECRET_KEY || !PUBLISHABLE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be in .env.local.');
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const stamp = Date.now().toString(36);
const USER = `hello+contextshelf-provider-${stamp}@nomorefilth.com`;
/** Stamped into the source so cleanup can find every row it produced. */
const MARK = `provqa${stamp}`;

/** Sent on every request so a protected preview deployment is reachable. */
const bypassHeaders = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {};

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const heading = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

async function signInLink(email) {
  await admin.auth.admin.createUser({ email, email_confirm: true }).catch(() => {});
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`generateLink(${email}): ${error.message}`);
  const hash = data?.properties?.hashed_token;
  if (!hash) throw new Error('no hashed_token returned');
  return hash;
}

async function userClient(email) {
  const hash = await signInLink(email);
  const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.verifyOtp({ token_hash: hash, type: 'magiclink' });
  if (error) throw new Error(`user session for ${email}: ${error.message}`);
  return client;
}

// ---------------------------------------------------------------------------
// The QA source
// ---------------------------------------------------------------------------

/**
 * Nine things in one transcript, each phrased the way a real session phrases
 * it rather than the way a keyword matcher would like it to be. There is no
 * `Decision:` label anywhere — a labelled source would tell us only that the
 * model can read labels, which the deterministic provider already does.
 */
const QA_SOURCE = [
  `# Session notes ${MARK}`,
  '',
  'User: A few things came out of this session, let me get them down.',
  '',
  'Assistant: My recommendation would be to move Timeline rendering onto a web',
  'worker so the main thread stays free while a long history paints. I have not',
  'built it and nobody has agreed to it.',
  '',
  'User: I am not convinced by the worker. Leave it where it is for now.',
  '',
  'User: What we ARE doing, and I am approving this right now: every ingestion',
  'adapter normalises to NormalizedIngestion before anything is persisted. New',
  'sources are new adapters, never new write paths. That is settled — build on',
  'that basis from here.',
  '',
  'Assistant: Understood, I will treat that as the agreed direction.',
  '',
  'User: Separate thought and not a commitment — it might be nice one day to',
  'have a keyboard-only capture mode for people who never touch the mouse.',
  'Park it as something to consider.',
  '',
  'User: Here is the prompt that actually worked, keep it exactly as written:',
  '',
  '```',
  'You are reviewing a database migration. List every statement that cannot be',
  'rolled back, and for each one name the data it would destroy. Do not suggest',
  'improvements. Answer only with the list.',
  '```',
  '',
  'Assistant: Saved.',
  '',
  'User: We also hit a defect today. The resume preview keeps showing the',
  'previous destination text for about a second after you switch destination,',
  'because the panel re-renders before the new preview has resolved.',
  '',
  'Assistant: I corrected that by waiting for the preview text to change rather',
  'than polling for a word that was already on screen.',
  '',
  'User: Next thing that needs doing: run the responsive audit across the topic',
  'page at 375 pixels before we ship anything else.',
  '',
  'User: The ordering question we raised earlier may or may not matter depending',
  'on how the view ends up being read, and there might be a case for revisiting',
  'it at some point, though it could equally turn out to be fine as it stands.',
].join('\n');

/** The prompt body, exactly as the source carries it. */
const PROMPT_BODY = [
  'You are reviewing a database migration. List every statement that cannot be',
  'rolled back, and for each one name the data it would destroy. Do not suggest',
  'improvements. Answer only with the list.',
].join('\n');

/**
 * A second, tiny source whose only job is to trip the credential scanner.
 *
 * The string is a synthetic AWS access key id in the documented `AKIA` shape —
 * a pattern, not a credential. Nothing here is or ever was valid.
 */
const SECRET_SOURCE = [
  `Deployment notes ${MARK}-secretgate`,
  '',
  'User: pasting the CI config so you can see what broke.',
  '',
  'AWS_ACCESS_KEY_ID=AKIAQAQAQAQAQAQAQAQA',
  '',
  'User: the build then fails on the migration step.',
].join('\n');

const normalise = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

const browser = await chromium.launch(launchOptions());
let exitCode = 0;
let workspaceId = null;

try {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: bypassHeaders,
  });
  const page = await ctx.newPage();

  const hash = await signInLink(USER);
  await page.goto(`${BASE}/auth/confirm?token_hash=${hash}&type=magiclink`, { waitUntil: 'networkidle' });
  if (/\/login/.test(page.url())) throw new Error('sign-in did not land inside the app');
  const user = await userClient(USER);

  // --- Fixture: a topic to file into ----------------------------------------
  //
  // Created before anything is read from Settings: a brand-new account has no
  // workspace yet, and the first pass of this script read Settings on a page
  // that had not finished being an account.
  const TOPIC = `ProviderQA-${stamp}`;
  await page.goto(`${BASE}/topics/new`, { waitUntil: 'networkidle' });
  await page.fill('input[name="name"]', TOPIC);
  await page.fill('textarea[name="description"], input[name="description"]', 'Temporary QA topic for live provider validation.');
  await page.fill('textarea[name="goal"], input[name="goal"]', 'Prove a model may suggest and never decide.');
  await Promise.all([
    page.waitForURL(/\/topics\/[0-9a-f-]{36}/, { timeout: 30_000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  const topicId = (page.url().match(/\/topics\/([0-9a-f-]{36})/) ?? [])[1] ?? null;
  if (!topicId) throw new Error('QA topic was not created; cannot continue');

  const { data: topicRow } = await admin
    .from('topics').select('workspace_id,current_state,updated_at').eq('id', topicId).single();
  workspaceId = topicRow?.workspace_id ?? null;
  const currentStateBefore = topicRow?.current_state ?? null;

  // --- 1. The provider is really configured on this deployment --------------
  heading('1. Provider configuration, read from the deployment itself');

  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  const settingsText = await page.innerText('body').catch(() => '');

  record('the deployment reports AI-assisted extraction as configured',
    /AI-assisted extraction/i.test(settingsText) &&
      !/ANTHROPIC_API_KEY is not set/i.test(settingsText) &&
      !/CONTEXTSHELF_EXTRACTION_MODEL is not set/i.test(settingsText),
    /AI-assisted extraction/i.test(settingsText)
      ? 'no configuration problem reported'
      : 'the extraction section did not render');

  // The model identifier is rendered because "which model produced this" is an
  // audit question. The key is not, and must never be.
  const modelOnPage = (settingsText.match(/claude-[a-z0-9.\-]+/i) ?? [])[0] ?? null;
  record('the configured model identifier is named on the page',
    Boolean(modelOnPage), modelOnPage ?? 'no model rendered');
  record('no API key material appears on the settings page',
    !/sk-ant-/i.test(settingsText), 'no key rendered');

  // Seed one active decision so the deterministic conflict detector has
  // something real to compare a model's proposal against.
  await admin.from('decisions').insert({
    workspace_id: workspaceId,
    topic_id: topicId,
    user_id: (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === USER)?.id,
    title: `Ingestion adapters normalise before persisting ${MARK}`,
    decision: 'Every adapter produces NormalizedIngestion and the persister is the only writer.',
    status: 'active',
  });

  // --- 2. The credential gate, before anything leaves the machine -----------
  heading('2. The credential gate runs before the external request');

  await page.goto(`${BASE}/inbox`, { waitUntil: 'networkidle' });
  await page.fill('textarea', SECRET_SOURCE);
  await page.click('button:has-text("Save to Inbox")');
  await page.waitForTimeout(1500);

  const { data: secretCaptures } = await admin
    .from('ingestion_records').select('id').like('raw_content', `%${MARK}-secretgate%`).limit(1);
  const secretItemId = (secretCaptures ?? [])[0]?.id ?? null;
  record('the credential-bearing source is captured',
    Boolean(secretItemId), secretItemId ? `record ${String(secretItemId).slice(0, 8)}…` : 'no capture');

  if (secretItemId) {
    await page.goto(`${BASE}/inbox/${secretItemId}`, { waitUntil: 'networkidle' });
    const gateText = await page.innerText('body').catch(() => '');
    record('the scan names what it found, before any request',
      /may contain credentials/i.test(gateText) && /AWS access key id/i.test(gateText),
      'warned and named');
    record('the warning does not claim to be exhaustive',
      /not exhaustive/i.test(gateText), 'stated as a warning');

    // Analyse WITHOUT ticking the acknowledgement. It must refuse.
    //
    // The wait is on "nothing was written", not on the warning: the warning is
    // already on the page before the click, so waiting for it would pass
    // before the action had answered.
    await page.click('button:has-text("Extract suggestions")');
    await page.waitForFunction(
      () => /nothing was written/i.test(document.body.innerText),
      null,
      { timeout: 60_000 },
    ).catch(() => {});

    const { data: blockedRuns } = await admin
      .from('extraction_runs').select('id').eq('ingestion_record_id', secretItemId);
    record('an unacknowledged credential blocks the run entirely',
      (blockedRuns ?? []).length === 0, `${(blockedRuns ?? []).length} runs recorded`);

    // Tick the acknowledgement; the same click must now go through. This is
    // what proves the gate is a gate and not a wall.
    await page.locator('label:has-text("I have reviewed this") input[type="checkbox"]').check();
    await page.click('button:has-text("Extract suggestions")');
    await page.waitForFunction(
      () => /suggestions? to review|Nothing was proposed|failed/i.test(document.body.innerText),
      null,
      { timeout: 120_000 },
    ).catch(() => {});

    const { data: ackRuns } = await admin
      .from('extraction_runs').select('id,provider,status').eq('ingestion_record_id', secretItemId);
    record('an explicit acknowledgement is what unblocks it',
      (ackRuns ?? []).length === 1,
      (ackRuns ?? [])[0] ? `${ackRuns[0].provider} · ${ackRuns[0].status}` : 'still blocked');
  }

  // --- 3. The live request --------------------------------------------------
  heading('3. One real request to the configured provider');

  await page.goto(`${BASE}/inbox`, { waitUntil: 'networkidle' });
  await page.fill('textarea', QA_SOURCE);
  await page.click('button:has-text("Save to Inbox")');
  await page.waitForTimeout(1500);

  const { data: captures } = await admin
    .from('ingestion_records')
    .select('id,raw_content')
    .like('raw_content', `%# Session notes ${MARK}%`)
    .limit(1);
  const itemId = (captures ?? [])[0]?.id ?? null;
  if (!itemId) throw new Error('the QA source was not captured; cannot continue');

  await page.goto(`${BASE}/inbox/${itemId}`, { waitUntil: 'networkidle' });
  const panelText = await page.innerText('body').catch(() => '');
  record('the panel says the source will be sent to a model provider',
    /Sends the source below to the configured model provider/i.test(panelText),
    'stated before sending');
  record('no credential warning is raised for a clean source',
    !/may contain credentials/i.test(panelText), 'clean');

  const startedAt = Date.now();
  await page.click('button:has-text("Extract suggestions")');
  await page.waitForFunction(
    () => /suggestions? to review|Nothing was proposed|failed|could not be reached|returned \d\d\d/i.test(document.body.innerText),
    null,
    { timeout: 180_000 },
  ).catch(() => {});
  const elapsed = Math.round((Date.now() - startedAt) / 1000);

  const { data: runRows } = await admin
    .from('extraction_runs')
    .select('*')
    .eq('ingestion_record_id', itemId)
    .order('started_at', { ascending: false });
  const run = (runRows ?? [])[0] ?? null;

  record('the request to the provider succeeded',
    Boolean(run) && run.status === 'succeeded',
    run ? `${run.status}${run.failure_detail ? ` — ${run.failure_detail}` : ''} in ${elapsed}s` : 'no run recorded');

  const { data: suggestionRows } = await admin
    .from('extraction_suggestions')
    .select('*')
    .eq('run_id', run?.id ?? '00000000-0000-0000-0000-000000000000')
    .order('ordinal');
  const suggestions = suggestionRows ?? [];

  record('the response passed the structured-output validator',
    suggestions.length > 0 &&
      suggestions.every((s) => ['decision', 'idea', 'prompt', 'action', 'knowledge_entry', 'current_state', 'relationship'].includes(s.kind)),
    `${suggestions.length} records accepted`);

  const badOutput = (run?.warnings ?? []).filter((w) => /^records\[\d+\]|did not return JSON|not a JSON object/i.test(w));
  record('malformed records, if any, are reported rather than silently dropped',
    badOutput.length === 0 || badOutput.every((w) => typeof w === 'string' && w.length > 0),
    badOutput.length === 0 ? 'nothing rejected' : `${badOutput.length} reported: ${badOutput[0]}`);

  const sourceLineCount = QA_SOURCE.split('\n').length;
  const anchored = suggestions.filter((s) => /^(L\d+(-L\d+)?|msg:\d+|chunk:\d+(:L\d+(-L\d+)?)?)$/i.test(s.source_reference ?? ''));
  const inRange = anchored.filter((s) => {
    const first = Number((String(s.source_reference).match(/L(\d+)/) ?? [])[1] ?? 0);
    return first >= 1 && first <= sourceLineCount;
  });
  record('every usable suggestion carries a resolvable provenance anchor',
    suggestions.length > 0 && anchored.length === suggestions.length,
    `${anchored.length} of ${suggestions.length}`);
  record('every anchor points inside the source it came from',
    inRange.length === anchored.length,
    `${inRange.length} of ${anchored.length} within L1–L${sourceLineCount}`);

  // --- 4. What the model was asked to tell apart ---------------------------
  heading('4. Classification of the nine planted items');

  const find = (re, kinds = null) =>
    suggestions.find((s) =>
      re.test(`${s.title} ${s.content ?? ''}`) && (kinds === null || kinds.includes(s.kind)));
  const anyMatching = (re) => suggestions.filter((s) => re.test(`${s.title} ${s.content ?? ''}`));

  const workerMatches = anyMatching(/worker/i);
  record('the unapproved recommendation never became an active decision',
    workerMatches.every((s) => s.kind !== 'decision' || s.status_suggestion === 'proposed'),
    workerMatches.length === 0
      ? 'not proposed at all, which is also correct'
      : workerMatches.map((s) => `${s.kind}/${s.status_suggestion ?? '—'}`).join(', '));
  record('nothing at all is suggested as an active decision',
    suggestions.every((s) => s.kind !== 'decision' || s.status_suggestion === 'proposed'),
    'every decision suggestion is proposed');

  const approved = find(/normalis|normaliz|NormalizedIngestion|adapter/i, ['decision']);
  record('the explicitly approved direction is suggested as a decision',
    Boolean(approved), approved ? `“${approved.title.slice(0, 60)}”` : 'no decision suggestion matched');
  record('that decision is still review-gated, not active',
    !approved || approved.status_suggestion === 'proposed',
    approved ? `status ${approved.status_suggestion}` : 'n/a');

  const idea = find(/keyboard/i, ['idea']);
  record('the parked thought is suggested as an idea',
    Boolean(idea), idea ? `“${idea.title.slice(0, 60)}”` : 'no idea matched');

  const prompt = suggestions.find((s) => s.kind === 'prompt');
  record('the prompt is recognised as a prompt',
    Boolean(prompt), prompt ? `“${prompt.title.slice(0, 60)}”` : 'no prompt suggestion');
  // Verbatim where the transport allows it: whitespace may be re-wrapped by
  // JSON round-tripping, so the comparison is on normalised text and the
  // sentence order has to be exact.
  record('the prompt body survives the round trip',
    Boolean(prompt) && normalise(prompt.content).includes(normalise(PROMPT_BODY)),
    prompt ? `${(prompt.content ?? '').length} characters stored` : 'n/a');

  // Type first, wording second: what matters is that the defect landed in the
  // bug lane and the correction in the fix lane, not that either is phrased
  // the way this script guessed.
  const bug = suggestions.find((s) => s.knowledge_type === 'bug');
  record('the defect is classified as a bug',
    Boolean(bug) && /preview|destination|stale|render/i.test(`${bug.title} ${bug.content ?? ''}`),
    bug ? `“${bug.title.slice(0, 60)}”` : 'no bug suggestion');

  const fix = suggestions.find((s) => s.knowledge_type === 'fix');
  record('the correction is classified as a fix, separately from the bug',
    Boolean(fix) && fix.id !== bug?.id,
    fix ? `“${fix.title.slice(0, 60)}”` : 'no fix suggestion');

  const action = find(/responsive audit|375/i, ['action']);
  record('the explicit next step is suggested as an action',
    Boolean(action), action ? `“${action.title.slice(0, 60)}”` : 'no action matched');

  const ambiguous = anyMatching(/ordering/i);
  record('the ambiguous paragraph is either skipped or held at low confidence',
    ambiguous.length === 0 || ambiguous.every((s) => Number(s.confidence) < 0.6),
    ambiguous.length === 0
      ? 'nothing proposed from it'
      : ambiguous.map((s) => `${s.kind} @ ${s.confidence}`).join(', '));

  // --- 5. What the run recorded --------------------------------------------
  heading('5. What the run recorded about the call');

  record('the provider is recorded by name', run?.provider === 'anthropic', `provider ${run?.provider}`);
  record('the exact configured model identifier is recorded',
    Boolean(run?.model) && (modelOnPage === null || run.model === modelOnPage),
    `model ${run?.model}`);
  record('the extraction prompt version is recorded', run?.prompt_version === '1', `prompt v${run?.prompt_version}`);
  record('a real input token count is recorded', Number(run?.input_tokens) > 0, `${run?.input_tokens} in`);
  record('a real output token count is recorded', Number(run?.output_tokens) > 0, `${run?.output_tokens} out`);
  record('no monetary cost is invented', run?.cost_usd === null, `cost_usd ${run?.cost_usd}`);

  await page.reload({ waitUntil: 'networkidle' });
  const reviewText = await page.innerText('body').catch(() => '');
  record('no currency figure is displayed anywhere in the review',
    !/[$£€]\s?\d/.test(reviewText), 'tokens only');
  record('the review says these are suggestions from a model',
    /suggestions from a model/i.test(reviewText), 'named honestly');

  // --- 6. The review survives, and the user's version is what counts --------
  heading('6. Review persistence');

  record('suggestions persist through a refresh',
    /suggestions? to review/i.test(reviewText), 'restored from rows');

  // The edit goes through the real inline editor: open the row, retype the
  // title, blur. Anything less would prove the server action works and nothing
  // about whether a reviewer can actually reach it.
  const editTarget = approved ?? suggestions[0];
  const editedTitle = `Edited during review ${MARK}`;
  const editRow = page.locator('li').filter({ hasText: editTarget.title.slice(0, 40) }).first();
  await editRow.locator('button[aria-label^="Edit"]').click();
  const titleField = editRow.locator('input:not([type="checkbox"])').first();
  await titleField.waitFor({ timeout: 10_000 });
  await titleField.fill(editedTitle);
  await titleField.blur();
  await page.waitForTimeout(3_000);

  const { data: afterEdit } = await admin
    .from('extraction_suggestions').select('id,kind,title,state,original')
    .eq('id', editTarget.id).maybeSingle();
  record('a user edit persists to the row, not just the screen',
    afterEdit?.title === editedTitle, afterEdit ? `stored “${String(afterEdit.title).slice(0, 44)}”` : 'no row');
  record('the edit stays legible as an edit',
    afterEdit?.state === 'edited' && afterEdit?.original?.title === editTarget.title,
    afterEdit ? `original kept: “${String(afterEdit?.original?.title ?? '').slice(0, 44)}”` : 'n/a');

  // Include / exclude through the real checkbox, asserted as a flip.
  const toggleTarget = suggestions.find((s) => s.kind !== 'decision' && s.kind !== 'current_state' && s.id !== editTarget.id)
    ?? suggestions.find((s) => s.id !== editTarget.id);
  const wasSelected = toggleTarget?.selected ?? null;
  if (toggleTarget) {
    await page.locator('li').filter({ hasText: toggleTarget.title.slice(0, 40) }).first()
      .locator('input[type="checkbox"]').click();
    await page.waitForTimeout(3_000);
  }
  const { data: toggled } = toggleTarget
    ? await admin.from('extraction_suggestions').select('selected').eq('id', toggleTarget.id).maybeSingle()
    : { data: null };
  record('include/exclude persists as a stored flip, not client state',
    Boolean(toggled) && toggled.selected === !wasSelected,
    toggleTarget ? `${wasSelected} → ${toggled?.selected}` : 'nothing to toggle');

  await page.reload({ waitUntil: 'networkidle' });
  const afterReload = await page.innerText('body').catch(() => '');
  record('the edited title is what the reloaded review shows',
    afterReload.includes(editedTitle), 'edit survived the refresh');

  const { data: selectionRows } = await admin
    .from('extraction_suggestions').select('id,selected,kind').eq('run_id', run?.id);
  record('no authority-changing suggestion is pre-selected, whatever the model returned',
    suggestions.every((s) => !(s.selected && ['decision', 'current_state'].includes(s.kind))),
    `${suggestions.filter((s) => ['decision', 'current_state'].includes(s.kind)).length} authority suggestions, none pre-ticked`);
  void selectionRows;

  // --- 7. Duplicates and conflicts stay deterministic -----------------------
  heading('7. Duplicate and conflict findings are ContextShelf’s, not the model’s');

  const flagged = suggestions.filter((s) => s.duplicate_of_id || s.conflicts_with_id);

  // Every conflict id must resolve to a decision that actually exists in this
  // workspace. A model naming a record it cannot see would resolve to nothing.
  const conflictIds = [...new Set(flagged.map((s) => s.conflicts_with_id).filter(Boolean))];
  const { data: conflictTargets } = conflictIds.length
    ? await admin.from('decisions').select('id,workspace_id').in('id', conflictIds)
    : { data: [] };
  record('every conflict finding resolves to a real decision in this workspace',
    (conflictTargets ?? []).length === conflictIds.length &&
      (conflictTargets ?? []).every((d) => d.workspace_id === workspaceId),
    `${conflictIds.length} conflict ids, ${(conflictTargets ?? []).length} resolved`);

  record('a flagged suggestion is never pre-selected',
    flagged.every((s) => !s.selected), `${flagged.filter((s) => s.selected).length} pre-ticked of ${flagged.length}`);

  record('every duplicate finding carries the deterministic reason, not a model opinion',
    suggestions.every((s) => !s.duplicate_of_id || Boolean(s.duplicate_reason)),
    `${suggestions.filter((s) => s.duplicate_of_id).length} duplicate findings`);

  // --- 8. Confirmation ------------------------------------------------------
  heading('8. Confirmation — what a person is allowed to turn into memory');

  // A synthetic Current State suggestion, added to the run so the batch path
  // is asked to file the one kind it must refuse by name.
  const { data: injected } = await admin.from('extraction_suggestions').insert({
    run_id: run.id,
    workspace_id: workspaceId,
    ordinal: 999,
    kind: 'current_state',
    title: `Proposed current state ${MARK}`,
    content: 'The worker rewrite is underway and the adapters are being replaced.',
    confidence: 0.9,
    basis: ['injected by provider validation'],
    source_reference: 'L1',
    payload: {},
    original: { kind: 'current_state', title: `Proposed current state ${MARK}` },
    selected: false,
  }).select('id').single();

  const confirmIds = [...suggestions.map((s) => s.id), injected.id];
  await admin.from('extraction_suggestions').update({ selected: true }).in('id', confirmIds);

  const { data: receipt, error: confirmError } = await user.rpc('confirm_extraction_suggestions', {
    p_run_id: run.id,
    p_suggestion_ids: confirmIds,
    p_topic_id: topicId,
    p_subtopic_id: null,
  });
  record('a batch confirmation returns an exact receipt',
    !confirmError && (receipt?.createdCount ?? 0) > 0,
    confirmError ? confirmError.message : `${receipt?.createdCount} created, ${receipt?.skippedCount} skipped`);
  record('Current State is refused by the batch path by name',
    (receipt?.skippedCount ?? 0) >= 1, `${receipt?.skippedCount} skipped`);

  const { data: topicAfter } = await admin
    .from('topics').select('current_state,updated_at').eq('id', topicId).single();
  record('Current State is untouched until it is separately accepted',
    (topicAfter?.current_state ?? null) === currentStateBefore,
    `still ${topicAfter?.current_state === null ? 'null' : `“${String(topicAfter?.current_state).slice(0, 40)}”`}`);

  const { data: filedDecisions } = await admin
    .from('decisions').select('id,title,status,superseded_by_id,supersedes_reason').eq('topic_id', topicId);
  // One active decision existed before any of this — the conflict fixture.
  // Everything the review filed must be proposed.
  const activeDecisions = (filedDecisions ?? []).filter((d) => d.status === 'active');
  record('a confirmed decision is filed proposed, never active',
    activeDecisions.length === 1 && activeDecisions[0].title.includes(MARK) &&
      (filedDecisions ?? []).filter((d) => d.status === 'proposed').length > 0,
    `${(filedDecisions ?? []).filter((d) => d.status === 'proposed').length} proposed, 1 pre-existing active`);

  // The edited suggestion has to be findable, under its edited title, in
  // whichever table its kind files into.
  const TABLE_FOR = {
    decision: 'decisions', idea: 'ideas', prompt: 'prompts',
    action: 'actions', knowledge_entry: 'knowledge_entries',
  };
  const editedTable = TABLE_FOR[afterEdit?.kind ?? editTarget.kind] ?? 'knowledge_entries';
  const { data: editedFiled } = await admin
    .from(editedTable).select('id,title').eq('topic_id', topicId).eq('title', editedTitle);
  record('the user’s edited version is what got filed, not the model’s original',
    (editedFiled ?? []).length === 1,
    `${(editedFiled ?? []).length} row in ${editedTable}`);

  const { data: filedIdeas } = await admin.from('ideas').select('id,title,status').eq('topic_id', topicId);
  record('a confirmed idea is filed suggested, never accepted',
    (filedIdeas ?? []).every((i) => i.status === 'suggested'),
    (filedIdeas ?? []).map((i) => i.status).join(', ') || 'none');

  const { data: filedPrompts } = await admin.from('prompts').select('id,is_winning').eq('topic_id', topicId);
  const { data: filedVersions } = await admin
    .from('prompt_versions').select('id,prompt_id,status').in('prompt_id', (filedPrompts ?? []).map((p) => p.id).length ? (filedPrompts ?? []).map((p) => p.id) : ['00000000-0000-0000-0000-000000000000']);
  record('no winning prompt version is selected automatically',
    (filedPrompts ?? []).every((p) => p.is_winning === false) &&
      (filedVersions ?? []).every((v) => v.status === 'untested'),
    `${(filedPrompts ?? []).length} prompts, ${(filedVersions ?? []).length} versions untested`);

  const { data: selections } = await admin
    .from('prompt_winning_selections').select('id').in('prompt_id', (filedPrompts ?? []).map((p) => p.id).length ? (filedPrompts ?? []).map((p) => p.id) : ['00000000-0000-0000-0000-000000000000']);
  record('no winning selection row is written by confirmation',
    (selections ?? []).length === 0, `${(selections ?? []).length} selections`);

  record('no supersession happens automatically',
    (filedDecisions ?? []).every((d) => d.superseded_by_id === null && d.supersedes_reason === null),
    'nothing superseded');

  const { data: deletions } = await admin
    .from('deletion_log').select('id').eq('workspace_id', workspaceId);
  record('no destructive operation happens automatically',
    (deletions ?? []).length === 0, `${(deletions ?? []).length} deletions logged`);

  const { data: filedEntries } = await admin
    .from('knowledge_entries').select('id,title,knowledge_type,source_session_id,deleted_at').eq('topic_id', topicId);
  record('confirmed entries keep their Layer 1 evidence link',
    (filedEntries ?? []).length > 0 && (filedEntries ?? []).every((e) => e.source_session_id !== null),
    `${(filedEntries ?? []).length} entries, all linked`);

  // Idempotency.
  const beforeSecond = {
    decisions: (filedDecisions ?? []).length,
    entries: (filedEntries ?? []).length,
    ideas: (filedIdeas ?? []).length,
    prompts: (filedPrompts ?? []).length,
  };
  await user.rpc('confirm_extraction_suggestions', {
    p_run_id: run.id, p_suggestion_ids: confirmIds, p_topic_id: topicId, p_subtopic_id: null,
  });
  const after = {
    decisions: (await admin.from('decisions').select('id').eq('topic_id', topicId)).data?.length ?? -1,
    entries: (await admin.from('knowledge_entries').select('id').eq('topic_id', topicId)).data?.length ?? -1,
    ideas: (await admin.from('ideas').select('id').eq('topic_id', topicId)).data?.length ?? -1,
    prompts: (await admin.from('prompts').select('id').eq('topic_id', topicId)).data?.length ?? -1,
  };
  record('confirming the same batch twice writes nothing the second time',
    JSON.stringify(after) === JSON.stringify(beforeSecond),
    `${JSON.stringify(after)} vs ${JSON.stringify(beforeSecond)}`);

  const { data: rawAfter } = await admin
    .from('ingestion_records').select('raw_content').eq('id', itemId).single();
  record('the raw source is never altered by any of this',
    String(rawAfter?.raw_content) === QA_SOURCE, 'stored byte-for-byte');

  // --- 9. Resume reflects only confirmed information ------------------------
  heading('9. Resume');

  // The injected Current State suggestion was refused by the batch and is
  // rejected here. It is the control: a suggestion nobody confirmed.
  await admin.from('extraction_suggestions').update({ state: 'rejected', selected: false }).eq('id', injected.id);

  await page.goto(`${BASE}/topics/${topicId}/resume`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => /ContextShelf Resume Context/.test(document.body.innerText), null, { timeout: 60_000 }).catch(() => {});
  const resume = (await page.locator('pre').first().innerText().catch(() => '')) || '';

  record('a resume generates for the topic after a model-assisted review',
    resume.includes('ContextShelf Resume Context'), `${resume.length} characters`);

  const confirmedTitles = [
    ...(filedEntries ?? []).map((e) => e.title),
    ...(filedDecisions ?? []).map((d) => d.title),
    ...(filedIdeas ?? []).map((i) => i.title),
  ].filter(Boolean);
  const carried = confirmedTitles.filter((t) => resume.includes(t));
  record('Resume carries confirmed records',
    carried.length > 0, `${carried.length} of ${confirmedTitles.length} confirmed titles present`);

  record('Resume never carries a suggestion nobody confirmed',
    !resume.includes(`Proposed current state ${MARK}`),
    'the rejected Current State suggestion is absent');

  const avoidSection = (resume.split('Avoid / Do Not Repeat')[1] ?? '').split('\n##')[0];
  record('a proposed decision does not reach the avoid list',
    !avoidSection.includes(editedTitle),
    'proposed is pending, not rejected');

  // --- 10. Machine ingestion never triggers a model -------------------------
  heading('10. Phase 5 delivery still never calls a model');

  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.fill('input[name="name"]', `Provider QA ${stamp}`);
  await page.click('button:has-text("Create token")');
  await page.waitForFunction(() => /cs_live_/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => {});
  const shown = await page.locator('pre').filter({ hasText: /cs_live_[A-Za-z0-9_-]{40,}/ }).first().innerText().catch(() => '');
  const ingestToken = shown.trim();

  const delivered = await fetch(`${BASE}/api/ingest`, {
    method: 'POST',
    headers: {
      ...bypassHeaders,
      Authorization: `Bearer ${ingestToken}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `provider-qa-${stamp}`,
    },
    body: JSON.stringify({
      version: 1,
      source: 'claude_code',
      title: `Provider QA delivery ${MARK}`,
      target: { topicId },
      code: { branch: 'phase-6-assisted-ingestion', buildStatus: 'passed' },
      messages: [{ role: 'assistant', content: `delivery ${MARK} recorded without a model` }],
      segments: [{ knowledgeType: 'implementation', title: `Delivered without a model ${MARK}` }],
    }),
  });
  const deliveredBody = await delivered.json().catch(() => ({}));
  const deliveredRecordId = deliveredBody?.receipt?.ingestionRecordId ?? null;
  record('a machine delivery is accepted',
    delivered.status === 201 && Boolean(deliveredRecordId),
    `status ${delivered.status}`);

  const { data: deliveryRuns } = await admin
    .from('extraction_runs').select('id').eq('ingestion_record_id', deliveredRecordId ?? '00000000-0000-0000-0000-000000000000');
  record('the delivery triggered no extraction run, and so no model call',
    (deliveryRuns ?? []).length === 0, `${(deliveryRuns ?? []).length} runs`);
  record('the response to a machine names no provider and no credential',
    !/anthropic|sk-ant-|api[_-]?key/i.test(JSON.stringify(deliveredBody)),
    'receipt is transport only');

  // --- 11. Credentials do not leak -----------------------------------------
  heading('11. Credential containment');

  const runJson = JSON.stringify(run ?? {});
  const suggestionJson = JSON.stringify(suggestions);
  record('no credential material is stored on the run or its suggestions',
    !/sk-ant-/.test(runJson) && !/sk-ant-/.test(suggestionJson) &&
      !/ANTHROPIC_API_KEY\s*[:=]\s*\S/.test(runJson + suggestionJson),
    'run and suggestions clean');

  const html = await (await fetch(`${BASE}/inbox/${itemId}`, { headers: bypassHeaders })).text();
  const bundles = [...new Set([...html.matchAll(/\/_next\/static\/[^"']+\.js/g)].map((m) => m[0]))];
  let bundleHits = 0;
  for (const b of bundles.slice(0, 40)) {
    const js = await (await fetch(`${BASE}${b}`, { headers: bypassHeaders })).text().catch(() => '');
    if (/sk-ant-[A-Za-z0-9_-]{20,}/.test(js)) bundleHits += 1;
  }
  record('no credential reaches the client bundle',
    bundleHits === 0 && !/sk-ant-[A-Za-z0-9_-]{20,}/.test(html),
    `${bundles.length} bundles scanned`);

  const { data: snapshots } = await admin
    .from('context_snapshots').select('body').eq('topic_id', topicId);
  record('no credential reaches an export',
    (snapshots ?? []).every((s) => !/sk-ant-/.test(String(s.body))),
    `${(snapshots ?? []).length} snapshots scanned`);

  // --- 12. The deterministic floor is unaffected ---------------------------
  heading('12. The deterministic provider is still available and unchanged');

  const unit = spawnSync('npx', ['vitest', 'run', 'src/lib/extraction', '--reporter=dot'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, CI: '1' },
  });
  const unitOut = `${unit.stdout ?? ''}${unit.stderr ?? ''}`;
  record('the deterministic fixtures still pass unchanged',
    unit.status === 0, (unitOut.match(/Tests\s+\d+ passed[^\n]*/) ?? ['see output'])[0].trim());
} catch (error) {
  record('the run completed', false, error.message);
  exitCode = 1;
} finally {
  // --- Cleanup --------------------------------------------------------------
  heading('Cleanup');
  try {
    if (workspaceId) {
      for (const table of [
        'extraction_suggestions', 'extraction_runs', 'context_snapshots', 'relationships',
        'prompt_winning_selections', 'prompt_version_outcomes', 'prompt_versions', 'prompts',
        'knowledge_entry_versions', 'knowledge_entries', 'ideas', 'decisions', 'actions',
        'file_references', 'ingestion_deliveries', 'ingestion_records', 'source_sessions',
        'ingestion_tokens', 'subtopics', 'topics', 'deletion_log',
      ]) {
        // Errors are reported, not thrown: one table refusing must not leave
        // the rest of the QA data behind.
        const { error } = await admin.from(table).delete().eq('workspace_id', workspaceId);
        if (error) console.log(`    note: ${table} — ${error.message}`);
      }
      await admin.from('workspace_members').delete().eq('workspace_id', workspaceId);
      await admin.from('workspaces').delete().eq('id', workspaceId);
    }
    const { data } = await admin.auth.admin.listUsers();
    const u = (data?.users ?? []).find((x) => x.email === USER);
    if (u) await admin.auth.admin.deleteUser(u.id);
    record('every QA row and account created by this run is deleted', true, 'workspace and user removed');
  } catch (error) {
    record('every QA row and account created by this run is deleted', false, error.message);
    exitCode = 1;
  }
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n\x1b[1m${results.length - failed.length}/${results.length} checks passed\x1b[0m`);
if (failed.length > 0) {
  console.log('\nFailed:');
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
  exitCode = 1;
}
process.exit(exitCode);
