import { createHash } from 'node:crypto';

import { SOURCE_TYPES, type SourceType } from '@/lib/domain/types';
import type { IngestGateway } from '@/lib/ports/repositories';

/**
 * The tools ContextShelf exposes over MCP.
 *
 * Why this is capture-only, and why that is not a stopgap:
 *
 * An MCP credential is an ingestion token, and an ingestion token means
 * "may deliver" — not "may read". `IngestGateway.identify()` deliberately
 * returns no workspace id, with the reason stated at its definition: a
 * connection check that enumerated a workspace would be a way to use a leaked
 * token quietly. Adding `search` or `resume` tools here would hand every
 * existing token read access to the whole shelf, retroactively, without the
 * person who minted it ever agreeing to that. Read tools therefore wait for a
 * separate grant rather than borrowing this one.
 *
 * Capture needs no such widening: it goes through `gateway.deliver()`, the same
 * funnel `/api/ingest` uses (rule 20), which resolves the workspace inside
 * `ingest_from_token()` from the token row itself. So the caller never learns a
 * workspace id, and everything the endpoint already guarantees — authentication,
 * idempotency, scope, and rule 9b's "delivery is not authority" — holds here
 * unchanged, because it is literally the same path.
 */

/** What a captured note may claim about where it came from. */
const CAPTURE_SOURCES = ['mcp', 'claude_chat', 'claude_cowork', 'claude_code', 'manual'] as const;

export interface CaptureArgs {
  content: string;
  title?: string;
  source?: string;
  topic_id?: string;
}

/**
 * The tool's input contract, as JSON Schema rather than Zod.
 *
 * Not a style preference: this SDK requires Zod 4 and ContextShelf is on Zod 3,
 * which 24 form actions and the whole validation layer depend on. Migrating
 * that to satisfy one boundary would be a large change with a wide blast radius
 * for no gain — and JSON Schema is what MCP puts on the wire anyway, so this is
 * the protocol's own representation rather than an adapter around someone's
 * object library.
 */
export const CAPTURE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    content: {
      type: 'string',
      minLength: 1,
      maxLength: 500_000,
      description:
        'The text to put on the shelf: a conversation excerpt, a decision, a prompt, a note.',
    },
    title: {
      type: 'string',
      maxLength: 300,
      description: 'Optional short label. Omit it rather than inventing one.',
    },
    source: {
      type: 'string',
      enum: [...CAPTURE_SOURCES],
      description:
        'Where this came from, ONLY if actually known. Defaults to "mcp" — do not guess between chat and cowork.',
    },
    topic_id: {
      type: 'string',
      format: 'uuid',
      description: 'Optional topic to file against. Leave unset to land in the Inbox for triage.',
    },
  },
  required: ['content'],
  additionalProperties: false,
} as const;

export interface CaptureResult {
  ok: boolean;
  message: string;
  receiptId?: string;
}

/**
 * Performs one capture. Separated from tool registration so it can be tested
 * without standing up an MCP transport.
 */
export async function capture(
  gateway: IngestGateway,
  tokenHash: string,
  input: CaptureArgs,
): Promise<CaptureResult> {
  const content = input.content;
  if (content.trim() === '') {
    return { ok: false, message: 'Nothing was captured: the content was empty.' };
  }

  // Rule 11: never invent provenance. This server cannot tell Chat from Cowork
  // — the protocol carries no such signal — so an unstated source stays `mcp`
  // rather than being guessed from anything.
  const source: SourceType =
    input.source && (SOURCE_TYPES as readonly string[]).includes(input.source)
      ? (input.source as SourceType)
      : 'mcp';

  const receipt = await gateway.deliver({
    tokenHash,
    // No client-chosen key: a conversational capture has no natural retry
    // identity, and inventing one would make two deliberate captures of the
    // same sentence collide (AD-22 — idempotency is the client's key, duplicate
    // detection is content, and they must not be merged).
    idempotencyKey: null,
    requestFingerprint: createHash('sha256').update(content).digest('hex'),
    topicId: input.topic_id ?? null,
    subtopicId: null,
    adapterId: 'mcp-capture',
    sourceType: source,
    contentType: 'text/plain',
    raw: content,
    payload: null,
    title: input.title ?? null,
    occurredAt: new Date().toISOString(),
    externalUrl: null,
    // Nothing is extracted here. The capture lands raw and is triaged in the
    // Inbox, where a person confirms what it means (rules 17b, 17c).
    segments: [],
    code: null,
    work: null,
  });

  return {
    ok: true,
    message:
      `Captured to ContextShelf${input.topic_id ? ' against the given topic' : ' (Inbox, awaiting triage)'}. ` +
      `Nothing was filed as authoritative — review it in the Inbox to turn it into records.`,
    receiptId: receipt.ingestionRecordId,
  };
}
