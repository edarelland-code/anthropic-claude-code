/**
 * Responsive QA: drives a real Chromium against a running dev/production
 * server at the viewports in the Phase 1 checklist, and asserts the things
 * that actually break layouts — horizontal overflow, undersized touch targets,
 * and navigation appearing at the wrong breakpoint.
 *
 *   node scripts/responsive-qa.mjs [baseUrl] [--screenshots]
 *
 * Pages requiring a session are skipped unless CONTEXTSHELF_QA_COOKIE is set,
 * and the run reports exactly which pages it could not reach so a pass is
 * never mistaken for full coverage.
 */

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://127.0.0.1:3000';
const SHOTS = process.argv.includes('--screenshots');
const SHOT_DIR = process.env.QA_SHOT_DIR ?? '/tmp/contextshelf-qa';

const VIEWPORTS = [
  { name: 'desktop-1440', width: 1440, height: 900 },
  { name: 'desktop-1280', width: 1280, height: 800 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'mobile-375', width: 375, height: 667 },
];

const PAGES = [
  { path: '/setup', name: 'setup', auth: false },
  { path: '/login', name: 'login', auth: false },
  { path: '/login?error=Email+link+is+invalid+or+has+expired', name: 'login-error', auth: false },
  { path: '/home', name: 'home', auth: true },
  { path: '/topics', name: 'topics', auth: true },
  { path: '/topics/new', name: 'topic-new', auth: true },
  { path: '/inbox', name: 'inbox', auth: true },
  { path: '/settings', name: 'settings', auth: true },
];

const MIN_TOUCH = 40; // px; below this a control is awkward on a phone

const failures = [];
const skipped = [];
let checks = 0;

function fail(msg) {
  failures.push(msg);
}

async function auditPage(page, vp, spec) {
  const url = `${BASE}${spec.path}`;
  const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 });
  const status = response?.status() ?? 0;
  const landed = new URL(page.url()).pathname;

  if (spec.auth && (landed === '/login' || landed === '/setup')) {
    skipped.push(`${spec.name} @ ${vp.name} — redirected to ${landed} (no session)`);
    return;
  }
  if (status >= 500) {
    fail(`${spec.name} @ ${vp.name}: HTTP ${status}`);
    return;
  }

  checks++;

  // 1. The page body must never scroll sideways.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 1) {
    const culprits = await page.evaluate((limit) => {
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > limit + 1) {
          out.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 60)}`);
        }
        if (out.length >= 3) break;
      }
      return out;
    }, vp.width);
    fail(`${spec.name} @ ${vp.name}: ${overflow}px horizontal overflow — ${culprits.join(' | ')}`);
  }

  // 2. Navigation must match the breakpoint.
  const sidebarVisible = await page.locator('aside nav[aria-label="Primary"]').first().isVisible().catch(() => false);
  const bottomNavVisible = await page.locator('nav[aria-label="Primary"].fixed').first().isVisible().catch(() => false);

  if (!spec.auth) {
    // Unauthenticated pages have no app chrome at all.
  } else if (vp.width >= 1024) {
    if (!sidebarVisible) fail(`${spec.name} @ ${vp.name}: desktop sidebar missing`);
    if (bottomNavVisible) fail(`${spec.name} @ ${vp.name}: bottom nav showing on desktop`);
  } else {
    if (!bottomNavVisible) fail(`${spec.name} @ ${vp.name}: mobile bottom nav missing`);
    if (sidebarVisible) fail(`${spec.name} @ ${vp.name}: desktop sidebar showing on mobile`);
  }

  // 3. Touch targets on phone widths.
  if (vp.width <= 430) {
    const small = await page.evaluate((min) => {
      const out = [];
      for (const el of document.querySelectorAll('button, a[href], select, input:not([type=hidden])')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.height < min) {
          out.push(`${el.tagName.toLowerCase()}"${(el.textContent || '').trim().slice(0, 24)}" ${Math.round(r.height)}px`);
        }
      }
      return out.slice(0, 5);
    }, MIN_TOUCH);
    if (small.length) {
      fail(`${spec.name} @ ${vp.name}: touch targets under ${MIN_TOUCH}px — ${small.join(', ')}`);
    }
  }

  // 4. Content must not sit under the fixed bottom nav.
  if (vp.width < 1024 && spec.auth) {
    const clipped = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Primary"].fixed');
      if (!nav) return false;
      const navTop = nav.getBoundingClientRect().top;
      const main = document.querySelector('main');
      if (!main) return false;
      const style = getComputedStyle(main);
      return parseFloat(style.paddingBottom) < window.innerHeight - navTop;
    });
    if (clipped) fail(`${spec.name} @ ${vp.name}: main content can slide under the bottom nav`);
  }

  if (SHOTS) {
    await page.screenshot({ path: `${SHOT_DIR}/${spec.name}-${vp.name}.png`, fullPage: true });
  }
}

/**
 * Prefer an explicit binary (CHROMIUM_PATH), then any Chromium already present
 * under PLAYWRIGHT_BROWSERS_PATH, then Playwright's own download. The
 * pre-installed build often differs from the one the npm package expects, so
 * launching by path avoids a pointless re-download.
 */
async function launchChromium() {
  const roots = [process.env.CHROMIUM_PATH].filter(Boolean);
  const browsersDir = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  try {
    const { readdirSync, existsSync } = await import('node:fs');
    for (const dir of readdirSync(browsersDir).filter((d) => d.startsWith('chromium-'))) {
      const candidate = `${browsersDir}/${dir}/chrome-linux/chrome`;
      if (existsSync(candidate)) roots.push(candidate);
    }
  } catch {
    // No pre-installed browsers; fall through to Playwright's own.
  }

  for (const executablePath of roots) {
    try {
      return await chromium.launch({ executablePath });
    } catch {
      // Try the next candidate.
    }
  }
  return chromium.launch();
}

const browser = await launchChromium();

if (SHOTS) await mkdir(SHOT_DIR, { recursive: true });

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.width <= 430,
    hasTouch: vp.width <= 768,
  });
  if (process.env.CONTEXTSHELF_QA_COOKIE) {
    await context.addCookies(JSON.parse(process.env.CONTEXTSHELF_QA_COOKIE));
  }
  const page = await context.newPage();
  for (const spec of PAGES) {
    try {
      await auditPage(page, vp, spec);
    } catch (cause) {
      fail(`${spec.name} @ ${vp.name}: ${cause.message}`);
    }
  }
  await context.close();
}

await browser.close();

console.log(`\nresponsive QA: ${checks} page/viewport combinations audited across ${VIEWPORTS.length} viewports`);
if (skipped.length) {
  console.log(`\n${skipped.length} skipped (require a signed-in session):`);
  for (const s of new Set(skipped.map((s) => s.split(' — ')[0].split(' @ ')[0]))) console.log(`  - ${s}`);
  console.log('  Set CONTEXTSHELF_QA_COOKIE to a serialised session to include these.');
}
if (failures.length) {
  console.log(`\n${failures.length} FAILURES:`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
console.log('\nno layout failures');
