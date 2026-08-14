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
  };
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
      };
    }
  }

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

  if (messages.length === 0 && segments.length === 0) {
    errors.push('The payload must contain at least one message or one segment; there is nothing to import.');
  }
  if (segments.length === 0 && messages.length > 0) {
    warnings.push(
      'No segments were supplied, so the deterministic extractor will read the transcript instead. Nothing is filed until you confirm it.',
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
      hints,
    },
  };
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
