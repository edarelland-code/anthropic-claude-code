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

import { launchOptions } from './chromium-path.mjs';

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
  // Phase 2 memory surfaces.
  { path: '/timeline', name: 'timeline', auth: true },
  { path: '/timeline?filter=decisions', name: 'timeline-filtered', auth: true },
  { path: '/decisions', name: 'decisions', auth: true },
  { path: '/ideas', name: 'ideas', auth: true },
  { path: '/prompts', name: 'prompts', auth: true },
  // Phase 3 capture and retrieval surfaces.
  { path: '/search', name: 'search', auth: true },
  { path: '/search?q=icon', name: 'search-results', auth: true },
  { path: '/search?q=icon&type=decisions&state=current', name: 'search-filtered', auth: true },
  { path: '/files', name: 'files', auth: true },
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
    // Report the elements that stick out of THEIR OWN PARENT, which is the
    // only precise definition of where the layout breaks.
    //
    // Two earlier versions of this got it wrong in opposite directions.
    // Listing the first elements past the viewport in document order named the
    // outermost containers, so every overflow read as "the card is too wide".
    // Listing the narrowest named leaves — a 19px "0%", a 2px SVG circle —
    // that were merely carried past the edge by an ancestor. Neither points at
    // the element to fix.
    //
    // An element wider than its parent's content box is the break point, and
    // min-content says why: when it equals the width, the element refused to
    // shrink, which is a flex or grid item without min-w-0 almost every time.
    const culprits = await page.evaluate((limit) => {
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= limit + 1) continue;
        const parent = el.parentElement;
        if (!parent) continue;
        const pr = parent.getBoundingClientRect();
        const ps = getComputedStyle(parent);
        const inner = pr.right - parseFloat(ps.paddingRight || '0') - parseFloat(ps.borderRightWidth || '0');
        if (r.right <= inner + 1) continue; // carried along, not the break

        const probe = el.style.width;
        el.style.width = 'min-content';
        const min = Math.round(el.getBoundingClientRect().width);
        el.style.width = probe;

        const cls = (el.className || '').toString().slice(0, 44);
        const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 26);
        out.push(
          `${el.tagName.toLowerCase()}.${cls} w=${Math.round(r.width)} min=${min} ` +
          `parent=${parent.tagName.toLowerCase()}.${(parent.className || '').toString().slice(0, 28)} ` +
          `(${Math.round(inner - pr.left)}) "${text}"`,
        );
        if (out.length >= 3) break;
      }
      return out.length ? out : ['no element exceeds its parent — the page itself is wider than the viewport'];
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
  //
  // What is measured is the area a thumb can actually hit, which is not always
  // the control's own box. A visually-hidden radio inside a label — the pattern
  // behind the search filter chips — is a 1px input wrapped in a 44px target,
  // and flagging the input would be measuring the wrong rectangle.
  //
  // The substitution is deliberately narrow: the label has to genuinely contain
  // or point at the control, and the LABEL's box then has to pass on its own.
  // A hidden control with no label, or with a label that is also too small,
  // still fails — so this cannot be used to hide a real defect.
  if (vp.width <= 430) {
    const small = await page.evaluate((min) => {
      const out = [];
      const hitBox = (el) => {
        const own = el.getBoundingClientRect();
        if (own.height >= min) return own;
        const label =
          el.closest('label') ??
          (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
        return label ? label.getBoundingClientRect() : own;
      };
      for (const el of document.querySelectorAll('button, a[href], select, input:not([type=hidden])')) {
        const own = el.getBoundingClientRect();
        if (own.width === 0 || own.height === 0) continue;
        const r = hitBox(el);
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

/*
 * One launcher, shared with validate-hosted.mjs.
 *
 * This file used to carry its own copy, which resolved a Chromium binary but
 * knew nothing about the proxy. That made it work on a machine with direct
 * internet and fail with ERR_CONNECTION_RESET behind one — while the harness
 * that spawns it succeeded on the same URLs, because only that half had been
 * taught about the proxy. Two copies of "how do we start a browser" is one
 * copy too many.
 */
const browser = await chromium.launch(launchOptions());

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
