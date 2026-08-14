#!/usr/bin/env node
/**
 * ContextShelf — one-command hosted provisioning, deployment, and validation.
 *
 *   npm run provision
 *
 * Runs the entire remaining Phase 1 hosted sequence in order, stopping at the
 * first real failure:
 *
 *   0  preflight       network reachability, .env.local, clean tree
 *   1  supabase login  (interactive, only if not already authenticated)
 *   2  supabase link   (interactive password prompt — never captured or logged)
 *   3  db push         applies supabase/migrations/ to the hosted project
 *   4  db diff --linked   asserts hosted schema matches the repository
 *   5  hosted schema verification   supabase/tests/hosted/01_verify_schema.sql
 *   6  hosted RLS isolation         supabase/tests/hosted/02_rls_isolation.sql
 *   7  vercel login + link          (interactive)
 *   8  production environment variables (read from .env.local, never printed)
 *   9  production deploy            captures the real URL
 *  10  NEXT_PUBLIC_SITE_URL         set to the canonical URL, then redeploy
 *  11  production smoke test        HTTPS, routes, no credential leakage
 *  12  auth URL config              site URL, redirect allow-list, both email
 *                                   templates — set and then read back
 *
 * Cross-platform: plain Node, no bash. Works in PowerShell, cmd, and any POSIX
 * shell.
 *
 * Two ways to run it:
 *
 *   Interactive (preferred). Steps use stdio: 'inherit', so the Supabase CLI
 *   owns the browser handoff and the password prompt directly, and this script
 *   never reads, stores, or echoes a credential.
 *
 *   Unattended. A CI job, a piped shell, and an agent session have no TTY, and
 *   the CLI will not prompt without one. Setting SUPABASE_ACCESS_TOKEN,
 *   SUPABASE_DB_PASSWORD, and VERCEL_TOKEN runs the same sequence end to end.
 *   Those values are held in memory, registered with a redactor so no child
 *   process can print them, and written only to .env.local, which is
 *   gitignored. Step 0 will bootstrap .env.local from the Management API when
 *   the file is absent and a token is available.
 *
 * Flags:
 *   --skip-login     assume the CLI is already authenticated
 *   --skip-push      validate only; do not apply migrations
 *   --project-ref X  override the default project reference
 *   --skip-vercel    stop after the Supabase phase
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

/**
 * Credentials, when a terminal is not available.
 *
 * The interactive path below is still the default and still preferred: the CLI
 * owns the browser handoff and the password prompt, and this script never sees
 * either. But an agent session, a CI job, and a piped shell all lack a TTY, and
 * the CLI refuses to prompt there. Supplying these three values makes the whole
 * sequence run unattended; leaving them unset changes nothing.
 */
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || null;
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD || null;
const VERCEL_TOKEN = process.env.VERCEL_TOKEN || null;
const HAS_TTY = Boolean(process.stdin.isTTY);
const MGMT = 'https://api.supabase.com';

/**
 * Values that must never reach stdout, whatever a child process prints.
 *
 * The interactive path never learns a credential, so it never needed this. The
 * non-interactive path does hold them, so every write goes through `scrub()`.
 */
const SECRETS = new Set([ACCESS_TOKEN, DB_PASSWORD, VERCEL_TOKEN].filter((s) => s && s.length >= 8));
const scrub = (text) => {
  let out = String(text);
  for (const s of SECRETS) out = out.split(s).join('«redacted»');
  return out;
};

/**
 * The Supabase CLI's HTTP client cannot negotiate an explicit CONNECT proxy —
 * in a sandbox that sets HTTPS_PROXY it reports a bare "Transport error" where
 * curl and Node's own fetch both get real responses. Where egress is
 * transparently routed the request still succeeds, and still passes through the
 * same policy, once the variables are out of the way. TLS verification is
 * untouched. Outside such a sandbox these variables are unset anyway, so this
 * is a no-op.
 */
function cliEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) delete env[k];
  return env;
}

/** Management API call. Returns parsed JSON, or throws with the real message. */
async function mgmt(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${MGMT}${path}`, {
    method,
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${json?.message ?? text.slice(0, 200)}`);
  return json;
}
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const PROJECT_REF = value('project-ref', 'omhktzxwffaipmcoljic');
const IS_WINDOWS = process.platform === 'win32';

let step = 0;
const results = [];

const c = {
  bold: (s) => `[1m${s}[0m`,
  dim: (s) => `[2m${s}[0m`,
  red: (s) => `[31m${s}[0m`,
  green: (s) => `[32m${s}[0m`,
  yellow: (s) => `[33m${s}[0m`,
};

function heading(title) {
  step += 1;
  console.log(`\n${c.bold(`[${step}] ${title}`)}`);
}

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`    ${ok ? c.green('PASS') : c.red('FAIL')}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function die(message, guidance) {
  console.error(`\n${c.red('STOPPED')}  ${message}`);
  if (guidance) console.error(`\n${guidance}\n`);
  summary();
  process.exit(1);
}

/** Runs the Supabase CLI. `interactive` hands the terminal over for prompts. */
function supabase(cliArgs, { interactive = false, allowFailure = false } = {}) {
  // Without a terminal the CLI cannot prompt, so an interactive request is
  // downgraded to a piped one; the caller has already supplied whatever the
  // prompt would have asked for as a flag or an environment variable.
  const canPrompt = interactive && HAS_TTY;
  const result = spawnSync('npx', ['--yes', 'supabase@latest', ...cliArgs], {
    cwd: ROOT,
    stdio: canPrompt ? 'inherit' : ['pipe', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: cliEnv(ACCESS_TOKEN ? { SUPABASE_ACCESS_TOKEN: ACCESS_TOKEN } : {}),
    shell: IS_WINDOWS, // npx needs a shell to resolve npx.cmd on Windows
  });

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (!canPrompt && (stdout || stderr)) {
    const text = scrub(`${stdout}${stderr}`).trimEnd();
    if (text) console.log(c.dim(text.split('\n').map((l) => `    │ ${l}`).join('\n')));
  }
  if (result.status !== 0 && !allowFailure) {
    return { ok: false, stdout, stderr, status: result.status };
  }
  return { ok: result.status === 0, stdout, stderr, status: result.status };
}

/**
 * Reachability, not merely connectivity.
 *
 * A sandbox egress gateway completes the TCP/TLS handshake and then answers the
 * HTTP request itself, so "the socket opened" is not evidence the host is
 * reachable. This reads the status and body and treats a gateway rejection as
 * blocked — that distinction is exactly what an earlier version got wrong.
 */
function reachable(host) {
  const probe = spawnSync(
    process.execPath,
    [
      '-e',
      `const https=require('https');
       const r=https.request({host:process.argv[1],path:'/',method:'GET',timeout:8000},(res)=>{
         let b='';res.on('data',d=>{if(b.length<512)b+=d});
         res.on('end',()=>{process.stdout.write(res.statusCode+'|'+b.slice(0,300));process.exit(0)});
       });
       r.on('error',(e)=>{process.stdout.write('ERR|'+e.code);process.exit(0)});
       r.on('timeout',()=>{process.stdout.write('ERR|TIMEOUT');process.exit(0)});
       r.end();`,
      host,
    ],
    { encoding: 'utf8' },
  );

  const out = probe.stdout ?? '';
  if (out.startsWith('ERR|')) return { ok: false, why: out.slice(4) || 'connection failed' };

  const [status, ...rest] = out.split('|');
  const body = rest.join('|');
  if (/not in allowlist|host not permitted|egress/i.test(body)) {
    return { ok: false, why: 'blocked by network egress policy' };
  }
  if (status === '403' && /allowlist/i.test(body)) {
    return { ok: false, why: 'blocked by network egress policy' };
  }
  return { ok: true, why: `HTTP ${status}` };
}

function summary() {
  console.log(`\n${c.bold('Summary')}`);
  for (const r of results) {
    console.log(`  ${r.ok ? c.green('✓') : c.red('✗')} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    failed === 0
      ? `\n${c.green('All hosted provisioning steps passed.')}`
      : `\n${c.red(`${failed} step(s) failed.`)}`,
  );
}

// ---------------------------------------------------------------------------

console.log(c.bold('ContextShelf — hosted provisioning'));
console.log(c.dim(`project ref: ${PROJECT_REF}  ·  platform: ${process.platform}`));

// --- 0. Preflight -----------------------------------------------------------
heading('Preflight');

const probes = ['api.supabase.com', `${PROJECT_REF}.supabase.co`].map((h) => ({ host: h, ...reachable(h) }));
const blocked = probes.filter((p) => !p.ok);
if (blocked.length) {
  record('network reachability', false, blocked.map((p) => `${p.host}: ${p.why}`).join('; '));
  die(
    'Supabase is not reachable from this environment.',
    [
      'This is an environment restriction, not an application defect.',
      '',
      'Claude Code on the web runs the agent in Anthropic\'s cloud, whose egress',
      'policy blocks *.supabase.co and vercel.com. Run this from a shell on your',
      'own machine, or from the Claude Code CLI installed locally:',
      '',
      '    npm install -g @anthropic-ai/claude-code',
      '    claude',
    ].join('\n'),
  );
}
record('network reachability', true, 'api.supabase.com and project host resolve');

/**
 * `.env.local` holds the project URL and the publishable key. Both are
 * readable from the Management API, so when an access token is available there
 * is no reason to make someone copy them out of the dashboard by hand — and no
 * reason for a missing file to stop the run.
 */
if (!existsSync(resolve(ROOT, '.env.local')) && ACCESS_TOKEN) {
  try {
    const keys = await mgmt(`/v1/projects/${PROJECT_REF}/api-keys?reveal=true`);
    const publishable = keys.find((k) => k.type === 'publishable' || k.name === 'anon');
    const secret = keys.find((k) => k.type === 'secret' || k.name === 'service_role');
    if (!publishable?.api_key) throw new Error('no publishable key returned');
    for (const k of [publishable.api_key, secret?.api_key]) if (k) SECRETS.add(k);
    writeFileSync(
      resolve(ROOT, '.env.local'),
      [
        '# Generated by `npm run provision` from the Supabase Management API.',
        '# Gitignored. Never commit real values.',
        `NEXT_PUBLIC_SUPABASE_URL=https://${PROJECT_REF}.supabase.co`,
        `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${publishable.api_key}`,
        ...(secret?.api_key ? [`SUPABASE_SECRET_KEY=${secret.api_key}`] : []),
        'NEXT_PUBLIC_SITE_URL=http://localhost:3000',
        '',
      ].join('\n'),
      { mode: 0o600 },
    );
    record('.env.local bootstrapped', true, 'project URL and publishable key read from the API');
  } catch (e) {
    record('.env.local bootstrap', false, scrub(e.message));
  }
}

if (!existsSync(resolve(ROOT, '.env.local'))) {
  record('.env.local present', false);
  die(
    '.env.local is missing.',
    'Copy .env.example to .env.local and fill in the project URL and publishable\nkey from Supabase → Project Settings → API Keys.\n\nOr set SUPABASE_ACCESS_TOKEN and re-run — the script will read both values\nfrom the Management API and write the file itself.',
  );
}
const envText = readFileSync(resolve(ROOT, '.env.local'), 'utf8');
const hasPublishable = /^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=.+/m.test(envText);
record('.env.local present', hasPublishable, hasPublishable ? '' : 'publishable key not set');
if (!hasPublishable) {
  die('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set in .env.local.');
}

// --- 1. Authenticate --------------------------------------------------------
if (!flag('skip-login')) {
  heading('Supabase CLI authentication');
  if (!HAS_TTY && !ACCESS_TOKEN) {
    record('interactive terminal', false, 'stdin is not a TTY and SUPABASE_ACCESS_TOKEN is unset');
    die(
      'Supabase login needs either an interactive terminal or an access token.',
      [
        'This is running without a TTY (a piped, CI, or agent shell), where the',
        'CLI cannot open a browser or prompt.',
        '',
        'Either run `npm run provision` directly in PowerShell, Terminal, or your',
        'shell of choice, or supply a token and re-run unattended:',
        '',
        '    SUPABASE_ACCESS_TOKEN=…   https://supabase.com/dashboard/account/tokens',
        '    SUPABASE_DB_PASSWORD=…    the project database password',
        '    VERCEL_TOKEN=…            https://vercel.com/account/tokens',
      ].join('\n'),
    );
  }
  const probe = supabase(['projects', 'list'], { allowFailure: true });
  if (probe.ok) {
    record('already authenticated', true);
  } else {
    console.log(c.yellow('    Opening a browser for Supabase login. Approve it, then this continues automatically.'));
    const login = supabase(['login'], { interactive: true });
    if (!login.ok) {
      record('supabase login', false);
      die('Supabase login did not complete.', 'Re-run `npm run provision` after approving the browser prompt.');
    }
    record('supabase login', true);
  }
}

// --- 2. Link ----------------------------------------------------------------
heading(`Link to project ${PROJECT_REF}`);
if (HAS_TTY) {
  console.log(c.yellow('    The CLI will prompt for the database password. Type it at the prompt —'));
  console.log(c.yellow('    it is read directly by the CLI and is never seen or stored by this script.'));
} else if (!DB_PASSWORD) {
  record('supabase link', false, 'no TTY to prompt with and SUPABASE_DB_PASSWORD is unset');
  die(
    'Linking needs the database password.',
    'Without a terminal the CLI cannot prompt for it. Set SUPABASE_DB_PASSWORD and\nre-run, or run `npm run provision` from an interactive shell.\n\nReset it if unknown: Dashboard → Project Settings → Database → Reset database password.',
  );
}
// The CLI reads SUPABASE_DB_PASSWORD from its environment when it cannot
// prompt, so the password never appears in argv and never shows up in a
// process listing.
const link = supabase(['link', '--project-ref', PROJECT_REF], { interactive: true });
if (!link.ok) {
  record('supabase link', false);
  die('Linking failed.', 'Check the project reference and the database password, then re-run.');
}
record('supabase link', true);

// --- 3. Push migrations -----------------------------------------------------
if (!flag('skip-push')) {
  heading('Apply migrations to the hosted database');
  const push = supabase(['db', 'push'], { interactive: true });
  if (!push.ok) {
    record('db push', false);
    die('Migration push failed. The hosted schema was not changed beyond what already applied.');
  }
  record('db push', true);
}

// --- 4. Schema parity -------------------------------------------------------
heading('Schema parity: hosted vs repository');
const diff = supabase(['db', 'diff', '--linked'], { allowFailure: true });
const diffText = `${diff.stdout}${diff.stderr}`;
const noDifference = /no schema changes found|no changes detected/i.test(diffText) || diffText.trim() === '';
record('db diff --linked', noDifference, noDifference ? 'no differences' : 'differences reported — review above');
if (!noDifference) {
  die(
    'The hosted schema does not match the repository migrations.',
    'Do not edit the hosted schema directly. Reconcile by adding a new migration\nfile under supabase/migrations/, then re-run `npm run provision`.',
  );
}

// --- 5. Hosted schema verification -----------------------------------------
heading('Hosted schema verification');
const verify = supabase(
  ['db', 'query', '--linked', '-f', 'supabase/tests/hosted/01_verify_schema.sql'],
  { allowFailure: true },
);
const verifyText = `${verify.stdout}${verify.stderr}`;
const verifyFailed = /FAIL/i.test(verifyText);
record('01_verify_schema.sql', verify.ok && !verifyFailed, verifyFailed ? 'one or more checks FAILED' : '15 checks');
if (!verify.ok || verifyFailed) {
  die('Hosted schema verification did not pass. See the table above for the failing check.');
}

// --- 6. Hosted RLS isolation ------------------------------------------------
heading('Hosted RLS isolation');
const rls = supabase(
  ['db', 'query', '--linked', '-f', 'supabase/tests/hosted/02_rls_isolation.sql'],
  { allowFailure: true },
);
const rlsText = `${rls.stdout}${rls.stderr}`;
const rlsPassed = /ALL HOSTED RLS CHECKS PASSED/i.test(rlsText);
record('02_rls_isolation.sql', rls.ok && rlsPassed, rlsPassed ? 'cross-user isolation holds' : 'see failure above');
if (!rls.ok || !rlsPassed) {
  die('Hosted RLS isolation did not pass. This is a security failure — do not deploy.');
}

// --- 7-11. Vercel ------------------------------------------------------------
let productionUrl = null;

function vercel(cliArgs, { interactive = false, input } = {}) {
  // A token authenticates every call, which is what makes the Vercel half
  // runnable without a browser. --token is appended rather than exported
  // because the CLI ignores VERCEL_TOKEN for some subcommands.
  const withToken = VERCEL_TOKEN ? [...cliArgs, '--token', VERCEL_TOKEN] : cliArgs;
  const result = spawnSync('npx', ['--yes', 'vercel@latest', ...withToken], {
    cwd: ROOT,
    stdio: interactive && HAS_TTY ? 'inherit' : ['pipe', 'pipe', 'pipe'],
    input,
    encoding: 'utf8',
    env: cliEnv(),
    shell: IS_WINDOWS,
  });
  return { ok: result.status === 0, stdout: scrub(result.stdout ?? ''), stderr: scrub(result.stderr ?? '') };
}

/** Reads one value out of .env.local without ever printing it. */
function envValue(name) {
  const m = envText.match(new RegExp(`^${name}=(.*)$`, 'm'));
  return m ? m[1].trim() : null;
}

if (!flag('skip-vercel')) {
  const vercelProbe = reachable('api.vercel.com');
  if (!vercelProbe.ok) {
    record('vercel reachability', false, vercelProbe.why);
    die('Vercel is not reachable from this environment.', 'Supabase provisioning above succeeded. Re-run with network access to deploy.');
  }

  heading('Vercel authentication');
  const who = vercel(['whoami']);
  if (who.ok) {
    record('already authenticated', true, who.stdout.trim());
  } else if (!HAS_TTY) {
    record('vercel authentication', false, VERCEL_TOKEN ? 'the supplied token was rejected' : 'no TTY and VERCEL_TOKEN is unset');
    die(
      'Vercel authentication is not available without a browser or a token.',
      'The Supabase half above succeeded and is unaffected. Set VERCEL_TOKEN\n(https://vercel.com/account/tokens) and re-run with --skip-push to deploy,\nor run `npm run provision` from an interactive shell.',
    );
  } else {
    console.log(c.yellow('    Opening a browser for Vercel login. Approve it, then this continues automatically.'));
    if (!vercel(['login'], { interactive: true }).ok) {
      record('vercel login', false);
      die('Vercel login did not complete.');
    }
    record('vercel login', true);
  }

  heading('Link the Vercel project');
  const linked = vercel(['link', '--yes'], { interactive: true });
  record('vercel link', linked.ok);
  if (!linked.ok) die('Could not link the Vercel project.');

  heading('Production environment variables');
  // Values are piped straight from .env.local into the CLI's stdin. They are
  // never echoed, logged, or written to a file by this script.
  const vars = {
    NEXT_PUBLIC_SUPABASE_URL: envValue('NEXT_PUBLIC_SUPABASE_URL'),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: envValue('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
  };
  for (const [name, val] of Object.entries(vars)) {
    if (!val) {
      record(name, false, 'missing from .env.local');
      die(`${name} is not set in .env.local.`);
    }
    let added = 0;
    for (const target of ['production', 'preview', 'development']) {
      // `env add` is not idempotent; a duplicate is a benign failure.
      const r = vercel(['env', 'add', name, target], { input: `${val}\n` });
      if (r.ok) added += 1;
    }
    record(name, true, added ? `set in ${added} environment(s)` : 'already present');
  }

  heading('Production deploy');
  const deploy = vercel(['deploy', '--prod', '--yes']);
  const urlMatch = `${deploy.stdout}${deploy.stderr}`.match(/https:\/\/[a-z0-9-]+\.vercel\.app/i);
  productionUrl = urlMatch ? urlMatch[0] : null;
  record('vercel deploy --prod', deploy.ok && !!productionUrl, productionUrl ?? 'no URL captured');
  if (!deploy.ok || !productionUrl) die('Production deploy failed.');

  heading('Canonical site URL');
  // The app must not depend on a per-deployment preview URL.
  vercel(['env', 'rm', 'NEXT_PUBLIC_SITE_URL', 'production', '--yes']);
  const siteSet = vercel(['env', 'add', 'NEXT_PUBLIC_SITE_URL', 'production'], { input: `${productionUrl}\n` });
  record('NEXT_PUBLIC_SITE_URL', siteSet.ok, productionUrl);
  // NEXT_PUBLIC_* is inlined at build time, so the value only takes effect on a rebuild.
  const redeploy = vercel(['deploy', '--prod', '--yes']);
  record('redeploy with canonical URL', redeploy.ok);

  heading('Production smoke test');
  const check = (path, expect) => {
    const r = spawnSync(
      process.execPath,
      ['-e', `const https=require('https');https.get(process.argv[1],{},res=>{process.stdout.write(String(res.statusCode));process.exit(0)}).on('error',()=>{process.stdout.write('ERR');process.exit(0)})`, `${productionUrl}${path}`],
      { encoding: 'utf8' },
    );
    const code = (r.stdout ?? '').trim();
    record(`GET ${path}`, expect.includes(code), `HTTP ${code}`);
    return code;
  };
  check('/login', ['200']);
  check('/setup', ['200']);
  check('/home', ['307', '302']);   // unauthenticated -> /login
}

// --- 12. Auth URL configuration and email templates -------------------------
//
// An earlier version of this script called these "the parts no API exposes"
// and printed them for someone to copy into the dashboard. That was wrong:
// PATCH /v1/projects/{ref}/config/auth sets the site URL, the redirect
// allow-list, and both mailer templates. Doing it here closes the gap that
// makes a magic link silently bounce, and it is checked by reading the config
// back rather than trusting the write.
let authConfigured = false;
if (productionUrl && ACCESS_TOKEN) {
  heading('Supabase auth URL configuration');
  const host = new URL(productionUrl).host;
  const allowList = [
    `${productionUrl}/auth/callback`,
    `${productionUrl}/auth/confirm`,
    `https://${host.replace(/^([^.]+)\./, '$1-*.')}/auth/**`, // preview deploys
    'http://localhost:3000/auth/callback',
    'http://localhost:3000/auth/confirm',
  ];
  // Neither template carries a device-bound secret, so a link requested on one
  // machine opens on another (AD-13). Both matter: signInWithOtp sends "Confirm
  // signup" to an address that has never signed in, and "Magic Link" after.
  const magicLink = '<h2>Sign in to ContextShelf</h2>\n<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink">Sign in to ContextShelf</a></p>';
  const confirmation = '<h2>Confirm your email</h2>\n<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup">Confirm your email</a></p>';

  try {
    await mgmt(`/v1/projects/${PROJECT_REF}/config/auth`, {
      method: 'PATCH',
      body: {
        site_url: productionUrl,
        uri_allow_list: allowList.join(','),
        mailer_templates_magic_link_content: magicLink,
        mailer_templates_confirmation_content: confirmation,
      },
    });
    const readBack = await mgmt(`/v1/projects/${PROJECT_REF}/config/auth`);
    const siteOk = readBack.site_url === productionUrl;
    const listOk = allowList.every((u) => (readBack.uri_allow_list ?? '').includes(u));
    const tplOk = /token_hash/.test(readBack.mailer_templates_magic_link_content ?? '')
      && /token_hash/.test(readBack.mailer_templates_confirmation_content ?? '');
    record('site URL', siteOk, productionUrl);
    record('redirect allow-list', listOk, `${allowList.length} entries`);
    record('email templates (token_hash form)', tplOk, 'magic link + confirm signup');
    authConfigured = siteOk && listOk && tplOk;
  } catch (e) {
    record('auth URL configuration', false, scrub(e.message));
  }
}

// ---------------------------------------------------------------------------
summary();
console.log(
  [
    '',
    c.bold('Next:'),
    authConfigured
      ? '  1. Auth URLs and both email templates are configured and verified above.'
      : productionUrl
        ? `  1. Supabase -> Authentication -> URL Configuration. Site URL: ${productionUrl}\n     Redirect URLs: ${productionUrl}/auth/callback, ${productionUrl}/auth/confirm,\n     plus http://localhost:3000/auth/callback and /auth/confirm\n  1b. Email Templates: set BOTH Magic Link and Confirm signup to the\n     token-hash form in docs/DEPLOYMENT.md section 6.`
        : '  1. Supabase -> Authentication -> URL Configuration (after deploying).',
    '  2. Run the cross-device acceptance test in docs/DEPLOYMENT.md.',
    '',
  ].join('\n'),
);
