import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { runExtraction } from './service';
import { caseWithSecrets } from './fixtures';
import { anthropicProvider, providerStatuses } from './providers';
import type { ExtractionProvider, ExtractionResult } from './types';

/**
 * The guarantees that must hold BEFORE a key ever exists (Phase 6 readiness,
 * points 9 and 10).
 *
 * Both are about when a live request may happen, and both are the kind of
 * property that is easy to break later by accident — so they are asserted here
 * rather than left to the reviewer of a future diff.
 */

const sending: ExtractionProvider = {
  id: 'test-sending',
  label: 'A provider that would send',
  model: 'test-model',
  isConfigured: () => true,
  configurationProblem: () => null,
  sendsContentExternally: true,
  extract: async (): Promise<ExtractionResult> => {
    throw new Error('the provider was called, which this test exists to prevent');
  },
};

const base = {
  existingContext: null,
  topicId: null,
  subtopicId: null,
  knownTopicIds: new Set<string>(),
  knownSubtopicIds: new Set<string>(),
};

describe('the credential gate stands in front of any provider that sends', () => {
  it('refuses before calling out when the source looks like it holds credentials', async () => {
    // The provider throws if reached. Reaching it IS the failure.
    const outcome = await runExtraction({ ...base, source: caseWithSecrets, provider: sending });
    expect(outcome.status).toBe('failed');
    expect(outcome.failureCode).toBe('secrets_unacknowledged');
    expect(outcome.secrets.length).toBeGreaterThan(0);
    expect(outcome.suggestions).toHaveLength(0);
  });

  it('only proceeds once a person has acknowledged it', async () => {
    const outcome = await runExtraction({
      ...base,
      source: caseWithSecrets,
      provider: sending,
      secretsAcknowledged: true,
    });
    // Now it reaches the provider — which throws — so the run fails for that
    // reason instead. The gate is what moved, not the outcome.
    expect(outcome.failureCode).not.toBe('secrets_unacknowledged');
  });

  it('does not scan for a provider that sends nothing anywhere', async () => {
    const local: ExtractionProvider = { ...sending, sendsContentExternally: false, extract: async () => ({
      summary: null, topicSuggestions: [], subtopicSuggestions: [], records: [], warnings: [],
    }) };
    const outcome = await runExtraction({ ...base, source: caseWithSecrets, provider: local });
    // Nothing leaves the machine, so there is nothing to warn about — warning
    // anyway would train the user to click through it.
    expect(outcome.secrets).toHaveLength(0);
    expect(outcome.status).toBe('succeeded');
  });

  it('refuses an unconfigured provider before it reads the source at all', async () => {
    const unconfigured: ExtractionProvider = {
      ...sending,
      isConfigured: () => false,
      configurationProblem: () => 'no key',
    };
    const outcome = await runExtraction({ ...base, source: 'anything', provider: unconfigured });
    expect(outcome.failureCode).toBe('not_configured');
  });
});

/**
 * What Settings says about the provider, at each of the three states it can be
 * in. Both of these were found by connecting a real key rather than by reading
 * the code, which is why they are pinned here now.
 */
describe('the provider reports its own state truthfully', () => {
  const KEY = 'ANTHROPIC_API_KEY';
  const MODEL = 'CONTEXTSHELF_EXTRACTION_MODEL';
  const set = (k: string, v: string | undefined) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };
  const original = { key: process.env[KEY], model: process.env[MODEL] };
  afterEach(() => {
    set(KEY, original.key);
    set(MODEL, original.model);
  });

  it('reports no problem at all once both variables are present', () => {
    set(KEY, 'sk-ant-test-not-a-real-key');
    set(MODEL, 'claude-test-model');
    expect(anthropicProvider.isConfigured()).toBe(true);
    // The chain used to fall through to the model message whenever a key
    // existed, so a fully configured deployment claimed the model identifier
    // was unset on the same row that displayed it.
    expect(anthropicProvider.configurationProblem()).toBeNull();
    expect(anthropicProvider.model).toBe('claude-test-model');
  });

  it('names the missing variable, and only the missing one', () => {
    set(KEY, 'sk-ant-test-not-a-real-key');
    set(MODEL, undefined);
    expect(anthropicProvider.configurationProblem()).toMatch(/CONTEXTSHELF_EXTRACTION_MODEL is not set/);

    set(KEY, undefined);
    set(MODEL, 'claude-test-model');
    expect(anthropicProvider.configurationProblem()).toMatch(/ANTHROPIC_API_KEY is not set/);

    set(MODEL, undefined);
    expect(anthropicProvider.configurationProblem()).toMatch(/ANTHROPIC_API_KEY and CONTEXTSHELF_EXTRACTION_MODEL/);
  });

  it('marks exactly one provider active, and it is the one a run would use', () => {
    set(KEY, undefined);
    set(MODEL, undefined);
    const unconfigured = providerStatuses();
    expect(unconfigured.filter((p) => p.active).map((p) => p.id)).toEqual(['deterministic']);

    set(KEY, 'sk-ant-test-not-a-real-key');
    set(MODEL, 'claude-test-model');
    const configured = providerStatuses();
    // The built-in provider is always configured, so "the first configured
    // one" named it active while every run went to the model instead.
    expect(configured.filter((p) => p.active).map((p) => p.id)).toEqual(['anthropic']);
    expect(configured.find((p) => p.id === 'deterministic')?.configured).toBe(true);
  });

  it('never reports a key in any status it exposes', () => {
    set(KEY, 'sk-ant-test-not-a-real-key');
    set(MODEL, 'claude-test-model');
    expect(JSON.stringify(providerStatuses())).not.toContain('sk-ant-');
  });
});

/**
 * The request Anthropic actually receives, and the two answers that arrive as
 * HTTP 200 and are not an answer. All three were found by making real calls.
 */
describe('the Anthropic request and its non-answers', () => {
  const KEY = 'ANTHROPIC_API_KEY';
  const MODEL = 'CONTEXTSHELF_EXTRACTION_MODEL';
  const original = { key: process.env[KEY], model: process.env[MODEL], fetch: globalThis.fetch };

  const request = {
    source: 'User: we approved the adapter change.',
    lineOffset: 1,
    chunkIndex: 0,
    chunkCount: 1,
    existingContext: null,
    topicId: null,
    subtopicId: null,
  };

  /** Captures the body and answers with whatever the case needs. */
  const stub = (payload: unknown, status = 200) => {
    const seen: { body: Record<string, unknown> | null } = { body: null };
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      seen.body = JSON.parse(init.body);
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      };
    }) as unknown as typeof fetch;
    return seen;
  };

  beforeEach(() => {
    process.env[KEY] = 'sk-ant-test-not-a-real-key';
    process.env[MODEL] = 'claude-test-model';
  });

  afterEach(() => {
    if (original.key === undefined) delete process.env[KEY];
    else process.env[KEY] = original.key;
    if (original.model === undefined) delete process.env[MODEL];
    else process.env[MODEL] = original.model;
    globalThis.fetch = original.fetch;
  });

  it('sends no sampling parameters at all', async () => {
    const seen = stub({
      content: [{ type: 'text', text: '{"records":[]}' }],
      usage: { input_tokens: 10, output_tokens: 2 },
    });
    await anthropicProvider.extract(request);
    // Current models refuse these outright, and asking for temperature 0
    // never bought reproducibility on the models that did accept it.
    expect(seen.body).not.toHaveProperty('temperature');
    expect(seen.body).not.toHaveProperty('top_p');
    expect(seen.body).not.toHaveProperty('top_k');
  });

  it('leaves room for reasoning inside the token budget', async () => {
    const seen = stub({ content: [{ type: 'text', text: '{"records":[]}' }] });
    await anthropicProvider.extract(request);
    // Reasoning and answer share this budget on current models, so a budget
    // sized for the answer alone returns JSON cut off mid-record.
    expect(seen.body?.max_tokens).toBeGreaterThanOrEqual(16_000);
  });

  it('reports a truncated answer as truncation, not as malformed JSON', async () => {
    stub({ content: [{ type: 'text', text: '{"records":[{"kind":"dec' }], stop_reason: 'max_tokens' });
    await expect(anthropicProvider.extract(request)).rejects.toThrow(/ran out of room/i);
  });

  it('reports a refusal as a refusal, and says the source is untouched', async () => {
    stub({ content: [], stop_reason: 'refusal', stop_details: { category: 'cyber' } });
    await expect(anthropicProvider.extract(request)).rejects.toThrow(/declined to read/i);
  });

  it('names a rejected key rather than only its status code', async () => {
    stub({ error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401);
    // "returned 401" sends a reader checking their model and their network
    // before the one thing it can actually be.
    await expect(anthropicProvider.extract(request)).rejects.toThrow(/rejected the API key/i);
  });
});

describe('machine ingestion never triggers a model', () => {
  it('the /api/ingest route imports nothing from the extraction layer', () => {
    // Phase 5 deliveries arrive unattended and can arrive in bursts. A model
    // call on that path would be an unbounded, unattended cost and an
    // unattended send of the user's source — so the route must not be able to
    // reach extraction at all, not merely choose not to.
    const route = readFileSync(
      resolve(process.cwd(), 'src/app/api/ingest/route.ts'),
      'utf8',
    );
    expect(route).not.toMatch(/from '@\/lib\/extraction/);
    expect(route).not.toMatch(/runExtraction|anthropicProvider|defaultProvider/);
  });

  it('the ingestion pipeline itself does not reach the extraction layer', () => {
    for (const file of ['adapters.ts', 'extract.ts', 'classify.ts', 'schema.ts']) {
      const source = readFileSync(resolve(process.cwd(), 'src/lib/ingestion', file), 'utf8');
      expect(source, file).not.toMatch(/from '\.\.\/extraction|@\/lib\/extraction/);
    }
  });
});
