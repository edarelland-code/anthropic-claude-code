import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { IngestReceipt } from '@/lib/domain/types';
import type { IngestDelivery, IngestGateway } from '@/lib/ports/repositories';
import { CAPTURE_INPUT_SCHEMA, capture } from './tools';

/** Records what the capture tool would deliver, without touching a database. */
function stubGateway(): { gateway: IngestGateway; sent: IngestDelivery[] } {
  const sent: IngestDelivery[] = [];
  const gateway: IngestGateway = {
    identify: async () => ({
      tokenName: 'work-pc',
      workspaceName: 'My Shelf',
      scopeTopicId: null,
      scopeTopicName: null,
      scopeSubtopicId: null,
    }),
    deliver: async (input) => {
      sent.push(input);
      return {
        ingestionRecordId: 'rec-1',
        status: 'unsorted',
        topicId: input.topicId,
        subtopicId: null,
        sourceSessionId: 'sess-1',
        entryIds: [],
        fileReferenceIds: [],
        completedActionIds: [],
      } as unknown as IngestReceipt;
    },
  };
  return { gateway, sent };
}

describe('capture', () => {
  it('delivers the content verbatim', async () => {
    const { gateway, sent } = stubGateway();
    const text = 'We approved the slash-arrow-X geometry.\n\nReason: reads at 16px.';

    const result = await capture(gateway, 'hash', { content: text });

    expect(result.ok).toBe(true);
    expect(result.receiptId).toBe('rec-1');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.raw).toBe(text);
  });

  it('does not guess the source — rule 11', async () => {
    const { gateway, sent } = stubGateway();
    await capture(gateway, 'hash', { content: 'something' });
    // The protocol carries no signal distinguishing Chat from Cowork, so an
    // unstated source must stay `mcp` rather than be inferred.
    expect(sent[0]!.sourceType).toBe('mcp');
  });

  it('honours a source the caller actually knows', async () => {
    const { gateway, sent } = stubGateway();
    await capture(gateway, 'hash', { content: 'x', source: 'claude_cowork' });
    expect(sent[0]!.sourceType).toBe('claude_cowork');
  });

  it('refuses a source outside the enum rather than passing it through', async () => {
    const { gateway, sent } = stubGateway();
    await capture(gateway, 'hash', { content: 'x', source: 'telepathy' });
    expect(sent[0]!.sourceType).toBe('mcp');
  });

  it('refuses empty and whitespace-only content, and writes nothing', async () => {
    const { gateway, sent } = stubGateway();
    expect((await capture(gateway, 'hash', { content: '' })).ok).toBe(false);
    expect((await capture(gateway, 'hash', { content: '   \n\t ' })).ok).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('sends no idempotency key — AD-22', async () => {
    const { gateway, sent } = stubGateway();
    await capture(gateway, 'hash', { content: 'the same sentence' });
    await capture(gateway, 'hash', { content: 'the same sentence' });
    // Two deliberate captures of identical text are two captures. Inventing a
    // key from the content would make the second silently replay the first,
    // which is duplicate detection wearing idempotency's clothes.
    expect(sent.map((d) => d.idempotencyKey)).toEqual([null, null]);
    expect(sent).toHaveLength(2);
  });

  it('fingerprints the content itself', async () => {
    const { gateway, sent } = stubGateway();
    await capture(gateway, 'hash', { content: 'abc' });
    expect(sent[0]!.requestFingerprint).toBe(
      createHash('sha256').update('abc').digest('hex'),
    );
  });

  it('extracts nothing — the capture lands raw for triage', async () => {
    const { gateway, sent } = stubGateway();
    await capture(gateway, 'hash', { content: 'We decided X. Next: do Y.' });
    // Rules 17b/17c: a person confirms what a capture means. Arriving with
    // segments would be this tool deciding.
    expect(sent[0]!.segments).toEqual([]);
    expect(sent[0]!.code).toBeNull();
    expect(sent[0]!.work).toBeNull();
  });

  it('passes a topic through but never invents one', async () => {
    const { gateway, sent } = stubGateway();
    const id = '11111111-2222-3333-4444-555555555555';
    await capture(gateway, 'hash', { content: 'x', topic_id: id });
    await capture(gateway, 'hash', { content: 'y' });
    expect(sent[0]!.topicId).toBe(id);
    expect(sent[1]!.topicId).toBeNull();
    expect(sent[1]!.subtopicId).toBeNull();
  });

  it('says plainly that nothing became authoritative', async () => {
    const { gateway } = stubGateway();
    const result = await capture(gateway, 'hash', { content: 'x' });
    // Rule 9b, surfaced to the model so it does not tell the user the decision
    // is now recorded as active.
    expect(result.message).toMatch(/not .*authoritative|awaiting triage/i);
  });
});

describe('CAPTURE_INPUT_SCHEMA', () => {
  it('requires only content — rule 22a, capture is one step', () => {
    expect(CAPTURE_INPUT_SCHEMA.required).toEqual(['content']);
  });

  it('carries no zod, so it cannot drift with the project version', () => {
    expect(CAPTURE_INPUT_SCHEMA.type).toBe('object');
    expect(CAPTURE_INPUT_SCHEMA.additionalProperties).toBe(false);
  });

  it('constrains source to real source types', () => {
    expect(CAPTURE_INPUT_SCHEMA.properties.source.enum).toContain('claude_chat');
    expect(CAPTURE_INPUT_SCHEMA.properties.source.enum).not.toContain('guess');
  });
});
