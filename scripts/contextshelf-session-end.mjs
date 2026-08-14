#!/usr/bin/env node
/**
 * Optional Claude Code `SessionEnd` hook.
 *
 * Register it yourself — nothing installs it — in `.claude/settings.json`:
 *
 *   {
 *     "hooks": {
 *       "SessionEnd": [
 *         { "hooks": [{ "type": "command",
 *                       "command": "node scripts/contextshelf-session-end.mjs" }] }
 *       ]
 *     }
 *   }
 *
 * `SessionEnd` was chosen over `Stop` and `PostToolUse` deliberately. It fires
 * once, when the session is over, so a session that read three files and
 * edited one produces one delivery rather than a delivery per tool call —
 * which would bury the shelf in noise and make the Timeline unreadable.
 *
 * The five properties that made this safe enough to ship rather than defer:
 *
 *   * **Opt-in.** Registering it is the opt-in. This repository does not write
 *     to your `.claude/settings.json`.
 *   * **Easy to disable.** Remove the block, or set
 *     `CONTEXTSHELF_SYNC_ON_SESSION_END=0` to keep the registration and turn
 *     the behaviour off.
 *   * **Secret-safe.** The token is read from the environment and never
 *     printed. Nothing is written to a file in the repository.
 *   * **Non-blocking.** It runs with a hard timeout and always exits 0. A
 *     ContextShelf outage, a revoked token or a network failure must never be
 *     able to hold a session open or turn its ending into an error.
 *   * **Quiet when it has nothing to say.** No token, no repository, or no
 *     changes since the last commit means it exits silently.
 *
 * What it does NOT do, and this is the honest limit: it reports only what git
 * can be asked — repository, branch, commit, files touched. It cannot know
 * which action you finished, what you decided, or whether the build passed,
 * because nothing observed those. Those come from running
 * `npm run contextshelf:sync -- --done … --next … --tests …` yourself. A hook
 * that guessed at them would be inventing the most important records in the
 * product.
 *
 * A hard kill (`kill -9`, a closed laptop) does not fire SessionEnd. Manual
 * sync remains the path you can rely on; this is a convenience on top of it.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Always. Whatever happened, the session ends cleanly. */
const done = (message) => {
  if (message) console.log(`[contextshelf] ${message}`);
  process.exit(0);
};

if (process.env.CONTEXTSHELF_SYNC_ON_SESSION_END === '0') done();
if (!process.env.CONTEXTSHELF_URL) done();
if (!process.env.CONTEXTSHELF_TOKEN && !process.env.CONTEXTSHELF_TOKEN_FILE) done();

// Claude Code sends the session payload on stdin. It is read so the pipe is
// drained, and the reason is used to skip endings that are not the end of any
// work — a `/clear` is a fresh start, not a session worth recording.
let reason = '';
try {
  const flagged = process.argv.indexOf('--reason');
  // `readFileSync(0)` rather than shelling out to `cat`, so this runs the same
  // way on Windows as it does anywhere else.
  reason =
    flagged >= 0
      ? (process.argv[flagged + 1] ?? '')
      : (JSON.parse(readFileSync(0, 'utf8') || '{}').reason ?? '');
} catch {
  // No payload, or not JSON. Neither is a reason to skip the sync.
}
if (reason === 'clear') done();

function git(...args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

if (!git('rev-parse', '--is-inside-work-tree')) done();

// Nothing changed: no commit since the previous one and no working-tree edits.
// A session spent reading is not a session worth a delivery.
const changed = git('diff', '--name-only', 'HEAD~1', 'HEAD') || git('diff', '--name-only');
if (!changed.trim()) done();

const result = spawnSync(
  process.execPath,
  [resolve(ROOT, 'scripts/contextshelf-sync.mjs'), '--title', git('log', '-1', '--pretty=%s')],
  {
    cwd: ROOT,
    encoding: 'utf8',
    // Bounded so a hanging network call cannot sit at the end of a session.
    timeout: 20_000,
    env: process.env,
  },
);

if (result.status === 0) {
  done('session recorded in ContextShelf');
}
// Reported, never raised. The sender already refuses to print the token, and
// its stderr is the only thing surfaced here.
done(`session not recorded: ${(result.stderr || '').trim().split('\n').pop() || 'the sync did not complete'}`);
