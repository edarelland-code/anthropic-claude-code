/**
 * Visual QA for the Topics table view.
 *
 * The acceptance criterion that actually matters is alignment, and the only way
 * to check it is to measure where the browser really put each column — not to
 * read the CSS and believe it. So this walks every status section at every
 * viewport, records the left edge and width of all seven columns, and fails if
 * any section disagrees with the first by more than a rounding pixel.
 *
 *   node scripts/topics-table-qa.mjs [baseUrl] [--screenshots]
 */
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

import { launchOptions } from './chromium-path.mjs';

const BASE = (process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://127.0.0.1:3000').replace(/\/$/, '');
const SHOTS = process.argv.includes('--screenshots');
const SHOT_DIR = process.env.QA_SHOT_DIR ?? '/tmp/contextshelf-table-qa';

const env = readFileSync('.env.local', 'utf8');
const v = (n) => (env.match(new RegExp(`^${n}=(.*)$`, 'm')) ?? [])[1]?.trim();
const admin = createClient(v('NEXT_PUBLIC_SUPABASE_URL'), v('SUPABASE_SECRET_KEY'), {
  auth: { autoRefreshToken: false, persistSession: false },
});
const OWNER = 'ed.arelland@gmail.com';

const DESKTOP = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'desktop-1280', width: 1280, height: 800 },
];
const SMALL = [
  { name: 'tablet-1024', width: 1024, height: 1366 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'mobile-430', width: 430, height: 932 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-375', width: 375, height: 667 },
];

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const heading = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

// A Vercel preview sits behind Deployment Protection; the automation bypass
// header is how a QA run reaches it. Absent, this is a no-op and the run works
// unchanged against a local server.
const BYPASS = process.env.CONTEXTSHELF_BYPASS;
const extraHTTPHeaders = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : undefined;

const browser = await chromium.launch(launchOptions());
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders });
const page = await ctx.newPage();

const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: OWNER });
await page.goto(`${BASE}/auth/confirm?token_hash=${link.properties.hashed_token}&type=magiclink`, {
  waitUntil: 'networkidle',
});
const cookies = await ctx.cookies();
if (SHOTS) await mkdir(SHOT_DIR, { recursive: true });

/**
 * Every real table on the page. NOT `table` on its own.
 *
 * While React streams table markup it parks rows in `<table hidden><tbody>`
 * placeholders attached to <body> — a table is the only element a <tr> can be
 * parsed inside, so the framework has to use one. On roughly one load in four
 * this run caught 58 of them still present, and counting them read as 65
 * sections, phantom misalignment and rows "1442px tall". They are hidden, empty
 * and transient; the real tables are the ones with a header.
 */
const REAL_TABLES = 'table:not([hidden])';

/**
 * Waits for the board to render.
 *
 * Deliberately does NOT wait for the hidden placeholders to disappear: React
 * leaves them attached, so that predicate can never come true and simply times
 * out. Ignoring them is the fix; waiting on them was a second bug.
 */
async function settled(p, { filtered = false } = {}) {
  await p.waitForSelector(filtered ? 'section[aria-labelledby]' : '#section-ideas', { timeout: 20_000 });
  await p.waitForFunction(
    () => {
      const real = [...document.querySelectorAll('table:not([hidden])')];
      return real.length > 0 && real.every((t) => t.querySelectorAll('thead th').length === 7);
    },
    null,
    { timeout: 20_000 },
  );
}

/** Column geometry per section, as the browser laid it out. */
const geometry = (p) =>
  p.evaluate(() =>
    [...document.querySelectorAll('table:not([hidden])')].map((t) => ({
      section: t.closest('section')?.querySelector('h2')?.textContent?.trim() ?? '?',
      headers: [...t.querySelectorAll('thead th')].map((th) => {
        const r = th.getBoundingClientRect();
        return { label: th.textContent.trim(), left: Math.round(r.left), width: Math.round(r.width) };
      }),
      bodyRows: t.querySelectorAll('tbody tr').length,
      firstRowCells: t.querySelector('tbody tr')
        ? [...t.querySelector('tbody tr').children].length
        : 0,
    })),
  );

// ---------------------------------------------------------------------------
heading('A. Desktop table structure and alignment');
for (const vp of DESKTOP) {
  const c = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, extraHTTPHeaders });
  await c.addCookies(cookies);
  const p = await c.newPage();
  await p.goto(`${BASE}/topics?view=table`, { waitUntil: 'networkidle' });
  await settled(p);

  const tables = await geometry(p);
  record(`${vp.name}: every status section renders a table`, tables.length >= 7, `${tables.length} sections`);
  record(
    `${vp.name}: every section has exactly 7 header cells`,
    tables.every((t) => t.headers.length === 7),
    tables.map((t) => `${t.section}:${t.headers.length}`).join(' '),
  );
  record(
    `${vp.name}: every section has exactly 7 cells in its first row`,
    tables.every((t) => t.firstRowCells === 7),
    tables.map((t) => `${t.section}:${t.firstRowCells}`).join(' '),
  );
  record(
    `${vp.name}: no section is dropped for being empty`,
    tables.every((t) => t.bodyRows >= 1),
    tables.map((t) => `${t.section}:${t.bodyRows}`).join(' '),
  );

  // The hard requirement: identical geometry in every section.
  const base = tables[0];
  const drift = [];
  for (const t of tables.slice(1)) {
    t.headers.forEach((h, i) => {
      const b = base.headers[i];
      if (!b) return;
      const dl = Math.abs(h.left - b.left);
      const dw = Math.abs(h.width - b.width);
      if (dl > 1 || dw > 1) {
        drift.push(`${t.section}/${h.label}: left ${h.left} vs ${b.left}, width ${h.width} vs ${b.width}`);
      }
    });
  }
  record(
    `${vp.name}: all 7 columns align EXACTLY across all sections`,
    drift.length === 0,
    drift.length ? drift.slice(0, 3).join(' | ') : `${base.headers.map((h) => h.width).join('/')}px`,
  );
  record(
    `${vp.name}: headers carry the exact requested labels, no Confidence`,
    base.headers.map((h) => h.label).join('|') ===
      'Project|What it is|Last known state|What appears completed|What remains unfinished|Best next action|Last activity',
    base.headers.map((h) => h.label).join(' | '),
  );

  // Empty section renders a full aligned row of em dashes.
  const empty = await p.evaluate(() => {
    for (const t of document.querySelectorAll('table:not([hidden])')) {
      const first = t.querySelector('tbody tr');
      if (first && first.textContent.includes('No projects')) {
        return {
          section: t.closest('section')?.querySelector('h2')?.textContent?.trim(),
          cells: [...first.children].map((c) => c.textContent.trim()),
        };
      }
    }
    return null;
  });
  record(
    `${vp.name}: an empty section renders "No projects" plus 6 em dashes`,
    Boolean(empty) && empty.cells.length === 7 && empty.cells.slice(1).every((c) => c === '—'),
    empty ? `${empty.section}: ${empty.cells.join(' ')}` : 'no empty section found',
  );

  const overflow = await p.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  record(`${vp.name}: no horizontal page overflow`, overflow <= 1, `${overflow}px`);

  const tallest = await p.evaluate(() =>
    Math.max(...[...document.querySelectorAll('tbody tr')].map((r) => r.getBoundingClientRect().height)),
  );
  // Every cell is clamped, so the ceiling is ~4 lines plus padding.
  record(`${vp.name}: no row grows beyond ~4 clamped lines`, tallest < 150, `tallest row ${Math.round(tallest)}px`);

  if (SHOTS) await p.screenshot({ path: `${SHOT_DIR}/table-${vp.name}.png`, fullPage: true });
  await c.close();
}

// ---------------------------------------------------------------------------
heading('B. Tablet and mobile fall back to cards');
for (const vp of SMALL) {
  const c = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.width <= 430,
    hasTouch: vp.width <= 768,
    extraHTTPHeaders,
  });
  await c.addCookies(cookies);
  const p = await c.newPage();
  await p.goto(`${BASE}/topics?view=table`, { waitUntil: 'networkidle' });

  const visibleTables = await p.evaluate(
    () => [...document.querySelectorAll('table:not([hidden])')].filter((t) => t.getBoundingClientRect().width > 0).length,
  );
  record(`${vp.name}: the 7-column table is NOT rendered`, visibleTables === 0, `${visibleTables} visible tables`);

  const overflow = await p.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  record(`${vp.name}: no horizontal scrolling`, overflow <= 1, `${overflow}px`);

  const cards = await p.locator('a[href^="/topics/"], a[href="/ideas"]').count();
  record(`${vp.name}: renders tappable cards instead`, cards > 0, `${cards} cards`);

  if (vp.width <= 430) {
    const small = await p.evaluate(() =>
      [...document.querySelectorAll('main a')]
        .map((a) => a.getBoundingClientRect())
        .filter((r) => r.height > 0 && r.height < 40).length,
    );
    record(`${vp.name}: card touch targets are at least 40px`, small === 0, `${small} undersized`);
  }
  if (SHOTS) await p.screenshot({ path: `${SHOT_DIR}/cards-${vp.name}.png`, fullPage: true });
  await c.close();
}

// ---------------------------------------------------------------------------
heading('C. Behaviour');
{
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders });
  await c.addCookies(cookies);
  const p = await c.newPage();

  await p.goto(`${BASE}/topics`, { waitUntil: 'networkidle' });
  record('cards remain the default view', (await p.locator(REAL_TABLES).count()) === 0);

  await p.goto(`${BASE}/topics?view=table`, { waitUntil: 'networkidle' });
  await settled(p);
  record('the table toggle works by URL', (await p.locator(REAL_TABLES).count()) === 7);

  const { data: topics } = await admin.from('topics').select('name,status').is('deleted_at', null);
  const body = await p.locator('body').innerText();
  const missing = topics.filter((t) => !body.includes(t.name));
  record('every live topic appears', missing.length === 0, missing.map((t) => t.name).join(', ') || `${topics.length} topics`);

  await p.goto(`${BASE}/topics?view=table&q=pigeon`, { waitUntil: 'networkidle' });
  await settled(p);
  const searched = await p.locator('tbody tr').allInnerTexts();
  record(
    'search narrows the rows',
    searched.some((r) => /pigeon/i.test(r)) && searched.filter((r) => !/No projects/.test(r)).length < topics.length,
    `${searched.filter((r) => !/No projects/.test(r)).length} matching rows`,
  );

  await p.goto(`${BASE}/topics?view=table&status=active`, { waitUntil: 'networkidle' });
  await settled(p, { filtered: true });
  record('status filter renders a single section', (await p.locator(REAL_TABLES).count()) === 1);

  await p.goto(`${BASE}/topics?view=table`, { waitUntil: 'networkidle' });
  await settled(p);
  const first = p.locator('tbody tr a[href^="/topics/"]').first();
  const href = await first.getAttribute('href');
  await first.click();
  // waitForLoadState resolves before the client router updates the URL, which
  // read as "the link does not work" when it does. Wait for the URL itself.
  const navigated = await p
    .waitForURL((u) => u.pathname === href, { timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  record('clicking a project opens its Topic page', navigated, new URL(p.url()).pathname);

  const err = await p.locator('body').innerText();
  record('no raw driver error anywhere', !/PGRST|violates|duplicate key/i.test(err));
  await c.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('\nFAILURES:');
  for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  process.exit(1);
}
