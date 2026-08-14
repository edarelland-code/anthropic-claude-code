/**
 * The canonical Claude Session Import format (Phase 3F).
 *
 * One documented shape that a script, a Claude Code hook, a browser companion
 * or a person writing JSON by hand can all target. It is the same payload
 * `POST /api/ingest` will accept in Phase 5, so building it now means the
 * transport arrives later without a second parser.
 *
 * Validated by hand rather than by a schema library. The rule is a small one —
 * no new dependency for something this size — and the payoff is that every
 * error message names the field and says what was expected, which is what a
 * person pasting JSON actually needs.
 */

import { KNOWLEDGE_TYPES, type KnowledgeType } from '@/lib/domain/types';

export interface ClaudeSessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** ISO 8601. Optional — absent is honest, invented is not. */
  at?: string;
}

export interface ClaudeSessionSegment {
  knowledgeType: KnowledgeType;
  title: string;
  content?: string;
  /** An anchor into the transcript: `msg:3`, `L10-L18`. */
  sourceReference?: string;
  occurredAt?: string;
}

/**
 * Work the session reports as finished, started, or worth deciding.
 *
 * The line this draws is the whole of Phase 5's authority model. A session may
 * state that an action it NAMES is finished, propose the next one, and put a
 * decision in front of a person. It cannot approve that decision, supersede an
 * old one, reject an idea, choose a winning prompt, rewrite Current State or
 * delete anything — there are no fields for those, and the database refuses
 * any key it does not recognise rather than ignoring it, so a client that
 * invents one is told instead of being given a misleading 200.
 */
export interface ClaudeSessionWork {
  /**
   * Actions this session finished. Matched by `id`, or by exact title when no
   * id is given. An action left out of a payload is NOT completed — omission
   * is not evidence, and closing on absence would quietly discard work the
   * user still intends to do.
   */
  completedActions?: Array<{ id?: string; title?: string }>;
  /** New open actions. The first becomes the Resume's immediate next action. */
  nextActions?: Array<{ kind?: 'next_step' | 'blocker' | 'question'; title: string; detail?: string }>;
  /** Recorded as `proposed`, never `active`. A person approves it or does not. */
  proposedDecisions?: Array<{
    title: string;
    decision: string;
    reason?: string;
    alternatives?: string[];
  }>;
}

export interface ClaudeSessionImport {
  version: 1;
  source: 'claude_chat' | 'claude_cowork' | 'claude_code';
  title?: string;
  occurredAt?: string;
  externalUrl?: string;
  messages?: ClaudeSessionMessage[];
  /** Pre-extracted entries. Omit and the deterministic extractor runs instead. */
  segments?: ClaudeSessionSegment[];
  code?: {
    repoUrl?: string;
    branch?: string;
    commitSha?: string;
    filesChanged?: string[];
    filesAdded?: string[];
    filesRemoved?: string[];
    buildStatus?: string;
    testSummary?: string;
    artifacts?: string[];
  };
  work?: ClaudeSessionWork;
  /**
   * Where to file it. Validated against the TOKEN's workspace, never trusted
   * to name one: a caller who could name their own workspace would need only a
   * valid token from anywhere to write into any workspace. Omit it and the
   * token's own default scope is used.
   */
  target?: { topicId?: string; subtopicId?: string };
  /** Suggestions from the producer. Never applied without confirmation. */
  hints?: { topic?: string; subtopic?: string; tags?: string[] };
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  value?: ClaudeSessionImport;
}

const ROLES = new Set(['user', 'assistant', 'system']);
const SOURCES = new Set(['claude_chat', 'claude_cowork', 'claude_code']);
const KNOWLEDGE = new Set<string>(KNOWLEDGE_TYPES);

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function isoOrNull(v: unknown, field: string, errors: string[]): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) {
    errors.push(`${field} must be an ISO 8601 timestamp, e.g. "2026-08-14T09:30:00Z".`);
    return undefined;
  }
  return v;
}

function stringArray(v: unknown, field: string, errors: string[]): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    errors.push(`${field} must be an array of strings.`);
    return undefined;
  }
  return v as string[];
}

/**
 * Validates a parsed JSON value against the canonical format.
 *
 * Collects every problem instead of stopping at the first, because someone
 * fixing a hand-written payload should see the whole list once.
 */
export function validateClaudeSessionImport(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObject(input)) {
    return { ok: false, errors: ['The payload must be a JSON object.'], warnings };
  }

  if (input.version !== 1) {
    errors.push('version must be the number 1. This is the only format version that exists.');
  }
  if (typeof input.source !== 'string' || !SOURCES.has(input.source)) {
    errors.push('source must be one of "claude_chat", "claude_cowork", "claude_code".');
  }
  if (input.title !== undefined && typeof input.title !== 'string') {
    errors.push('title must be a string.');
  }
  if (input.externalUrl !== undefined) {
    if (typeof input.externalUrl !== 'string') {
      errors.push('externalUrl must be a string.');
    } else if (!/^https?:\/\//i.test(input.externalUrl)) {
      errors.push('externalUrl must start with http:// or https://.');
    }
  }
  const occurredAt = isoOrNull(input.occurredAt, 'occurredAt', errors);

  const messages: ClaudeSessionMessage[] = [];
  if (input.messages !== undefined) {
    if (!Array.isArray(input.messages)) {
      errors.push('messages must be an array.');
    } else {
      input.messages.forEach((m, i) => {
        if (!isObject(m)) {
          errors.push(`messages[${i}] must be an object.`);
          return;
        }
        if (typeof m.role !== 'string' || !ROLES.has(m.role)) {
          errors.push(`messages[${i}].role must be "user", "assistant" or "system".`);
        }
        if (typeof m.content !== 'string') {
          errors.push(`messages[${i}].content must be a string.`);
        }
        const at = isoOrNull(m.at, `messages[${i}].at`, errors);
        if (typeof m.role === 'string' && ROLES.has(m.role) && typeof m.content === 'string') {
          messages.push({ role: m.role as ClaudeSessionMessage['role'], content: m.content, at });
        }
      });
    }
  }

  const segments: ClaudeSessionSegment[] = [];
  if (input.segments !== undefined) {
    if (!Array.isArray(input.segments)) {
      errors.push('segments must be an array.');
    } else {
      input.segments.forEach((s, i) => {
        if (!isObject(s)) {
          errors.push(`segments[${i}] must be an object.`);
          return;
        }
        if (typeof s.knowledgeType !== 'string' || !KNOWLEDGE.has(s.knowledgeType)) {
          errors.push(
            `segments[${i}].knowledgeType must be one of the known knowledge types (for example "decision", "idea", "blocker").`,
          );
        }
        if (typeof s.title !== 'string' || s.title.trim() === '') {
          errors.push(`segments[${i}].title is required and must be a non-empty string.`);
        }
        if (s.content !== undefined && s.content !== null && typeof s.content !== 'string') {
          errors.push(`segments[${i}].content must be a string.`);
        }
        if (s.sourceReference !== undefined && typeof s.sourceReference !== 'string') {
          errors.push(`segments[${i}].sourceReference must be a string.`);
        }
        const at = isoOrNull(s.occurredAt, `segments[${i}].occurredAt`, errors);
        if (
          typeof s.knowledgeType === 'string' &&
          KNOWLEDGE.has(s.knowledgeType) &&
          typeof s.title === 'string' &&
          s.title.trim() !== ''
        ) {
          segments.push({
            knowledgeType: s.knowledgeType as KnowledgeType,
            title: s.title.trim(),
            content: typeof s.content === 'string' ? s.content : undefined,
            sourceReference: typeof s.sourceReference === 'string' ? s.sourceReference : undefined,
            occurredAt: at,
          });
        }
      });
    }
  }

  let code: ClaudeSessionImport['code'];
  if (input.code !== undefined) {
    if (!isObject(input.code)) {
      errors.push('code must be an object.');
    } else {
      const c = input.code;
      for (const f of ['repoUrl', 'branch', 'commitSha', 'buildStatus', 'testSummary'] as const) {
        if (c[f] !== undefined && typeof c[f] !== 'string') errors.push(`code.${f} must be a string.`);
      }
      code = {
        repoUrl: typeof c.repoUrl === 'string' ? c.repoUrl : undefined,
        branch: typeof c.branch === 'string' ? c.branch : undefined,
        commitSha: typeof c.commitSha === 'string' ? c.commitSha : undefined,
        filesChanged: stringArray(c.filesChanged, 'code.filesChanged', errors),
        filesAdded: stringArray(c.filesAdded, 'code.filesAdded', errors),
        filesRemoved: stringArray(c.filesRemoved, 'code.filesRemoved', errors),
        buildStatus: typeof c.buildStatus === 'string' ? c.buildStatus : undefined,
        testSummary: typeof c.testSummary === 'string' ? c.testSummary : undefined,
        artifacts: stringArray(c.artifacts, 'code.artifacts', errors),
      };
    }
  }

  const work = validateWork(input.work, errors, warnings);
  const target = validateTarget(input.target, errors);

  let hints: ClaudeSessionImport['hints'];
  if (input.hints !== undefined) {
    if (!isObject(input.hints)) {
      errors.push('hints must be an object.');
    } else {
      hints = {
        topic: typeof input.hints.topic === 'string' ? input.hints.topic : undefined,
        subtopic: typeof input.hints.subtopic === 'string' ? input.hints.subtopic : undefined,
        tags: stringArray(input.hints.tags, 'hints.tags', errors),
      };
      if (hints.topic) {
        warnings.push(
          `hints.topic ("${hints.topic}") is a suggestion from the file. It is shown for you to confirm, never applied automatically.`,
        );
      }
    }
  }

  // A Claude Code delivery is allowed to be work without conversation: a
  // commit that closed an action and opened the next one is a complete report
  // even with no transcript to show for it.
  const hasWork =
    (work?.completedActions?.length ?? 0) +
      (work?.nextActions?.length ?? 0) +
      (work?.proposedDecisions?.length ?? 0) >
    0;
  if (messages.length === 0 && segments.length === 0 && !hasWork) {
    errors.push('The payload must contain at least one message, segment or work item; there is nothing to import.');
  }
  if (segments.length === 0 && messages.length > 0) {
    warnings.push(
      'No segments were supplied, so the deterministic extractor will read the transcript instead. Nothing is filed until you confirm it.',
    );
  }
  if (input.workspaceId !== undefined || input.workspace !== undefined) {
    warnings.push(
      'A workspace was named in the payload and has been ignored. The workspace comes from the token that authenticated the request and from nothing else.',
    );
  }

  if (errors.length > 0) return { ok: false, errors, warnings };

  return {
    ok: true,
    errors,
    warnings,
    value: {
      version: 1,
      source: input.source as ClaudeSessionImport['source'],
      title: typeof input.title === 'string' ? input.title : undefined,
      occurredAt,
      externalUrl: typeof input.externalUrl === 'string' ? input.externalUrl : undefined,
      messages,
      segments,
      code,
      work,
      target,
      hints,
    },
  };
}

const ACTION_KINDS = new Set(['next_step', 'blocker', 'question']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates the work block, and refuses anything outside it by name.
 *
 * The refusal is the feature. Dropping an unrecognised key would leave a
 * client believing that `supersedeDecisions` had worked, which is a worse
 * failure than any error message — the database refuses it too, so this is the
 * early, legible half of the same guarantee.
 */
function validateWork(
  v: unknown,
  errors: string[],
  warnings: string[],
): ClaudeSessionWork | undefined {
  if (v === undefined || v === null) return undefined;
  if (!isObject(v)) {
    errors.push('work must be an object.');
    return undefined;
  }

  const allowed = new Set(['completedActions', 'nextActions', 'proposedDecisions']);
  for (const key of Object.keys(v)) {
    if (!allowed.has(key)) {
      errors.push(
        `work.${key} is not something an ingestion token may do. A session can record completed actions, propose the next action, and propose a decision for review. Replacing Current State, superseding or rejecting a decision, rejecting an idea, choosing a winning prompt, deleting a record and resolving a conflict all stay with a signed-in person.`,
      );
    }
  }

  const work: ClaudeSessionWork = {};

  if (v.completedActions !== undefined) {
    if (!Array.isArray(v.completedActions)) {
      errors.push('work.completedActions must be an array.');
    } else {
      work.completedActions = [];
      v.completedActions.forEach((a, i) => {
        if (!isObject(a)) {
          errors.push(`work.completedActions[${i}] must be an object.`);
          return;
        }
        const id = typeof a.id === 'string' ? a.id.trim() : undefined;
        const title = typeof a.title === 'string' ? a.title.trim() : undefined;
        if (id && !UUID.test(id)) {
          errors.push(`work.completedActions[${i}].id must be a uuid.`);
          return;
        }
        if (!id && !title) {
          errors.push(`work.completedActions[${i}] needs an id or a title so the action can be found.`);
          return;
        }
        work.completedActions!.push(id ? { id } : { title });
      });
    }
  }

  if (v.nextActions !== undefined) {
    if (!Array.isArray(v.nextActions)) {
      errors.push('work.nextActions must be an array.');
    } else {
      work.nextActions = [];
      v.nextActions.forEach((a, i) => {
        if (!isObject(a)) {
          errors.push(`work.nextActions[${i}] must be an object.`);
          return;
        }
        if (typeof a.title !== 'string' || a.title.trim() === '') {
          errors.push(`work.nextActions[${i}].title is required.`);
          return;
        }
        if (a.kind !== undefined && (typeof a.kind !== 'string' || !ACTION_KINDS.has(a.kind))) {
          errors.push(`work.nextActions[${i}].kind must be "next_step", "blocker" or "question".`);
          return;
        }
        work.nextActions!.push({
          kind: (a.kind as 'next_step' | 'blocker' | 'question' | undefined) ?? 'next_step',
          title: a.title.trim(),
          detail: typeof a.detail === 'string' ? a.detail : undefined,
        });
      });
    }
  }

  if (v.proposedDecisions !== undefined) {
    if (!Array.isArray(v.proposedDecisions)) {
      errors.push('work.proposedDecisions must be an array.');
    } else {
      work.proposedDecisions = [];
      v.proposedDecisions.forEach((d, i) => {
        if (!isObject(d)) {
          errors.push(`work.proposedDecisions[${i}] must be an object.`);
          return;
        }
        if (typeof d.title !== 'string' || d.title.trim() === '') {
          errors.push(`work.proposedDecisions[${i}].title is required.`);
          return;
        }
        if (typeof d.decision !== 'string' || d.decision.trim() === '') {
          errors.push(`work.proposedDecisions[${i}].decision is required — a decision needs to say what was decided.`);
          return;
        }
        work.proposedDecisions!.push({
          title: d.title.trim(),
          decision: d.decision.trim(),
          reason: typeof d.reason === 'string' ? d.reason : undefined,
          alternatives: stringArray(d.alternatives, `work.proposedDecisions[${i}].alternatives`, errors),
        });
      });
      if (work.proposedDecisions.length > 0) {
        warnings.push(
          `${work.proposedDecisions.length} decision(s) will be recorded as PROPOSED and will not appear as current until someone approves them.`,
        );
      }
    }
  }

  return work;
}

function validateTarget(v: unknown, errors: string[]): ClaudeSessionImport['target'] {
  if (v === undefined || v === null) return undefined;
  if (!isObject(v)) {
    errors.push('target must be an object.');
    return undefined;
  }
  const out: { topicId?: string; subtopicId?: string } = {};
  for (const f of ['topicId', 'subtopicId'] as const) {
    if (v[f] === undefined || v[f] === null) continue;
    if (typeof v[f] !== 'string' || !UUID.test(v[f])) {
      errors.push(`target.${f} must be a uuid.`);
      continue;
    }
    out[f] = v[f];
  }
  if (out.subtopicId && !out.topicId) {
    errors.push('target.subtopicId cannot be given without target.topicId.');
  }
  return out;
}

/** A worked example, shown beside the JSON import box so the format is discoverable. */
export const CLAUDE_SESSION_EXAMPLE = `{
  "version": 1,
  "source": "claude_chat",
  "title": "Icon exploration",
  "occurredAt": "2026-08-14T09:30:00Z",
  "externalUrl": "https://claude.ai/chat/…",
  "messages": [
    { "role": "user", "content": "Should the icon be blue?" },
    { "role": "assistant", "content": "Blue reads as a status dot at 16px." }
  ],
  "segments": [
    {
      "knowledgeType": "decision",
      "title": "Use the slash geometry",
      "content": "Blue read as a status dot at 16px.",
      "sourceReference": "msg:2"
    }
  ],
  "hints": { "topic": "DailyRelay" }
}`;

/**
 * What `npm run contextshelf:sync` sends.
 *
 * Shown in Settings beside the token so the format is inspectable before
 * anyone trusts a script with it — and so the boundary is visible: every field
 * here is a technical fact the session observed, and the one judgement in it
 * arrives as a proposal.
 */
export const CLAUDE_CODE_EXAMPLE = `{
  "version": 1,
  "source": "claude_code",
  "title": "Export button + receipt view",
  "occurredAt": "2026-08-14T18:04:00Z",
  "target": { "topicId": "…the topic this repo maps to…" },
  "code": {
    "repoUrl": "https://github.com/you/dailyrelay",
    "branch": "phase-5-ingestion",
    "commitSha": "9f2c1ab",
    "filesChanged": ["src/export.ts"],
    "filesAdded": ["src/receipt.ts"],
    "filesRemoved": [],
    "buildStatus": "passed",
    "testSummary": "163 passed, 0 failed"
  },
  "segments": [
    { "knowledgeType": "implementation", "title": "Export button wired to the receipt view" },
    { "knowledgeType": "bug", "title": "Clipboard rejected without a user gesture on Firefox" },
    { "knowledgeType": "fix", "title": "Select the text as a fallback and record either way" }
  ],
  "work": {
    "completedActions": [{ "title": "Wire the export button" }],
    "nextActions": [{ "kind": "next_step", "title": "Render the receipt ids" }],
    "proposedDecisions": [
      {
        "title": "Drop the legacy exporter",
        "decision": "Remove src/legacy-export.ts",
        "reason": "Nothing has imported it since the rewrite."
      }
    ]
  }
}`;
