import { McpServer, createMcpHandler, fromJsonSchema } from '@modelcontextprotocol/server';

import { createServiceClient } from '@/lib/adapters/supabase/service';
import { createIngestGateway } from '@/lib/adapters/supabase/repositories';
import { bearerFromHeader, hashToken } from '@/lib/ingestion/token';
import { CAPTURE_INPUT_SCHEMA, capture, type CaptureArgs } from '@/lib/mcp/tools';

/**
 * ContextShelf over MCP — so Claude can put things on the shelf from Chat,
 * Cowork or Code without the user copying and pasting.
 *
 * This is an ADAPTER over the existing delivery funnel, not a second write
 * path (rule 20): every capture goes through the same `gateway.deliver()` and
 * the same `ingest_from_token()` that `/api/ingest` uses, so authentication,
 * workspace scoping, idempotency and rule 9b's "delivery is not authority" are
 * not re-implemented here and cannot drift from it.
 *
 * Authentication is an explicit check in this file rather than delegated to the
 * SDK, for the reason AD-21 gives: the handler's `authInfo` is strictly
 * pass-through and performs no verification of its own, so the boundary has to
 * be code we can read and test. The token is verified BEFORE the body is read,
 * exactly as `/api/ingest` does, so an unauthenticated caller learns nothing
 * about the accepted format.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SERVER_NAME = 'contextshelf';
const SERVER_VERSION = '1.0.0';

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      // A bare Bearer challenge. No `resource_metadata` pointer, because this
      // server is not an OAuth resource server: advertising discovery we do not
      // implement would send a client into a flow that cannot complete, which
      // is worse than a plain 401.
      'www-authenticate': 'Bearer',
      'cache-control': 'no-store',
    },
  });
}

export async function POST(request: Request): Promise<Response> {
  const token = bearerFromHeader(request.headers.get('authorization'));
  if (!token) {
    return unauthorized('A ContextShelf token is required: Authorization: Bearer <token>.');
  }

  const db = createServiceClient();
  if (!db) {
    return new Response(JSON.stringify({ error: 'ContextShelf is not configured for ingestion.' }), {
      status: 503,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }

  const gateway = createIngestGateway(db);
  const tokenHash = await hashToken(token);

  let identity;
  try {
    identity = await gateway.identify(tokenHash);
  } catch {
    return new Response(JSON.stringify({ error: 'That capture could not be recorded.' }), {
      status: 500,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
  if (!identity) return unauthorized('That ContextShelf token is not valid.');

  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

    server.registerTool(
      'contextshelf_capture',
      {
        title: 'Capture to ContextShelf',
        description: [
          'Put something on the ContextShelf — a decision, an idea, a prompt worth keeping, a',
          'conversation excerpt, or a plain note. Capture is one step: only the text is required.',
          '',
          'What happens to it: the text is stored verbatim as evidence and lands in the Inbox,',
          'where the user reviews it and turns it into typed records. Nothing captured here becomes',
          'an active decision, a chosen prompt, or project state on its own — this tool records,',
          'it does not decide.',
          '',
          `Connected to workspace "${identity.workspaceName}" as "${identity.tokenName}".`,
          identity.scopeTopicName ? `Scoped to topic "${identity.scopeTopicName}".` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        inputSchema: fromJsonSchema<CaptureArgs>(CAPTURE_INPUT_SCHEMA),
      },
      async (args: CaptureArgs) => {
        try {
          const result = await capture(gateway, tokenHash, args);
          return {
            content: [{ type: 'text' as const, text: result.message }],
            isError: !result.ok,
          };
        } catch {
          // Never surface a driver error to a model that will repeat it to the
          // user (rule 17a). The detail is logged where an operator can see it.
          console.error('[contextshelf] mcp capture failed');
          return {
            content: [
              {
                type: 'text' as const,
                text: 'That capture could not be recorded, and nothing was written. Try again.',
              },
            ],
            isError: true,
          };
        }
      },
    );

    return server;
  });

  return handler.fetch(request, {
    authInfo: { token, clientId: SERVER_NAME, scopes: ['capture'] },
  });
}

/** A GET is not a session this server supports; say so rather than 404. */
export async function GET(): Promise<Response> {
  return new Response(
    JSON.stringify({
      error: 'This endpoint speaks MCP over POST (Streamable HTTP). There is nothing to GET.',
    }),
    { status: 405, headers: { 'content-type': 'application/json', allow: 'POST' } },
  );
}
