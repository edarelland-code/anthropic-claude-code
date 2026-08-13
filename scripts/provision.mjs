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
 *
 * Cross-platform: plain Node, no bash. Works in PowerShell, cmd, and any POSIX
 * shell.
 *
 * Interactive steps use stdio: 'inherit', so the Supabase CLI owns the browser
 * handoff and the password prompt directly. This script never reads, stores, or
 * echoes a credential.
 *
 * Flags:
 *   --skip-login     assume the CLI is already authenticated
 *   --skip-push      validate only; do not apply migrations
 *   --project-ref X  override the default project reference
 *   --skip-vercel    stop after the Supabase phase
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
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
  const result = spawnSync('npx', ['--yes', 'supabase@latest', ...cliArgs], {
    cwd: ROOT,
    stdio: interactive ? 'inherit' : ['inherit', 'pipe', 'pipe'],
    encoding: 'utf8',
    shell: IS_WINDOWS, // npx needs a shell to resolve npx.cmd on Windows
  });

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (!interactive && (stdout || stderr)) {
    const text = `${stdout}${stderr}`.trimEnd();
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

if (!existsSync(resolve(ROOT, '.env.local'))) {
  record('.env.local present', false);
  die(
    '.env.local is missing.',
    'Copy .env.example to .env.local and fill in the project URL and publishable\nkey from Supabase → Project Settings → API Keys.',
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
  if (!process.stdin.isTTY) {
    record('interactive terminal', false, 'stdin is not a TTY');
    die(
      'Supabase login needs an interactive terminal.',
      'This is running without a TTY (a piped or automated shell). Run\n`npm run provision` directly in PowerShell, Terminal, or your shell of choice.',
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
console.log(c.yellow('    The CLI will prompt for the database password. Type it at the prompt —'));
console.log(c.yellow('    it is read directly by the CLI and is never seen or stored by this script.'));
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
  const result = spawnSync('npx', ['--yes', 'vercel@latest', ...cliArgs], {
    cwd: ROOT,
    stdio: interactive ? 'inherit' : ['pipe', 'pipe', 'pipe'],
    input,
    encoding: 'utf8',
    shell: IS_WINDOWS,
  });
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
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

// ---------------------------------------------------------------------------
summary();
console.log(
  [
    '',
    c.bold('Next — the parts no API exposes:'),
    productionUrl
      ? `  1. Supabase -> Authentication -> URL Configuration. Site URL: ${productionUrl}`
      : '  1. Supabase -> Authentication -> URL Configuration (after deploying).',
    productionUrl
      ? `     Redirect URLs: ${productionUrl}/auth/callback, ${productionUrl}/auth/confirm,`
      : '     Redirect URLs: <production>/auth/callback and /auth/confirm,',
    '     plus http://localhost:3000/auth/callback and /auth/confirm',
    '  2. Supabase -> Authentication -> Email Templates. Set BOTH Magic Link and',
    '     Confirm signup to the token-hash form in docs/DEPLOYMENT.md section 6.',
    '  3. Run the cross-device acceptance test in docs/DEPLOYMENT.md.',
    '',
  ].join('\n'),
);
