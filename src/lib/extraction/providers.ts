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

import { EXTRACTION_SYSTEM_PROMPT, renderRequest } from './prompt';
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
 * Anthropic, implemented and inert (Phase 6 readiness).
 *
 * The request is built here in full so that connecting it is a configuration
 * change rather than a redesign. It cannot fire: `isConfigured()` is false
 * without both an API key and a model identifier in the SERVER environment,
 * `runExtraction` refuses an unconfigured provider before it ever reaches
 * `extract()`, and `extract()` refuses again on its own.
 *
 * **No model is hard-coded.** `CONTEXTSHELF_EXTRACTION_MODEL` is the only
 * source of the identifier, and when it is unset the provider reports that
 * rather than substituting a default. A default would be a claim that some
 * particular model had been chosen and validated for this task, and none has.
 * A suggested starting point is documented in `docs/DEPLOYMENT.md`, where it is
 * a recommendation to a person rather than a value the code assumes.
 *
 * The key is read from `process.env` at call time and never held, logged,
 * returned, or written to `extraction_runs`. `model` IS recorded, because
 * "which model produced this suggestion" is exactly what an audit needs.
 */
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/** Read at call time, never cached, never exported. */
const anthropicKey = () => process.env.ANTHROPIC_API_KEY?.trim() || null;
const anthropicModel = () => process.env.CONTEXTSHELF_EXTRACTION_MODEL?.trim() || null;

export const anthropicProvider: ExtractionProvider = {
  id: 'anthropic',
  label: 'Anthropic (Claude)',
  get model() {
    return anthropicModel();
  },
  isConfigured: () => anthropicKey() !== null && anthropicModel() !== null,
  configurationProblem: () => {
    const key = anthropicKey();
    const model = anthropicModel();
    if (!key && !model) {
      return 'ANTHROPIC_API_KEY and CONTEXTSHELF_EXTRACTION_MODEL are not set. Both live in the server environment; built-in extraction works without either.';
    }
    if (!key) return 'ANTHROPIC_API_KEY is not set in the server environment.';
    return 'CONTEXTSHELF_EXTRACTION_MODEL is not set. No default is assumed, because no model has been validated for this task — see docs/DEPLOYMENT.md.';
  },
  sendsContentExternally: true,

  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    const key = anthropicKey();
    const model = anthropicModel();
    if (!key || !model) {
      // Refused by name. A stub returning an empty result would be
      // indistinguishable from a source containing nothing — the worst
      // available failure here, because the user would file nothing and
      // believe there was nothing to file.
      throw new ExtractionError(
        'AI-assisted extraction is not configured.',
        'not_configured',
        anthropicProvider.configurationProblem() ?? undefined,
      );
    }

    let response: Response;
    try {
      response = await fetch(ANTHROPIC_ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model,
          max_tokens: 8_000,
          // Zero, so the same source yields the same suggestions twice. A
          // review the user cannot reproduce is one they cannot check.
          temperature: 0,
          system: EXTRACTION_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: renderRequest(request) }],
        }),
      });
    } catch (cause) {
      throw new ExtractionError(
        'The model provider could not be reached.',
        'provider_error',
        cause instanceof Error ? cause.message : undefined,
      );
    }

    if (!response.ok) {
      // The status and the provider's own message, never the request — which
      // carries both the key and the user's source.
      const detail = await response.text().catch(() => '');
      const rejected = response.status === 401 || response.status === 403;
      throw new ExtractionError(
        // A bare "returned 401" sends someone looking at their model
        // identifier, their network and their payload before the one thing it
        // can actually be. The status alone is not an actionable sentence
        // (rule 17a), and this is the failure a first connection hits.
        rejected
          ? `The model provider rejected the API key (${response.status}). ANTHROPIC_API_KEY in the server environment is missing, mistyped, revoked, or belongs to a different account — it is not a problem with the source or the model identifier.`
          : `The model provider returned ${response.status}.`,
        rejected ? 'not_configured' : 'provider_error',
        detail.slice(0, 400),
      );
    }

    const body = (await response.json().catch(() => null)) as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    } | null;

    const text = (body?.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
      .trim();

    // Tolerate a fenced block around the JSON; refuse anything else. The
    // caller validates the parsed object against the schema regardless — this
    // only gets it as far as "is it JSON at all".
    const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new ExtractionError(
        'The model did not return JSON.',
        'invalid_output',
        json.slice(0, 200),
      );
    }

    // Usage is attached so it survives validation, which drops unknown fields.
    return {
      ...(parsed as Omit<ExtractionResult, 'usage'>),
      usage: {
        inputTokens: body?.usage?.input_tokens,
        outputTokens: body?.usage?.output_tokens,
      },
    } as ExtractionResult;
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
