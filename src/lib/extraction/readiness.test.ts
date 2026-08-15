import { afterEach, describe, expect, it } from 'vitest';
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
