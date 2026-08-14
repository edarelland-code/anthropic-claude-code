/**
 * `POST /api/ingest` — the Claude Code ingestion endpoint (ARCHITECTURE §9,
 * CLAUDE.md rule 20).
 *
 * The transport, and only the transport. Everything a delivery becomes is
 * decided by the same pipeline the Inbox uses:
 *
 *   request → canonical adapter → NormalizedIngestion → ingest_from_token()
 *           → persist_ingestion() → ingestion_records → source_sessions
 *           → knowledge entries, files, actions, proposed decisions
 *
 * There is no second parser and no second write path. A payload posted here
 * and the same payload pasted into the JSON import screen produce the same
 * records, because they go through the same adapter.
 *
 * Three properties this file is responsible for:
 *
 *   1. **The token is the authority.** The workspace is read from the token
 *      row inside the database function. Nothing in the body can name one —
 *      the schema warns when something tries — and a topic in someone else's
 *      workspace is answered exactly as a topic that does not exist.
 *   2. **A retry is safe.** `Idempotency-Key` is passed through to the
 *      delivery ledger. The same key with the same body replays the original
 *      receipt; the same key with a different body is refused rather than
 *      answered with the wrong receipt.
 *   3. **Nothing here renders a token.** Not in an error, not in a log line,
 *      not in a response. Where a token has to be identified, it is by the
 *      eight-character prefix that is already visible in Settings.
 */

import { createHash } from 'node:crypto';

import { createIngestGateway } from '@/lib/adapters/supabase/repositories';
import { createServiceClient, ingestionConfigurationProblem } from '@/lib/adapters/supabase/service';
import { claudeSessionJsonAdapter } from '@/lib/ingestion/adapters';
import { validateClaudeSessionImport } from '@/lib/ingestion/schema';
import { bearerFromHeader, hashToken } from '@/lib/ingestion/token';
import { IngestionError } from '@/lib/ingestion/types';

/** Node, not Edge: `node:crypto` and the service client both need it. */
export const runtime = 'nodejs';
/** A delivery is never cacheable — it writes. */
export const dynamic = 'force-dynamic';

/**
 * A session transcript is the largest thing anyone sends, and 1 MB is far more
 * than a real one. The cap exists so an unbounded body cannot be used to fill
 * a database through an endpoint that, by design, no human is watching.
 */
const MAX_BYTES = 1_000_000;

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

const unauthorized = (message: string) =>
  json({ error: message }, 401, { 'WWW-Authenticate': 'Bearer realm="ContextShelf"' });

/**
 * Turns the database function's own message into a status code.
 *
 * Matched on the exact strings that function raises rather than on a substring
 * of whatever the driver said, so a change in wording fails a test instead of
 * silently turning a 404 into a 500.
 */
function statusForMessage(message: string): { status: number; body: Record<string, unknown> } {
  if (message === 'that ingestion token is not valid') {
    return { status: 401, body: { error: message } };
  }
  if (message === 'no such topic' || message === 'no such subtopic') {
    // 404, not 403. A 403 would confirm that the id names something real
    // belonging to somebody else, which is precisely what must not leak.
    return { status: 404, body: { error: `${message}.` } };
  }
  if (message.includes('Idempotency-Key')) {
    return {
      status: 409,
      body: {
        error:
          'That Idempotency-Key has already been used for a different payload. Use a new key for a new delivery.',
      },
    };
  }
  if (message.includes('a delivery cannot perform')) {
    return { status: 403, body: { error: message } };
  }
  if (message === 'a subtopic cannot be given without its topic') {
    return { status: 400, body: { error: `${message}.` } };
  }
  return {
    status: 500,
    body: { error: 'That delivery could not be recorded. Nothing was written.' },
  };
}

/**
 * A connection check, for `contextshelf:sync --check` and for a person who
 * wants to know whether the token they just pasted works.
 *
 * Reports what the token points at and nothing more. Enumerating the workspace
 * here would make a leaked token quietly useful for reading.
 */
export async function GET(request: Request): Promise<Response> {
  const problem = ingestionConfigurationProblem();
  if (problem) return json({ error: problem }, 503);

  const token = bearerFromHeader(request.headers.get('authorization'));
  if (!token) return unauthorized('An ingestion token is required: Authorization: Bearer <token>.');

  const db = createServiceClient();
  if (!db) return json({ error: 'Ingestion is not configured.' }, 503);

  try {
    const identity = await createIngestGateway(db).identify(await hashToken(token));
    if (!identity) return unauthorized('That ingestion token is not valid.');
    return json({ ok: true, ...identity }, 200);
  } catch {
    return json({ error: 'The connection check could not be completed.' }, 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  const problem = ingestionConfigurationProblem();
  if (problem) return json({ error: problem }, 503);

  const token = bearerFromHeader(request.headers.get('authorization'));
  if (!token) return unauthorized('An ingestion token is required: Authorization: Bearer <token>.');

  const db = createServiceClient();
  if (!db) return json({ error: 'Ingestion is not configured.' }, 503);

  // Authenticate BEFORE reading or parsing anything.
  //
  // The delivery is authenticated again inside `ingest_from_token`, which is
  // the enforcement; this earlier check is about what an UNAUTHENTICATED
  // caller can reach. Without it, a request bearing a token that was never
  // issued still got its payload parsed and validated, and came back with a
  // 422 listing exactly which fields were wrong — a free, unauthenticated
  // description of the accepted format, and a way to tell a malformed payload
  // from a bad token. One extra indexed lookup per delivery is a cheap price
  // for the endpoint saying nothing at all to a caller it does not know.
  const gateway = createIngestGateway(db);
  const tokenHash = await hashToken(token);
  try {
    if (!(await gateway.identify(tokenHash))) {
      return unauthorized('That ingestion token is not valid.');
    }
  } catch {
    return json({ error: 'That delivery could not be recorded. Nothing was written.' }, 500);
  }

  const body = await request.text();
  if (body.length > MAX_BYTES) {
    return json(
      { error: `That payload is larger than the ${MAX_BYTES / 1000} kB limit for one delivery.` },
      413,
    );
  }
  if (body.trim() === '') return json({ error: 'The request body is empty.' }, 400);

  // Parsed twice on purpose: once here for a legible error, once by the
  // adapter, which is the code path the Inbox uses. Sharing one parse would
  // mean the endpoint and the import screen could drift.
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    return json(
      { error: `That is not valid JSON: ${e instanceof Error ? e.message : 'it could not be parsed'}.` },
      400,
    );
  }

  const validation = validateClaudeSessionImport(parsed);
  if (!validation.ok || !validation.value) {
    return json({ error: 'That payload could not be read.', problems: validation.errors }, 422);
  }

  let normalized;
  try {
    normalized = claudeSessionJsonAdapter.parse(body);
  } catch (e) {
    if (e instanceof IngestionError) return json({ error: e.message }, 422);
    return json({ error: 'That payload could not be read.' }, 422);
  }

  const idempotencyKey = request.headers.get('idempotency-key')?.trim() || null;
  if (idempotencyKey && idempotencyKey.length > 200) {
    return json({ error: 'Idempotency-Key must be 200 characters or fewer.' }, 400);
  }

  try {
    const receipt = await gateway.deliver({
      tokenHash,
      idempotencyKey,
      // The body itself, not a summary of it. Two deliveries that differ by a
      // single character must not be able to share a key.
      requestFingerprint: createHash('sha256').update(body).digest('hex'),
      topicId: normalized.target?.topicId ?? null,
      subtopicId: normalized.target?.subtopicId ?? null,
      adapterId: normalized.adapterId,
      sourceType: normalized.sourceType,
      contentType: 'application/json',
      raw: normalized.raw,
      payload: (normalized.payload ?? null) as Record<string, unknown> | null,
      title: normalized.title ?? null,
      occurredAt: normalized.occurredAt ?? null,
      externalUrl: normalized.externalUrl ?? null,
      segments: normalized.segments as unknown as Array<Record<string, unknown>>,
      code: (normalized.code ?? null) as Record<string, unknown> | null,
      work: (normalized.work ?? null) as Record<string, unknown> | null,
    });

    return json(
      {
        ok: true,
        receipt,
        // Surfaced because a sender that never sees them would never learn
        // that its proposed decisions are waiting for a person.
        warnings: validation.warnings,
      },
      receipt.replayed ? 200 : 201,
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '';
    const { status, body: errorBody } = statusForMessage(message);
    return json(errorBody, status);
  }
}
