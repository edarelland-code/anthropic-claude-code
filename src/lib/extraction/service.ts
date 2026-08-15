/**
 * One analysis, end to end (Phase 6G).
 *
 * A pure orchestration of parts that are each testable on their own:
 *
 *   assess size → warn about credentials → chunk → provider (per chunk)
 *   → validate → merge across chunks → annotate with duplicates and conflicts
 *
 * It writes nothing. The caller persists the result, which keeps this function
 * a pure `(source, provider) => suggestions` and means the guarantees can be
 * asserted without a database — the same discipline `assembleResumeContext`
 * follows for Resume.
 *
 * If a chunk fails, the run is `partial` rather than lost: the chunks that
 * succeeded still produce suggestions, the failure is named, and the raw source
 * is untouched in the Inbox either way (6V).
 */

import type { ConflictProposal, DuplicateProposal } from '@/lib/domain/types';

import { annotate, comparisonKey, mergeAcrossChunks, type AnnotatedSuggestion } from './merge';
import { assessSource, chunkSource, findSecrets, secretWarning, type SecretFinding } from './prepare';
import { EXTRACTION_PROMPT_VERSION } from './prompt';
import { validateExtractionResult } from './validate';
import {
  ExtractionError,
  type ExistingContext,
  type ExtractionProvider,
  type SuggestedRecord,
} from './types';

export interface ExtractionInput {
  source: string;
  provider: ExtractionProvider;
  existingContext: ExistingContext | null;
  topicId: string | null;
  subtopicId: string | null;
  /** Ids that exist, so a suggested destination that names nothing is refused. */
  knownTopicIds: Set<string>;
  knownSubtopicIds: Set<string>;
  /** Deterministic findings, keyed by `comparisonKey`. Never from the provider. */
  duplicates?: Map<string, DuplicateProposal>;
  conflicts?: Map<string, ConflictProposal>;
  /** The user has seen the credential warning and chosen to continue. */
  secretsAcknowledged?: boolean;
}

export interface ExtractionOutcome {
  status: 'succeeded' | 'partial' | 'failed';
  provider: string;
  model: string | null;
  promptVersion: string;
  chunkCount: number;
  suggestions: AnnotatedSuggestion[];
  summary: string | null;
  topicSuggestions: string[];
  subtopicSuggestions: string[];
  warnings: string[];
  /** Malformed provider output, surfaced rather than swallowed (6Z). */
  rejected: string[];
  secrets: SecretFinding[];
  usage: { inputTokens: number; outputTokens: number } | null;
  failureCode: string | null;
  failureDetail: string | null;
}

const empty = (over: Partial<ExtractionOutcome>): ExtractionOutcome => ({
  status: 'failed',
  provider: '',
  model: null,
  promptVersion: EXTRACTION_PROMPT_VERSION,
  chunkCount: 0,
  suggestions: [],
  summary: null,
  topicSuggestions: [],
  subtopicSuggestions: [],
  warnings: [],
  rejected: [],
  secrets: [],
  usage: null,
  failureCode: null,
  failureDetail: null,
  ...over,
});

export async function runExtraction(input: ExtractionInput): Promise<ExtractionOutcome> {
  const { provider } = input;

  if (!provider.isConfigured()) {
    return empty({
      provider: provider.id,
      failureCode: 'not_configured',
      failureDetail: provider.configurationProblem(),
      warnings: [provider.configurationProblem() ?? 'That provider is not configured.'],
    });
  }

  const size = assessSource(input.source);
  if (size.tooLarge) {
    // Refused, not truncated. A review that silently covered the first half of
    // a transcript would look complete and be wrong.
    return empty({
      provider: provider.id,
      failureCode: 'too_large',
      failureDetail: size.message,
      warnings: [size.message],
    });
  }

  // Only worth scanning when the content would actually leave the machine.
  const secrets = provider.sendsContentExternally ? findSecrets(input.source) : [];
  if (secrets.length > 0 && !input.secretsAcknowledged) {
    return empty({
      provider: provider.id,
      failureCode: 'secrets_unacknowledged',
      failureDetail: secretWarning(secrets),
      secrets,
      warnings: [secretWarning(secrets) ?? ''],
    });
  }

  const chunks = chunkSource(input.source);
  const collected: SuggestedRecord[] = [];
  const warnings: string[] = [];
  const rejected: string[] = [];
  let summary: string | null = null;
  const topicSuggestions = new Set<string>();
  const subtopicSuggestions = new Set<string>();
  let inputTokens = 0;
  let outputTokens = 0;
  let failed = 0;
  let lastFailure: ExtractionError | Error | null = null;

  for (const chunk of chunks) {
    try {
      const raw = await provider.extract({
        source: chunk.text,
        lineOffset: chunk.lineOffset,
        chunkIndex: chunk.index,
        chunkCount: chunks.length,
        existingContext: input.existingContext,
        topicId: input.topicId,
        subtopicId: input.subtopicId,
      });

      const { result, rejected: bad } = validateExtractionResult(raw, {
        topicIds: input.knownTopicIds,
        subtopicIds: input.knownSubtopicIds,
        // Provenance is required whenever the source has lines to point at,
        // which is always — but a chunk of pure whitespace has nothing.
        requireProvenance: chunk.text.trim() !== '',
      });

      for (const r of bad) rejected.push(chunks.length > 1 ? `part ${chunk.index + 1}: ${r}` : r);
      for (const w of result.warnings) if (!warnings.includes(w)) warnings.push(w);
      for (const t of result.topicSuggestions) topicSuggestions.add(t);
      for (const t of result.subtopicSuggestions) subtopicSuggestions.add(t);
      summary ??= result.summary;
      inputTokens += result.usage?.inputTokens ?? 0;
      outputTokens += result.usage?.outputTokens ?? 0;

      collected.push(...result.records.map((r) => ({ ...r, chunkIndex: chunk.index })));
    } catch (cause) {
      failed += 1;
      lastFailure = cause instanceof Error ? cause : new Error(String(cause));
      warnings.push(
        chunks.length > 1
          ? `Part ${chunk.index + 1} of ${chunks.length} could not be analysed: ${lastFailure.message} The other parts were still read.`
          : `The analysis failed: ${lastFailure.message}`,
      );
    }
  }

  if (failed === chunks.length) {
    return empty({
      provider: provider.id,
      model: provider.model,
      chunkCount: chunks.length,
      warnings,
      secrets,
      failureCode: lastFailure instanceof ExtractionError ? lastFailure.code : 'provider_error',
      // The provider's own explanation is kept alongside the message. Dropping
      // it left `failure_detail` saying only "returned 401", which names the
      // symptom and not one thing the reader can act on.
      failureDetail:
        lastFailure instanceof ExtractionError && lastFailure.detail
          ? `${lastFailure.message} (${lastFailure.detail})`
          : (lastFailure?.message ?? null),
    });
  }

  const merged = mergeAcrossChunks(collected);
  if (merged.collapsed > 0) {
    warnings.push(
      `${merged.collapsed} suggestion${merged.collapsed === 1 ? '' : 's'} appeared in more than one part of the source and ${merged.collapsed === 1 ? 'was' : 'were'} combined into one.`,
    );
  }

  const suggestions = annotate({
    records: merged.records,
    duplicates: input.duplicates ?? new Map(),
    conflicts: input.conflicts ?? new Map(),
  });

  return {
    status: failed > 0 ? 'partial' : 'succeeded',
    provider: provider.id,
    model: provider.model,
    promptVersion: EXTRACTION_PROMPT_VERSION,
    chunkCount: chunks.length,
    suggestions,
    summary,
    topicSuggestions: [...topicSuggestions],
    subtopicSuggestions: [...subtopicSuggestions],
    warnings,
    rejected,
    secrets,
    usage: inputTokens + outputTokens > 0 ? { inputTokens, outputTokens } : null,
    failureCode: failed > 0 ? 'partial_chunk_failure' : null,
    failureDetail: failed > 0 ? (lastFailure?.message ?? null) : null,
  };
}

export { comparisonKey };
