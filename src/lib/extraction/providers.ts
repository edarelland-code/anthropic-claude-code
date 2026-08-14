/**
 * The providers, and how one is chosen (Phase 6B/6C/6E).
 *
 * Two exist. Only one is usable today, and that is the point:
 *
 *   * `deterministic` needs no credential, sends nothing anywhere, and reuses
 *     the Phase 3 extractor and classifier. It is what makes the whole review
 *     layer work without a paid dependency, and it is the honest floor —
 *     everything the product claims about suggestion, provenance, review and
 *     confirmation is true with this provider alone.
 *
 *   * `anthropic` is written against the same interface and is deliberately
 *     NOT wired to a client. It reports itself unconfigured, names what it
 *     needs, and refuses to run. Connecting it means an API key and a paid
 *     account, which is the user's decision to make and not this code's.
 *
 * ContextShelf must keep working with neither (6C). Nothing here is on the
 * path of Quick Capture, the Inbox, import, search or Resume.
 */

import { extractSegments } from '@/lib/ingestion/extract';
import { suggestKnowledgeType } from '@/lib/ingestion/classify';

import { EXTRACTION_PROMPT_VERSION } from './prompt';
import {
  ExtractionError,
  type ExtractionProvider,
  type ExtractionRequest,
  type ExtractionResult,
  type SuggestedRecord,
} from './types';

// ---------------------------------------------------------------------------
// Deterministic
// ---------------------------------------------------------------------------

/** Knowledge types that are really their own record in ContextShelf. */
const AS_OWN_RECORD: Partial<Record<string, SuggestedRecord['kind']>> = {
  decision: 'decision',
  idea: 'idea',
  rejected_idea: 'idea',
  prompt: 'prompt',
  winning_prompt: 'prompt',
  next_step: 'action',
  blocker: 'action',
  question: 'action',
};

const ACTION_KIND_FOR: Record<string, string> = {
  next_step: 'next_step',
  blocker: 'blocker',
  question: 'question',
};

/**
 * Path A and Path B, wearing the provider interface.
 *
 * Path A reads the labels the author wrote — `Decision:`, `TODO:` — and is
 * quoted at confidence 1 because it is reading, not guessing. Path B looks at
 * phrasing and never exceeds 0.75, because it is guessing.
 *
 * It suggests no `current_state` and no `relationship`. Both require judgement
 * about the project as a whole rather than about a sentence, and a keyword
 * matcher proposing "here is your new Current State" would be the system
 * pretending to understand.
 */
export const deterministicProvider: ExtractionProvider = {
  id: 'deterministic',
  label: 'Built-in (no model)',
  model: null,
  isConfigured: () => true,
  configurationProblem: () => null,
  sendsContentExternally: false,

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    const { segments, notes } = extractSegments(request.source);
    const records: SuggestedRecord[] = [];

    for (const segment of segments) {
      // Path A stated a type, or Path B proposes one from the phrasing.
      const suggestion = segment.knowledgeType
        ? { value: segment.knowledgeType, confidence: 1, basis: ['the source labelled this explicitly'] }
        : suggestKnowledgeType(`${segment.title}\n${segment.content ?? ''}`);
      if (!suggestion) continue;

      const type = suggestion.value;
      const kind = AS_OWN_RECORD[type] ?? 'knowledge_entry';

      records.push({
        kind,
        knowledgeType: kind === 'knowledge_entry' ? type : undefined,
        title: segment.title,
        content: segment.content,
        reason: null,
        statusSuggestion: kind === 'action' ? 'open' : kind === 'decision' ? 'proposed' : null,
        suggestedTopicId: request.topicId,
        suggestedSubtopicId: request.subtopicId,
        // Offsets are rewritten into whole-source coordinates so a reference
        // from chunk 3 still points at the right line of the original.
        sourceReference: shiftReference(segment.sourceReference, request.lineOffset),
        confidence: suggestion.confidence,
        basis: suggestion.basis,
        payload: kind === 'action' ? { actionKind: ACTION_KIND_FOR[type] ?? 'next_step' } : {},
        chunkIndex: request.chunkIndex,
      });
    }

    return {
      summary: null,
      topicSuggestions: [],
      subtopicSuggestions: [],
      records,
      warnings: [
        ...notes,
        'Built-in extraction reads labels and phrasing. It does not understand the conversation, so it will miss things a reader would catch — review the source alongside these suggestions.',
      ],
    };
  },
};

/**
 * Rewrites `L4-L9` from a chunk into the whole source's numbering.
 *
 * Silently wrong line numbers are the worst outcome of chunking: a reference
 * that resolves confidently to the wrong paragraph is less useful than none.
 */
export function shiftReference(reference: string | null, lineOffset: number): string | null {
  if (!reference) return null;
  if (lineOffset <= 1) return reference;
  const match = /^L(\d+)(?:-L(\d+))?$/.exec(reference);
  if (!match) return reference;
  const start = Number(match[1]) + lineOffset - 1;
  const end = match[2] ? Number(match[2]) + lineOffset - 1 : null;
  return end ? `L${start}-L${end}` : `L${start}`;
}

// ---------------------------------------------------------------------------
// Anthropic — written, not connected
// ---------------------------------------------------------------------------

/**
 * The shape an Anthropic-backed provider takes, and the reason it is inert.
 *
 * ContextShelf exists to support Claude workflows, so Anthropic is the natural
 * choice and this is written against the same interface so that connecting it
 * is a configuration change rather than a redesign. What it needs is an API key
 * and therefore a paid account — a dependency the product does not have and
 * that nobody should acquire on the user's behalf.
 *
 * There is also a second, quieter reason it stops here: a key belongs in the
 * server environment, not in a table. Storing one per user would mean
 * encrypting it at rest, which means a key-management dependency this
 * deployment does not have. Until that is decided, "not configured" is the
 * honest state, and it is reported rather than hidden.
 */
export const anthropicProvider: ExtractionProvider = {
  id: 'anthropic',
  label: 'Anthropic (Claude)',
  model: process.env.CONTEXTSHELF_EXTRACTION_MODEL ?? 'claude-sonnet-4-5',
  isConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY),
  configurationProblem: () =>
    process.env.ANTHROPIC_API_KEY
      ? null
      : 'ANTHROPIC_API_KEY is not set. Model-assisted extraction needs an Anthropic API key in the server environment; built-in extraction works without one.',
  sendsContentExternally: true,

  async extract(): Promise<ExtractionResult> {
    // Not a stub that silently returns nothing — that would look like a source
    // with no records in it. It refuses, by name, with the reason.
    throw new ExtractionError(
      'The Anthropic provider is not connected in this build.',
      'not_configured',
      `Prompt version ${EXTRACTION_PROMPT_VERSION} is ready and the contract is implemented, but no API client is wired and no key is configured. Use built-in extraction, or see docs/DEPLOYMENT.md.`,
    );
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const PROVIDERS: readonly ExtractionProvider[] = [deterministicProvider, anthropicProvider];

export function providerById(id: string): ExtractionProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/**
 * The provider a run uses when the caller does not name one.
 *
 * Prefers a configured model provider, falls back to the built-in one. The
 * fallback is not a degraded mode to apologise for — it is the guarantee that
 * the review workflow exists whether or not anyone ever pays for a key.
 */
export function defaultProvider(): ExtractionProvider {
  const configured = PROVIDERS.find((p) => p.id !== 'deterministic' && p.isConfigured());
  return configured ?? deterministicProvider;
}

export interface ProviderStatus {
  id: string;
  label: string;
  model: string | null;
  configured: boolean;
  problem: string | null;
  sendsContentExternally: boolean;
}

/** What Settings renders. Never includes a key, configured or not. */
export function providerStatuses(): ProviderStatus[] {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    model: p.model,
    configured: p.isConfigured(),
    problem: p.configurationProblem(),
    sendsContentExternally: p.sendsContentExternally,
  }));
}
