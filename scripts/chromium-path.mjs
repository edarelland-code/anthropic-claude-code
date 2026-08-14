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
import { X509Certificate, createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
 * The public-key fingerprints of the CA bundle this environment provides.
 *
 * The proxy re-signs some hosts with its own CA and passes others through, and
 * which is which can change between runs — a validation run that succeeded an
 * hour earlier failed mid-way with ERR_CERT_AUTHORITY_INVALID when a host it
 * had been tunnelling started being intercepted. Every other tool here is
 * already told to trust that CA (curl through CURL_CA_BUNDLE, Node through
 * NODE_EXTRA_CA_CERTS, the JVM through its truststore). Chromium reads none of
 * them: it reads the NSS database, and populating that needs `certutil`, which
 * is not installed.
 *
 * `--ignore-certificate-errors-spki-list` is the lever Chromium does give.
 * Despite the name it is not `--ignore-certificate-errors`: it names EXACT
 * public keys to accept and disables nothing globally, which is the same thing
 * installing the CA would do.
 *
 * Read from the bundle at launch rather than hard-coded, so a rotated CA is
 * picked up automatically and no fingerprint can go stale. Nothing outside
 * that bundle is trusted, and if the bundle is absent nothing is pinned.
 */
function caBundleSpki() {
  const path =
    process.env.NODE_EXTRA_CA_CERTS ??
    process.env.CURL_CA_BUNDLE ??
    process.env.SSL_CERT_FILE ??
    '/root/.ccr/ca-bundle.crt';
  if (!existsSync(path)) return [];
  let pem;
  try {
    pem = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  const out = new Set();
  for (const block of blocks) {
    try {
      const spki = new X509Certificate(block).publicKey.export({ type: 'spki', format: 'der' });
      out.add(createHash('sha256').update(spki).digest('base64'));
    } catch {
      // A bundle entry Node cannot parse is skipped rather than fatal — the
      // rest of the bundle is still worth trusting.
    }
  }
  return [...out];
}

/**
 * Launch options that work whether or not the pinned build is present.
 *
 * Three accommodations, all needed only because the sandbox reaches the
 * internet through a proxy.
 *
 * 1. Chromium does not read HTTPS_PROXY. Without being told, it fails every
 *    request while curl on the same host succeeds. Loopback stays direct so a
 *    local dev server is not routed through the proxy.
 *
 * 2. Chromium's TLS 1.3 ClientHello carries a post-quantum key share and comes
 *    to roughly 1700 bytes, which spans more than one TCP segment. The relay
 *    on the far side of this proxy resets the connection when it does, so the
 *    tunnel is established (`200 Connection Established`) and then dies mid
 *    handshake — surfacing as a bare ERR_CONNECTION_RESET on a URL curl
 *    fetches perfectly, with nothing in the proxy's own log. Capping at TLS
 *    1.2 keeps the ClientHello inside one segment.
 *
 *    Verified rather than guessed: the net log shows a 1733-byte ClientHello
 *    followed immediately by ECONNRESET, and every narrower fix
 *    (--disable-features for the post-quantum key agreement under each of its
 *    names, ECH off, HTTP/2 off, QUIC off) leaves it failing.
 *
 *    This lowers the TLS version a *test* browser negotiates with our own
 *    deployment. It does NOT disable certificate verification — the chain,
 *    hostname and expiry are all still checked, and a bad certificate still
 *    fails the run. It is applied only when a proxy is configured, so a normal
 *    machine negotiates TLS 1.3 as usual.
 *
 * 3. Chromium does not trust the proxy's CA, because it reads NSS and nothing
 *    else. See caBundleSpki() above.
 */
export function launchOptions(extra = {}) {
  const executablePath = chromiumExecutable();
  const proxyServer = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? null;
  const spki = proxyServer ? caBundleSpki() : [];
  return {
    ...(executablePath ? { executablePath } : {}),
    ...(proxyServer
      ? { proxy: { server: proxyServer, bypass: 'localhost,127.0.0.1,::1' } }
      : {}),
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      ...(proxyServer ? ['--ssl-version-max=tls1.2'] : []),
      ...(spki.length ? [`--ignore-certificate-errors-spki-list=${spki.join(',')}`] : []),
    ],
    ...extra,
  };
}
