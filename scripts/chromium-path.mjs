/**
 * Resolve a usable Chromium for Playwright.
 *
 * Playwright pins an exact browser build per release and refuses to start if
 * that build is absent. An image that ships its own Chromium (as this sandbox
 * does, under PLAYWRIGHT_BROWSERS_PATH) will therefore be rejected the moment
 * the npm-pinned Playwright version moves ahead of it — the error says to run
 * `npx playwright install`, which is exactly what such an image sets
 * PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD to prevent.
 *
 * So: use Playwright's own resolution when it works, and fall back to whatever
 * Chromium the image does provide. Returns null when the default is fine, which
 * is what `launch()` wants for `executablePath`.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'].filter(Boolean);

const CANDIDATE_SUFFIXES = [
  'chrome-linux/chrome',
  'chrome-linux/headless_shell',
  'chrome-headless-shell-linux64/chrome-headless-shell',
];

/** @returns {string|null} an explicit executable path, or null to use the default */
export function chromiumExecutable() {
  for (const root of ROOTS) {
    if (!existsSync(root)) continue;
    let entries;
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    // Prefer full chromium over the headless shell: the shell cannot do
    // anything requiring a real browser UI surface.
    const ordered = [
      ...entries.filter((e) => /^chromium-\d+$/.test(e)),
      ...entries.filter((e) => /^chromium_headless_shell-\d+$/.test(e)),
      ...entries.filter((e) => e === 'chromium'),
    ];
    for (const entry of ordered) {
      for (const suffix of CANDIDATE_SUFFIXES) {
        const candidate = join(root, entry, suffix);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

/**
 * Launch options that work whether or not the pinned build is present.
 *
 * Chromium does not read HTTPS_PROXY, so in a sandbox that reaches the
 * internet only through one it resets every connection while curl on the same
 * host succeeds. Passing the proxy explicitly is what makes a hosted URL
 * reachable from a test browser. Loopback stays direct so a local dev server
 * is not routed through it.
 */
export function launchOptions(extra = {}) {
  const executablePath = chromiumExecutable();
  const proxyServer = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? null;
  return {
    ...(executablePath ? { executablePath } : {}),
    ...(proxyServer
      ? { proxy: { server: proxyServer, bypass: 'localhost,127.0.0.1,::1' } }
      : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    ...extra,
  };
}
