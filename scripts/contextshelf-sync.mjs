#!/usr/bin/env node
/**
 * `npm run contextshelf:sync` — send this Claude Code session to ContextShelf.
 *
 *   npm run contextshelf:sync -- --check
 *   npm run contextshelf:sync -- --done "Wire the export button" --next "Render the receipts"
 *   npm run contextshelf:sync -- --build passed --tests "163 passed, 0 failed"
 *   npm run contextshelf:sync -- --dry-run
 *
 * Design rules, in the order they mattered:
 *
 *   1. **The token is never printed.** Not in the dry run, not in an error, not
 *      in the summary line. Where a token has to be identified it is by the
 *      eight-character prefix already visible in Settings. A sync command's
 *      output ends up in terminal scrollback, CI logs and screenshots.
 *
 *   2. **Nothing is invented.** Every field is read from git or passed on the
 *      command line. If the repository has no remote, `repoUrl` is absent
 *      rather than guessed; if nobody said the tests passed, no test result is
 *      sent. A sync that made up a build status would corrupt the one thing
 *      this pipeline exists to carry.
 *
 *   3. **Running it twice is not two deliveries.** The Idempotency-Key
 *      defaults to a hash of the payload, so an accidental re-run replays its
 *      receipt and writes nothing. That is a client convenience, not the
 *      server's rule: the server treats the key as opaque, and two deliveries
 *      of genuinely identical content under different keys are two deliveries
 *      whose duplication is for a person to judge (rule 17).
 *
 *   4. **No dependencies.** Node 18+, `fetch` and `node:crypto`. A sync tool
 *      that needed an install step would not get used.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

// --- arguments --------------------------------------------------------------

const argv = process.argv.slice(2);
const flags = { done: [], next: [], blocker: [], decision: [] };

for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  const value = () => argv[++i];
  switch (arg) {
    case '--check': flags.check = true; break;
    case '--dry-run': flags.dryRun = true; break;
    case '--help': case '-h': flags.help = true; break;
    case '--title': flags.title = value(); break;
    case '--summary': flags.summary = value(); break;
    case '--topic': flags.topicId = value(); break;
    case '--subtopic': flags.subtopicId = value(); break;
    case '--build': flags.build = value(); break;
    case '--tests': flags.tests = value(); break;
    case '--key': flags.key = value(); break;
    case '--payload': flags.payload = value(); break;
    case '--done': flags.done.push(value()); break;
    case '--next': flags.next.push(value()); break;
    case '--blocker': flags.blocker.push(value()); break;
    case '--decision': flags.decision.push(value()); break;
    case '--since': flags.since = value(); break;
    default:
      console.error(red(`Unknown option: ${arg}`));
      process.exit(2);
  }
}

if (flags.help) {
  console.log(`${bold('contextshelf:sync')} — send this Claude Code session to ContextShelf

  --check                 verify the connection and print what the token points at
  --dry-run               print exactly what would be sent, and send nothing
  --title <text>          a name for the session (default: the commit subject)
  --summary <text>        one line of what this session did
  --topic <uuid>          override the token's default topic
  --subtopic <uuid>       file under a subtopic of that topic
  --build <text>          build result, e.g. passed / failed
  --tests <text>          test result, e.g. "163 passed, 0 failed"
  --done <title|uuid>     an action this session finished (repeatable)
  --next <title>          an action to do next (repeatable)
  --blocker <title>       something blocking progress (repeatable)
  --decision "t :: d :: why"   propose a decision for review (repeatable)
  --since <ref>           diff against this ref instead of the last commit
  --key <text>            Idempotency-Key (default: a hash of the payload)
  --payload <file>        send this JSON file instead of building one

Configuration, from the environment:
  CONTEXTSHELF_URL        e.g. https://contextshelf.vercel.app
  CONTEXTSHELF_TOKEN      the token from Settings → Claude Code connection
  CONTEXTSHELF_TOKEN_FILE a file containing it, if you would rather not export it
  CONTEXTSHELF_TOPIC_ID   the topic this repository maps to (optional)
  CONTEXTSHELF_SUBTOPIC_ID                                   (optional)
`);
  process.exit(0);
}

// --- configuration ----------------------------------------------------------

function readToken() {
  const direct = process.env.CONTEXTSHELF_TOKEN?.trim();
  if (direct) return direct;
  const file = process.env.CONTEXTSHELF_TOKEN_FILE?.trim();
  if (file) {
    try {
      return readFileSync(file, 'utf8').trim();
    } catch {
      fail(`CONTEXTSHELF_TOKEN_FILE points at ${file}, which could not be read.`);
    }
  }
  return null;
}

function fail(message, hint) {
  console.error(`\n${red('✗')} ${message}`);
  if (hint) console.error(dim(`  ${hint}`));
  process.exit(1);
}

const BASE = (process.env.CONTEXTSHELF_URL ?? '').trim().replace(/\/+$/, '');
const TOKEN = readToken();

if (!BASE) {
  fail(
    'CONTEXTSHELF_URL is not set.',
    'Settings → Claude Code connection → Copy setup instructions gives you both lines.',
  );
}
if (!TOKEN) {
  fail(
    'CONTEXTSHELF_TOKEN is not set.',
    'Create one in Settings → Claude Code connection. Keep it out of the repository.',
  );
}

/** The only rendering of a token this file will ever do. */
const tokenLabel = `${TOKEN.slice(0, 16)}…`;

// --- git --------------------------------------------------------------------

function git(...args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/**
 * What the repository says about itself.
 *
 * Absent fields stay absent. A repository with no remote genuinely has no
 * `repoUrl`, and sending the directory name in its place would put a fact into
 * ContextShelf that nothing observed.
 */
function collectCode() {
  const code = {};
  const remote = git('config', '--get', 'remote.origin.url');
  if (remote) {
    // Normalise the SSH form so the value is a URL a person can open.
    code.repoUrl = remote.replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '');
  }

  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch && branch !== 'HEAD') code.branch = branch;

  const sha = git('rev-parse', 'HEAD');
  if (sha) code.commitSha = sha;

  const since = flags.since ?? 'HEAD~1';
  const status = git('diff', '--name-status', since, 'HEAD');
  const changed = [];
  const added = [];
  const removed = [];
  for (const line of status.split('\n')) {
    if (!line.trim()) continue;
    const [mark, ...rest] = line.split('\t');
    const path = rest[rest.length - 1];
    if (!path) continue;
    if (mark.startsWith('A')) added.push(path);
    else if (mark.startsWith('D')) removed.push(path);
    else changed.push(path);
  }
  // Uncommitted work counts as changed — a session that has not committed yet
  // still touched those files, and omitting them would misreport the session.
  for (const line of git('diff', '--name-only').split('\n')) {
    const path = line.trim();
    if (path && !changed.includes(path) && !added.includes(path)) changed.push(path);
  }

  if (changed.length) code.filesChanged = changed;
  if (added.length) code.filesAdded = added;
  if (removed.length) code.filesRemoved = removed;

  if (flags.build) code.buildStatus = flags.build;
  if (flags.tests) code.testSummary = flags.tests;
  return code;
}

/** `--decision "title :: what was decided :: why"`. */
function parseDecision(raw) {
  const [title, decision, reason] = raw.split('::').map((s) => s.trim());
  if (!title || !decision) {
    fail(
      `--decision needs at least a title and a decision: --decision "Drop the exporter :: Remove src/legacy-export.ts"`,
    );
  }
  return reason ? { title, decision, reason } : { title, decision };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildPayload() {
  if (flags.payload) {
    try {
      return JSON.parse(readFileSync(flags.payload, 'utf8'));
    } catch (e) {
      fail(`--payload ${flags.payload} could not be read as JSON: ${e.message}`);
    }
  }

  const code = collectCode();
  const subject = git('log', '-1', '--pretty=%s');
  const body = git('log', '-1', '--pretty=%b');

  const segments = [];
  if (flags.summary) {
    segments.push({ knowledgeType: 'progress', title: flags.summary });
  } else if (subject) {
    // The commit subject IS a statement the author made about the work. Using
    // it is reading, not inferring.
    segments.push({
      knowledgeType: 'implementation',
      title: subject,
      content: body || undefined,
      sourceReference: code.commitSha ? `commit:${code.commitSha.slice(0, 12)}` : undefined,
    });
  }

  const work = {};
  if (flags.done.length) {
    work.completedActions = flags.done.map((d) => (UUID.test(d) ? { id: d } : { title: d }));
  }
  const nextActions = [
    ...flags.next.map((title) => ({ kind: 'next_step', title })),
    ...flags.blocker.map((title) => ({ kind: 'blocker', title })),
  ];
  if (nextActions.length) work.nextActions = nextActions;
  if (flags.decision.length) work.proposedDecisions = flags.decision.map(parseDecision);

  const topicId = flags.topicId ?? process.env.CONTEXTSHELF_TOPIC_ID?.trim();
  const subtopicId = flags.subtopicId ?? process.env.CONTEXTSHELF_SUBTOPIC_ID?.trim();

  const payload = {
    version: 1,
    source: 'claude_code',
    title: flags.title ?? subject ?? 'Claude Code session',
    occurredAt: new Date().toISOString(),
  };
  if (topicId) payload.target = subtopicId ? { topicId, subtopicId } : { topicId };
  if (Object.keys(code).length) payload.code = code;
  if (segments.length) payload.segments = segments;
  if (Object.keys(work).length) payload.work = work;
  return payload;
}

// --- send -------------------------------------------------------------------

function describe(payload) {
  const c = payload.code ?? {};
  const lines = [
    `  ${dim('to')}        ${BASE}/api/ingest`,
    `  ${dim('token')}     ${tokenLabel}`,
    `  ${dim('topic')}     ${payload.target?.topicId ?? dim("the token's default")}`,
  ];
  if (c.branch || c.commitSha) {
    lines.push(`  ${dim('commit')}    ${c.branch ?? '?'} @ ${(c.commitSha ?? '?').slice(0, 12)}`);
  }
  const files =
    (c.filesChanged?.length ?? 0) + (c.filesAdded?.length ?? 0) + (c.filesRemoved?.length ?? 0);
  if (files) lines.push(`  ${dim('files')}     ${files}`);
  if (c.buildStatus) lines.push(`  ${dim('build')}     ${c.buildStatus}`);
  if (c.testSummary) lines.push(`  ${dim('tests')}     ${c.testSummary}`);
  for (const a of payload.work?.completedActions ?? []) {
    lines.push(`  ${dim('done')}      ${a.title ?? a.id}`);
  }
  for (const a of payload.work?.nextActions ?? []) {
    lines.push(`  ${dim('next')}      ${a.title}`);
  }
  for (const d of payload.work?.proposedDecisions ?? []) {
    lines.push(`  ${dim('proposed')}  ${d.title} ${dim('(needs your review)')}`);
  }
  return lines.join('\n');
}

async function check() {
  const res = await fetch(`${BASE}/api/ingest`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    fail(
      `${res.status} — ${body.error ?? 'the connection check failed'}`,
      res.status === 401 ? 'Create a new token in Settings → Claude Code connection.' : undefined,
    );
  }
  console.log(`\n${green('✓')} Connected to ${bold(BASE)}`);
  console.log(`  ${dim('workspace')} ${body.workspaceName}`);
  console.log(`  ${dim('token')}     ${body.tokenName} ${dim(`(${tokenLabel})`)}`);
  console.log(
    `  ${dim('topic')}     ${body.scopeTopicName ?? dim('none — each delivery names its own')}`,
  );
}

async function send(payload) {
  const serialised = JSON.stringify(payload);
  // Derived from the content so an accidental second run replays rather than
  // duplicating. `--key` overrides it when a caller wants to be explicit.
  const key = flags.key ?? `sync-${createHash('sha256').update(serialised).digest('hex').slice(0, 32)}`;

  const res = await fetch(`${BASE}/api/ingest`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: serialised,
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const problems = Array.isArray(body.problems) ? `\n  ${body.problems.join('\n  ')}` : '';
    fail(`${res.status} — ${body.error ?? 'the delivery was refused'}${problems}`);
  }

  const r = body.receipt ?? {};
  if (r.replayed) {
    console.log(`\n${green('✓')} Already recorded. Nothing was written twice.`);
  } else {
    console.log(`\n${green('✓')} Recorded in ContextShelf.`);
  }
  const counts = [
    [r.entryIds?.length, 'knowledge entr', 'y', 'ies'],
    [r.fileReferenceIds?.length, 'file reference', '', 's'],
    [r.completedActionIds?.length, 'action', ' completed', 's completed'],
    [r.nextActionIds?.length, 'next action', '', 's'],
    [r.proposedDecisionIds?.length, 'decision', ' awaiting review', 's awaiting review'],
  ]
    .filter(([n]) => n > 0)
    .map(([n, word, one, many]) => `${n} ${word}${n === 1 ? one : many}`);
  if (counts.length) console.log(`  ${counts.join(' · ')}`);
  for (const w of body.warnings ?? []) console.log(dim(`  ${w}`));
  if (r.topicId) console.log(dim(`  ${BASE}/topics/${r.topicId}`));
}

try {
  if (flags.check) {
    await check();
  } else {
    const payload = buildPayload();
    console.log(`\n${bold('Sending to ContextShelf')}`);
    console.log(describe(payload));
    if (flags.dryRun) {
      console.log(`\n${dim('--dry-run: nothing was sent. The payload would be:')}`);
      console.log(JSON.stringify(payload, null, 2));
    } else {
      await send(payload);
    }
  }
} catch (cause) {
  // Never let a stack trace carry an Authorization header into a log.
  fail(cause instanceof Error ? cause.message : 'The sync could not be completed.');
}
