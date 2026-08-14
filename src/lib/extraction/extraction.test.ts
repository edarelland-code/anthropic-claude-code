import { afterEach, describe, expect, it, vi } from 'vitest';

import { annotate, comparisonKey, mergeAcrossChunks } from './merge';
import {
  assessSource,
  chunkSource,
  findSecrets,
  secretWarning,
  MAX_SOURCE_CHARACTERS,
} from './prepare';
import { EXTRACTION_PROMPT_VERSION, EXTRACTION_SYSTEM_PROMPT, renderExistingContext } from './prompt';
import { defaultProvider, deterministicProvider, anthropicProvider, shiftReference } from './providers';
import { validateExtractionResult } from './validate';
import {
  caseAmbiguous,
  caseExplicitApproval,
  caseLargeTranscript,
  caseMixedTranscript,
  caseRecommendationOnly,
  caseWithSecrets,
} from './fixtures';
import type { ExtractionRequest, SuggestedRecord } from './types';

/**
 * Phase 6's guarantees, tested without a model.
 *
 * That is deliberate and is most of the point: every property the product
 * claims about suggestion, provenance, validation, duplicate collapse and the
 * confirm gate is enforced in deterministic code, so it holds whichever
 * provider is configured — and holds when none is.
 */

const request = (over: Partial<ExtractionRequest> = {}): ExtractionRequest => ({
  source: '',
  lineOffset: 1,
  chunkIndex: 0,
  chunkCount: 1,
  existingContext: null,
  topicId: null,
  subtopicId: null,
  ...over,
});

const extract = (source: string, over: Partial<ExtractionRequest> = {}) =>
  deterministicProvider.extract(request({ source, ...over }));

describe('the deterministic provider', () => {
  it('needs no configuration and sends nothing anywhere', () => {
    expect(deterministicProvider.isConfigured()).toBe(true);
    expect(deterministicProvider.configurationProblem()).toBeNull();
    expect(deterministicProvider.sendsContentExternally).toBe(false);
  });

  it('is the default when no model provider is configured', () => {
    expect(defaultProvider().id).toBe('deterministic');
  });

  it('reads an explicitly labelled decision, and marks it proposed', async () => {
    const { records } = await extract(caseExplicitApproval);
    const decision = records.find((r) => r.kind === 'decision');
    expect(decision?.title).toMatch(/Timeline merge lives in a database view/);
    // Never `active`, whatever the source said.
    expect(decision?.statusSuggestion).toBe('proposed');
  });

  it('does not turn a recommendation into a decision', async () => {
    // CASE 1. The single most damaging thing extraction could do.
    const { records } = await extract(caseRecommendationOnly);
    expect(records.filter((r) => r.kind === 'decision')).toHaveLength(0);
  });

  it('invents nothing from prose that says nothing', async () => {
    // CASE 5. Silence is not evidence, and neither is hedging.
    const { records } = await extract(caseAmbiguous);
    expect(records.filter((r) => r.kind === 'decision')).toHaveLength(0);
    for (const r of records) expect(r.confidence).toBeLessThan(0.8);
  });

  it('separates the record types in a mixed transcript', async () => {
    // CASE 4.
    const { records } = await extract(caseMixedTranscript);
    const kinds = new Set(records.map((r) => r.kind));
    expect(kinds).toContain('decision');
    expect(kinds).toContain('idea');
    expect(kinds).toContain('prompt');
    expect(kinds).toContain('action');
    const entryTypes = new Set(
      records.filter((r) => r.kind === 'knowledge_entry').map((r) => r.knowledgeType),
    );
    expect(entryTypes).toContain('bug');
    expect(entryTypes).toContain('fix');
  });

  it('files a question and a TODO as actions of the right kind', async () => {
    const { records } = await extract(caseMixedTranscript);
    const actions = records.filter((r) => r.kind === 'action');
    const kinds = actions.map((a) => a.payload?.actionKind);
    expect(kinds).toContain('question');
    expect(kinds).toContain('next_step');
    for (const a of actions) expect(a.statusSuggestion).toBe('open');
  });

  it('carries a source anchor on every record it proposes', async () => {
    const { records } = await extract(caseMixedTranscript);
    expect(records.length).toBeGreaterThan(0);
    for (const r of records) expect(r.sourceReference).toMatch(/^L\d+(-L\d+)?$/);
  });

  it('says what it is, rather than implying understanding', async () => {
    const { warnings } = await extract(caseMixedTranscript);
    expect(warnings.join(' ')).toMatch(/does not understand/);
  });
});

describe('the Anthropic provider — readiness, not operation', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
    process.env.CONTEXTSHELF_EXTRACTION_MODEL = env.CONTEXTSHELF_EXTRACTION_MODEL;
  });

  it('is unconfigured, and says which piece is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CONTEXTSHELF_EXTRACTION_MODEL;
    expect(anthropicProvider.isConfigured()).toBe(false);
    expect(anthropicProvider.configurationProblem()).toMatch(/ANTHROPIC_API_KEY/);
    expect(anthropicProvider.configurationProblem()).toMatch(/CONTEXTSHELF_EXTRACTION_MODEL/);
  });

  it('hard-codes no model', () => {
    // A default would be a claim that some model had been chosen and validated
    // for this task. None has, so the identifier comes from the environment or
    // it does not exist.
    delete process.env.CONTEXTSHELF_EXTRACTION_MODEL;
    expect(anthropicProvider.model).toBeNull();

    process.env.CONTEXTSHELF_EXTRACTION_MODEL = 'some-model-id';
    expect(anthropicProvider.model).toBe('some-model-id');
  });

  it('needs the model as well as the key before it will run', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-not-a-real-key';
    delete process.env.CONTEXTSHELF_EXTRACTION_MODEL;
    expect(anthropicProvider.isConfigured()).toBe(false);
    expect(anthropicProvider.configurationProblem()).toMatch(/no model has been validated/);
  });

  it('refuses by name rather than returning an empty result', async () => {
    // An empty result would be indistinguishable from a source containing
    // nothing — the user would file nothing and believe there was nothing.
    delete process.env.ANTHROPIC_API_KEY;
    await expect(anthropicProvider.extract(request())).rejects.toThrow(/not configured/i);
  });

  it('makes no network call while unconfigured', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CONTEXTSHELF_EXTRACTION_MODEL;
    const spy = vi.spyOn(globalThis, 'fetch');
    await anthropicProvider.extract(request()).catch(() => undefined);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('is never the default provider while unconfigured', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(defaultProvider().id).toBe('deterministic');
  });

  it('declares that it would send content off the machine', () => {
    expect(anthropicProvider.sendsContentExternally).toBe(true);
  });
});

describe('chunking keeps provenance true', () => {
  it('returns one chunk for an ordinary source', () => {
    expect(chunkSource(caseMixedTranscript)).toHaveLength(1);
  });

  it('splits a large transcript on turn boundaries', () => {
    const large = caseLargeTranscript();
    const chunks = chunkSource(large, 20_000);
    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk starts where the previous one ended — nothing is dropped.
    const rebuilt = chunks.map((c) => c.text).join('\n');
    expect(rebuilt).toBe(large);
  });

  it('gives each chunk its true line offset', () => {
    const chunks = chunkSource(caseLargeTranscript(), 20_000);
    const lines = caseLargeTranscript().split('\n');
    for (const chunk of chunks) {
      expect(lines[chunk.lineOffset - 1]).toBe(chunk.text.split('\n')[0]);
    }
  });

  it('never splits inside a fenced code block', () => {
    const fence = ['```', ...Array.from({ length: 400 }, (_, i) => `line ${i} of one block`), '```'];
    const source = ['User: here', '', ...fence, '', 'User: done'].join('\n');
    const chunks = chunkSource(source, 500);
    for (const c of chunks) {
      const fences = (c.text.match(/^```/gm) ?? []).length;
      expect(fences % 2).toBe(0);
    }
  });

  it('rewrites a chunk-local reference into whole-source coordinates', () => {
    expect(shiftReference('L4-L9', 101)).toBe('L104-L109');
    expect(shiftReference('L4', 1)).toBe('L4');
    expect(shiftReference('msg:3', 101)).toBe('msg:3');
    expect(shiftReference(null, 5)).toBeNull();
  });

  it('refuses an oversized source rather than truncating it', () => {
    const assessment = assessSource('x'.repeat(MAX_SOURCE_CHARACTERS + 1));
    expect(assessment.tooLarge).toBe(true);
    expect(assessment.message).toMatch(/Nothing has been sent/);
    expect(assessment.message).toMatch(/not be truncated/);
  });

  it('says in advance how many requests a large source will take', () => {
    const assessment = assessSource(caseLargeTranscript());
    expect(assessment.tooLarge).toBe(false);
    expect(assessment.message).toMatch(/characters will be analysed/);
  });
});

describe('cross-chunk merge', () => {
  const record = (over: Partial<SuggestedRecord>): SuggestedRecord => ({
    kind: 'decision',
    title: 'Use a database view for the timeline',
    content: null,
    confidence: 0.5,
    basis: [],
    sourceReference: 'L12',
    ...over,
  });

  it('collapses the same suggestion proposed in two chunks', () => {
    const { records, collapsed } = mergeAcrossChunks([
      record({ sourceReference: 'L12', basis: ['said at L12'] }),
      record({ sourceReference: 'L980', confidence: 0.9, basis: ['said again at L980'] }),
    ]);
    expect(records).toHaveLength(1);
    expect(collapsed).toBe(1);
    // The earliest anchor survives; the evidence accumulates.
    expect(records[0]!.sourceReference).toBe('L12');
    expect(records[0]!.confidence).toBe(0.9);
    expect(records[0]!.basis).toHaveLength(2);
  });

  it('keeps genuinely different suggestions apart', () => {
    const { records } = mergeAcrossChunks([
      record({ title: 'Use a database view' }),
      record({ title: 'Use an application-level merge' }),
    ]);
    expect(records).toHaveLength(2);
  });

  it('does not merge across kinds — an idea is not the decision of the same name', () => {
    const { records } = mergeAcrossChunks([record({ kind: 'decision' }), record({ kind: 'idea' })]);
    expect(records).toHaveLength(2);
    expect(comparisonKey(records[0]!)).not.toBe(comparisonKey(records[1]!));
  });

  it('collapses a real repeated decision in a chunked transcript', async () => {
    const chunks = chunkSource(caseLargeTranscript(), 20_000);
    const all: SuggestedRecord[] = [];
    for (const chunk of chunks) {
      const { records } = await extract(chunk.text, {
        lineOffset: chunk.lineOffset,
        chunkIndex: chunk.index,
        chunkCount: chunks.length,
      });
      all.push(...records);
    }
    const before = all.filter((r) => /database view for the timeline/i.test(r.title)).length;
    const after = mergeAcrossChunks(all).records.filter((r) =>
      /database view for the timeline/i.test(r.title),
    ).length;
    expect(before).toBeGreaterThan(1);
    expect(after).toBe(1);
  });
});

describe('what may be pre-selected', () => {
  const base: SuggestedRecord = {
    kind: 'knowledge_entry',
    knowledgeType: 'implementation',
    title: 'Wired the export button',
    confidence: 0.95,
    basis: [],
  };
  const none = { duplicates: new Map(), conflicts: new Map() };

  it('pre-selects a high-confidence, non-authority suggestion', () => {
    expect(annotate({ records: [base], ...none })[0]!.safeToPreselect).toBe(true);
  });

  it.each(['decision', 'current_state'] as const)(
    'never pre-selects a %s, however confident',
    (kind) => {
      const [annotated] = annotate({ records: [{ ...base, kind, knowledgeType: undefined, confidence: 1 }], ...none });
      expect(annotated!.safeToPreselect).toBe(false);
    },
  );

  it('never pre-selects something that looks like a duplicate', () => {
    const duplicates = new Map([
      [
        comparisonKey(base),
        {
          basis: 'exact' as const,
          entityType: 'knowledge_entry' as const,
          candidateId: '11111111-2222-3333-4444-555555555555',
          candidateTitle: 'Wired the export button',
          candidateOccurredAt: '2026-08-01T00:00:00Z',
          similarity: 1,
          reason: 'identical content',
        },
      ],
    ]);
    const [annotated] = annotate({ records: [base], duplicates, conflicts: new Map() });
    expect(annotated!.safeToPreselect).toBe(false);
    expect(annotated!.duplicateOf?.title).toBe('Wired the export button');
  });

  it('never pre-selects something in conflict, and shows both sides', () => {
    const conflicts = new Map([
      [
        comparisonKey(base),
        {
          decisionId: 'a',
          decisionTitle: 'Wired the export button',
          conflictsWithId: '11111111-2222-3333-4444-555555555555',
          conflictsWithTitle: 'Timeline merge lives in a view',
          similarity: 0.7,
          reason: 'these appear to be about the same subject',
        },
      ],
    ]);
    const [annotated] = annotate({ records: [base], duplicates: new Map(), conflicts });
    expect(annotated!.safeToPreselect).toBe(false);
    expect(annotated!.conflictsWith?.title).toBe('Timeline merge lives in a view');
  });

  it('leaves a low-confidence suggestion unticked', () => {
    const [annotated] = annotate({ records: [{ ...base, confidence: 0.4 }], ...none });
    expect(annotated!.safeToPreselect).toBe(false);
  });
});

describe('provider output validation', () => {
  const known = {
    topicIds: new Set(['11111111-2222-3333-4444-555555555555']),
    subtopicIds: new Set(['66666666-7777-8888-9999-aaaaaaaaaaaa']),
    requireProvenance: true,
  };
  const good = {
    kind: 'knowledge_entry',
    knowledgeType: 'implementation',
    title: 'Wired the export button',
    sourceReference: 'L12-L20',
    confidence: 0.8,
    basis: ['the source says "wired the export button"'],
  };

  it('accepts a well-formed record', () => {
    const { result, rejected } = validateExtractionResult({ records: [good] }, known);
    expect(rejected).toHaveLength(0);
    expect(result.records).toHaveLength(1);
  });

  it('keeps the valid records and reports the invalid ones', () => {
    // The policy that matters: nine good suggestions are not thrown away
    // because of a tenth, and the tenth is not swallowed.
    const { result, rejected } = validateExtractionResult(
      { records: [good, { ...good, kind: 'nonsense' }, { ...good, title: '' }] },
      known,
    );
    expect(result.records).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    expect(rejected.join(' ')).toMatch(/records\[1\]/);
    expect(rejected.join(' ')).toMatch(/records\[2\]/);
  });

  it.each([
    ['an unknown record type', { kind: 'promotion' }, /is not a record type/],
    ['an unknown knowledge type', { knowledgeType: 'vibes' }, /is not a knowledge type/],
    ['a knowledge type on a decision', { kind: 'decision', knowledgeType: 'bug' }, /belongs only on a knowledge_entry/],
    ['an absurd confidence', { confidence: 42 }, /between 0 and 1/],
    ['a negative confidence', { confidence: -1 }, /between 0 and 1/],
    ['a malformed source reference', { sourceReference: 'somewhere near the top' }, /is not an anchor/],
    ['a topic that does not exist', { suggestedTopicId: '99999999-9999-9999-9999-999999999999' }, /does not exist/],
    ['a topic id that is not a uuid', { suggestedTopicId: 'the main one' }, /not a uuid/],
  ])('rejects %s', (_label, patch, expected) => {
    const { result, rejected } = validateExtractionResult({ records: [{ ...good, ...patch }] }, known);
    expect(result.records).toHaveLength(0);
    expect(rejected.join(' ')).toMatch(expected);
  });

  it('rejects a record with no provenance when the source could supply it', () => {
    const { rejected } = validateExtractionResult(
      { records: [{ ...good, sourceReference: null }] },
      known,
    );
    expect(rejected.join(' ')).toMatch(/no sourceReference/);
  });

  it('refuses a proposed supersession outright', () => {
    // Superseding demands a reason and has its own function. Reaching it
    // through the generic relationship graph would be a way around that.
    const { rejected } = validateExtractionResult(
      {
        records: [
          {
            ...good,
            kind: 'relationship',
            knowledgeType: undefined,
            payload: {
              relationshipType: 'supersedes',
              fromId: '11111111-2222-3333-4444-555555555555',
              toId: '66666666-7777-8888-9999-aaaaaaaaaaaa',
            },
          },
        ],
      },
      known,
    );
    expect(rejected.join(' ')).toMatch(/Superseding is a review action of its own/);
  });

  it('corrects a decision the provider tried to mark active', () => {
    const { result } = validateExtractionResult(
      { records: [{ ...good, kind: 'decision', knowledgeType: undefined, statusSuggestion: 'active' }] },
      known,
    );
    expect(result.records[0]!.statusSuggestion).toBe('proposed');
  });

  it('caps an implausible number of records and says so', () => {
    const { result, rejected } = validateExtractionResult(
      { records: Array.from({ length: 500 }, () => good) },
      known,
    );
    expect(result.records.length).toBeLessThanOrEqual(200);
    expect(rejected.join(' ')).toMatch(/only the first 200/);
  });

  it('survives a provider returning something that is not an object', () => {
    for (const junk of [null, 'sorry, I cannot help with that', 42, []]) {
      const { result, rejected } = validateExtractionResult(junk, known);
      expect(result.records).toHaveLength(0);
      expect(rejected.length).toBeGreaterThan(0);
    }
  });
});

describe('secret detection', () => {
  it('finds the well-known credential shapes', () => {
    // CASE 8.
    const findings = findSecrets(caseWithSecrets);
    const labels = findings.map((f) => f.label);
    expect(labels).toContain('an Anthropic key');
    expect(labels).toContain('a JSON Web Token');
    expect(labels.some((l) => /password/.test(l))).toBe(true);
  });

  it('masks what it found rather than repeating it', () => {
    for (const finding of findSecrets(caseWithSecrets)) {
      expect(finding.excerpt).not.toContain('sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH');
      expect(finding.excerpt).toContain('…');
    }
  });

  it('warns without claiming to be exhaustive', () => {
    const warning = secretWarning(findSecrets(caseWithSecrets));
    expect(warning).toMatch(/may contain credentials/);
    expect(warning).toMatch(/not exhaustive/);
    expect(warning).toMatch(/stored original is never altered/);
  });

  it('says nothing about ordinary prose', () => {
    expect(findSecrets(caseMixedTranscript)).toHaveLength(0);
    expect(secretWarning([])).toBeNull();
  });
});

describe('the instruction', () => {
  it('is versioned, so a change in behaviour is traceable', () => {
    expect(EXTRACTION_PROMPT_VERSION).toMatch(/^\d+$/);
  });

  it('tells a provider the distinction the product depends on', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/A recommendation is NEVER a decision/);
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/infer that an unmentioned task was completed/);
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/Do not rewrite, tidy or shorten it/);
    expect(EXTRACTION_SYSTEM_PROMPT).toMatch(/USE ONLY THE PROVIDED SOURCE/);
  });

  it('sends bounded state, not the topic’s history', () => {
    const rendered = renderExistingContext({
      topicName: 'DailyRelay',
      subtopicName: null,
      currentState: 'Export path half-built.',
      activeDecisions: ['Receipts are ids'],
      ideaTitles: ['Browser companion'],
      promptTitles: ['Extraction prompt'],
      openActions: ['Render the receipt ids'],
      constraints: ['Nothing is ever destroyed'],
    });
    expect(rendered).toContain('DailyRelay');
    expect(rendered).toContain('Receipts are ids');
    // Titles only — no bodies, no transcripts, no history.
    expect(rendered).not.toMatch(/raw_content|transcript|superseded/i);
  });

  it('says plainly when there is no context to send', () => {
    expect(renderExistingContext(null)).toMatch(/none supplied/);
  });
});
