#!/usr/bin/env node
/**
 * Registers the ContextShelf `SessionEnd` hook at USER level, so every Claude
 * Code session — in any repository, not just this one — files itself.
 *
 *   npm run contextshelf:install-hook -- --token-file <path>
 *   npm run contextshelf:install-hook -- --check          (report, change nothing)
 *   npm run contextshelf:install-hook -- --uninstall
 *
 * Why this exists: the hook was shipped opt-in and the opt-in was hand-editing
 * `~/.claude/settings.json`, which never happened. This does that edit
 * carefully instead.
 *
 * It never handles the token itself. The token lives in a file you create; this
 * writes only the file's PATH into your settings, so the secret is never in
 * this repository, in your shell history, or in a settings file that syncs.
 *
 * Properties kept deliberately:
 *   * Idempotent. Running twice changes nothing the second time.
 *   * Backs up. The previous settings file is copied beside it before any write.
 *   * Additive. Existing hooks, env values and settings are preserved; only the
 *     ContextShelf entry is added or removed.
 *   * Reversible. `--uninstall` removes exactly what this added.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = resolve(ROOT, 'scripts/contextshelf-session-end.mjs');
const SETTINGS_DIR = resolve(homedir(), '.claude');
const SETTINGS = resolve(SETTINGS_DIR, 'settings.json');
const DEFAULT_URL = 'https://contextshelf.vercel.app';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const val = (f, fallback) => {
  const i = argv.indexOf(`--${f}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const c = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
};

const COMMAND = `node ${JSON.stringify(HOOK)}`;
const isOurs = (entry) =>
  typeof entry?.command === 'string' && entry.command.includes('contextshelf-session-end');

function readSettings() {
  if (!existsSync(SETTINGS)) return {};
  try {
    return JSON.parse(readFileSync(SETTINGS, 'utf8') || '{}');
  } catch (cause) {
    console.error(c.red(`\nCould not parse ${SETTINGS}.`));
    console.error('Fix or move that file first — this will not overwrite settings it cannot read.');
    console.error(c.dim(`  ${cause instanceof Error ? cause.message : cause}`));
    process.exit(1);
  }
}

function installedEntries(settings) {
  const groups = settings.hooks?.SessionEnd ?? [];
  return groups.flatMap((g) => (g.hooks ?? []).filter(isOurs));
}

// --- report -----------------------------------------------------------------

const settings = readSettings();
const already = installedEntries(settings);

if (has('check')) {
  console.log(c.bold('\nContextShelf SessionEnd hook'));
  console.log(`  settings file   ${existsSync(SETTINGS) ? SETTINGS : `${SETTINGS} ${c.dim('(does not exist yet)')}`}`);
  console.log(`  registered      ${already.length ? c.green('yes') : c.yellow('no')}`);
  console.log(`  CONTEXTSHELF_URL        ${settings.env?.CONTEXTSHELF_URL ?? c.yellow('not set')}`);
  const tf = settings.env?.CONTEXTSHELF_TOKEN_FILE;
  console.log(
    `  CONTEXTSHELF_TOKEN_FILE ${tf ? `${tf} ${existsSync(tf) ? c.green('(present)') : c.red('(missing!)')}` : c.yellow('not set')}`,
  );
  console.log('');
  process.exit(0);
}

// --- uninstall --------------------------------------------------------------

if (has('uninstall')) {
  if (!already.length) {
    console.log(c.yellow('\nNothing to remove — the hook is not registered.\n'));
    process.exit(0);
  }
  copyFileSync(SETTINGS, `${SETTINGS}.backup`);
  settings.hooks.SessionEnd = settings.hooks.SessionEnd
    .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOurs(h)) }))
    .filter((g) => (g.hooks ?? []).length > 0);
  if (settings.hooks.SessionEnd.length === 0) delete settings.hooks.SessionEnd;
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  for (const k of ['CONTEXTSHELF_URL', 'CONTEXTSHELF_TOKEN_FILE']) delete settings.env?.[k];
  if (settings.env && Object.keys(settings.env).length === 0) delete settings.env;
  writeFileSync(SETTINGS, `${JSON.stringify(settings, null, 2)}\n`);
  console.log(c.green(`\nRemoved. Backup at ${SETTINGS}.backup\n`));
  process.exit(0);
}

// --- install ----------------------------------------------------------------

const tokenFile = val('token-file', settings.env?.CONTEXTSHELF_TOKEN_FILE);
const url = val('url', settings.env?.CONTEXTSHELF_URL ?? DEFAULT_URL);

if (!tokenFile) {
  console.error(c.bold('\nA token file is required.\n'));
  console.error('ContextShelf needs an ingestion token, and this installer never touches the');
  console.error('token itself — you put it in a file, and this records only the path.\n');
  console.error(c.bold('  1.') + ` Open ${url}/settings → Claude Code`);
  console.error('     Name the machine (for example "work-pc"), create the token, copy it.\n');
  console.error(c.bold('  2.') + ' Save it to a file outside any repository:\n');
  console.error(c.dim('     Windows PowerShell:'));
  console.error('       Set-Content -Path "$HOME\\.contextshelf-token" -Value "<paste>" -NoNewline\n');
  console.error(c.dim('     macOS / Linux:'));
  console.error('       printf %s "<paste>" > ~/.contextshelf-token && chmod 600 ~/.contextshelf-token\n');
  console.error(c.bold('  3.') + ' Re-run:\n');
  console.error('       npm run contextshelf:install-hook -- --token-file ~/.contextshelf-token\n');
  process.exit(1);
}

const resolvedToken = tokenFile.startsWith('~')
  ? resolve(homedir(), tokenFile.slice(1).replace(/^[/\\]/, ''))
  : resolve(tokenFile);

if (!existsSync(resolvedToken)) {
  console.error(c.red(`\nNo file at ${resolvedToken}`));
  console.error('Create it first (step 2 above), then re-run.\n');
  process.exit(1);
}
if (statSync(resolvedToken).size === 0) {
  console.error(c.red(`\n${resolvedToken} is empty.\n`));
  process.exit(1);
}
if (!existsSync(HOOK)) {
  console.error(c.red(`\nHook script not found at ${HOOK}`));
  console.error('Run this from a ContextShelf checkout.\n');
  process.exit(1);
}

mkdirSync(SETTINGS_DIR, { recursive: true });
if (existsSync(SETTINGS)) copyFileSync(SETTINGS, `${SETTINGS}.backup`);

settings.env = { ...settings.env, CONTEXTSHELF_URL: url, CONTEXTSHELF_TOKEN_FILE: resolvedToken };

if (!already.length) {
  settings.hooks ??= {};
  settings.hooks.SessionEnd ??= [];
  settings.hooks.SessionEnd.push({ hooks: [{ type: 'command', command: COMMAND }] });
} else {
  // Keep a single entry pointing at this checkout rather than accumulating one
  // per clone the user has ever had.
  for (const group of settings.hooks.SessionEnd) {
    for (const entry of group.hooks ?? []) if (isOurs(entry)) entry.command = COMMAND;
  }
}

writeFileSync(SETTINGS, `${JSON.stringify(settings, null, 2)}\n`);

console.log(c.green(c.bold('\nContextShelf autosync is on.')));
console.log(`  settings   ${SETTINGS}${existsSync(`${SETTINGS}.backup`) ? c.dim(`  (backup beside it)`) : ''}`);
console.log(`  hook       ${HOOK}`);
console.log(`  url        ${url}`);
console.log(`  token file ${resolvedToken} ${c.dim('(path only — the token is never copied here)')}`);
console.log(
  [
    '',
    'From now on, when a Claude Code session ends in any git repository and',
    'something actually changed, the repository, branch, commit and files touched',
    'are delivered to ContextShelf. A session that only read files sends nothing.',
    '',
    `Turn it off without unregistering:  ${c.dim('set CONTEXTSHELF_SYNC_ON_SESSION_END=0')}`,
    `Remove it entirely:                 ${c.dim('npm run contextshelf:install-hook -- --uninstall')}`,
    `Check status:                       ${c.dim('npm run contextshelf:install-hook -- --check')}`,
    '',
    'For what git cannot observe — what you decided, what is next, whether tests',
    'passed — add it yourself at the end of a session:',
    c.dim('  npm run contextshelf:sync -- --done "…" --next "…" --tests "…"'),
    '',
  ].join('\n'),
);
