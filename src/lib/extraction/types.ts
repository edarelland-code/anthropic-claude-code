/**
 * The extraction contract (Phase 6B/6D).
 *
 * One vocabulary that a model, a keyword matcher, or anything else can speak.
 * Nothing in this file names a vendor, and nothing in it is authoritative: the
 * output type is `SuggestedRecord`, which is not assignable to any domain
 * record and has to be confirmed by a person before it becomes one.
 *
 * The shape mirrors `Suggestion<T>` from Phase 3 rather than inventing a second
 * idea of what a proposal is — `confidence` plus `basis`, the literal evidence,
 * so a suggestion can always be audited rather than merely believed.
 */

import type { ActionStatus, KnowledgeType, RelationshipType } from '@/lib/domain/types';

export const SUGGESTION_KINDS = [
  'knowledge_entry',
  'decision',
  'idea',
  'prompt',
  'action',
  'current_state',
  'relationship',
] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

/**
 * The kinds a confirmation may never make authoritative on its own.
 *
 * Used to decide what may be pre-selected in review (6H) and asserted in tests.
 * A decision confirmed from a suggestion is written `proposed`; an idea
 * `suggested`; Current State is not written by the batch path at all. Listing
 * them here means "which of these is authority-changing" is answerable by
 * reading one array rather than by tracing three screens.
 */
export const AUTHORITY_CHANGING_KINDS: readonly SuggestionKind[] = [
  'decision',
  'current_state',
];

export interface SuggestedRecord {
  kind: SuggestionKind;
  /** Required when `kind` is `knowledge_entry`, absent otherwise. */
  knowledgeType?: KnowledgeType;
  title: string;
  content?: string | null;
  /** Why the source supports this — never the model's private reasoning. */
  reason?: string | null;
  /** e.g. `open` for an action. Validated against the target's own enum. */
  statusSuggestion?: string | null;
  suggestedTopicId?: string | null;
  suggestedSubtopicId?: string | null;
  /** An anchor into the source: `L12-L20`, `msg:3`. Never invented. */
  sourceReference?: string | null;
  /** 0–1. Never compared against a threshold to skip confirmation. */
  confidence: number;
  /** The literal evidence, e.g. ['the source says "approved, proceed with X"']. */
  basis: string[];
  /** Kind-specific extras: an action's kind, a relationship's two ends. */
  payload?: Record<string, unknown>;
  /** Set by the chunker, so a suggestion can be traced to the slice it came from. */
  chunkIndex?: number;
}

export interface SuggestedRelationship extends SuggestedRecord {
  kind: 'relationship';
  payload: {
    fromType: string;
    fromId: string;
    toType: string;
    toId: string;
    relationshipType: RelationshipType;
  };
}

export interface SuggestedAction extends SuggestedRecord {
  kind: 'action';
  statusSuggestion: ActionStatus;
}

/** What a provider returns. Validated before anything reads it (6Z). */
export interface ExtractionResult {
  summary: string | null;
  topicSuggestions: string[];
  subtopicSuggestions: string[];
  records: SuggestedRecord[];
  warnings: string[];
  usage?: { inputTokens?: number; outputTokens?: number };
}

/**
 * What a provider is given.
 *
 * `existingContext` is a BOUNDED summary of what ContextShelf already holds
 * (6I) — titles and current state, never the whole topic history and never a
 * raw transcript. Its purpose is to let a provider say "this looks like the
 * decision you already have" rather than to teach it the project.
 */
export interface ExtractionRequest {
  /** One chunk of the source, verbatim. */
  source: string;
  /** Line offset of this chunk within the whole source, so references resolve. */
  lineOffset: number;
  chunkIndex: number;
  chunkCount: number;
  existingContext: ExistingContext | null;
  /** Where the user is filing it, when they have already chosen. */
  topicId: string | null;
  subtopicId: string | null;
}

export interface ExistingContext {
  topicName: string | null;
  subtopicName: string | null;
  currentState: string | null;
  activeDecisions: string[];
  ideaTitles: string[];
  promptTitles: string[];
  openActions: string[];
  constraints: string[];
}

/**
 * A provider.
 *
 * Deliberately tiny. Everything a provider must NOT do — decide duplicates,
 * resolve conflicts, write records, choose what is authoritative — is absent
 * from the interface rather than merely discouraged, so a new provider cannot
 * acquire those powers by implementing more methods.
 */
export interface ExtractionProvider {
  /** Stable identifier recorded on every run, e.g. `deterministic`. */
  id: string;
  label: string;
  /** The model name to record, when the provider has one. */
  model: string | null;
  /** False when the provider needs configuration it does not have. */
  isConfigured(): boolean;
  /** Why it is unavailable, in a sentence an operator can act on. */
  configurationProblem(): string | null;
  /** True when a call leaves this machine — drives the pre-send warning (6W). */
  sendsContentExternally: boolean;
  extract(request: ExtractionRequest): Promise<ExtractionResult>;
}

/** Raised when a provider answers with something that is not a result. */
export class ExtractionError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not_configured'
      | 'invalid_output'
      | 'provider_error'
      | 'too_large'
      | 'cancelled',
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}
