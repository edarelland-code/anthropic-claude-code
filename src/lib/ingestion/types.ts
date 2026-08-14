/**
 * The ingestion funnel's vocabulary (ARCHITECTURE §9).
 *
 * CLAUDE.md rule 20: every path into the system goes adapter → normalizer →
 * persist → classify. Pasting into the Inbox is an *adapter*, not a special
 * case; so is a Claude Code hook, a JSON import, and a URL. New sources are new
 * adapters, never new write paths, which is what keeps one funnel testable
 * instead of five that drift.
 */

import type { KnowledgeType, SourceType } from '@/lib/domain/types';

/**
 * A candidate Layer 2 entry, carved out of Layer 1.
 *
 * `knowledgeType` is nullable on purpose. Path A only assigns a type when the
 * text says so outright ("Decision: …"); a paragraph that merely reads like a
 * decision gets `null` here and a *suggestion* separately. Collapsing the two
 * would make a guess indistinguishable from a fact by the time it reaches the
 * database.
 */
export interface NormalizedSegment {
  /** Non-null only when the source stated the type explicitly. */
  knowledgeType: KnowledgeType | null;
  title: string;
  content: string | null;
  /** An anchor back into `raw`: `L12-L20`, `msg:3`. Never invented. */
  sourceReference: string | null;
  /** 1 when the source stated it; below 1 only ever on a suggestion. */
  confidence: number;
  occurredAt?: string;
}

/** Claude Code specifics, carried straight through to `source_sessions`. */
export interface ClaudeCodeMetadata {
  repoUrl?: string;
  branch?: string;
  commitSha?: string;
  filesChanged?: string[];
  filesAdded?: string[];
  filesRemoved?: string[];
  buildStatus?: string;
  testSummary?: string;
}

/**
 * The canonical payload every adapter emits.
 *
 * Nothing downstream of this knows where the data came from, which is the
 * point: the persister, the triage screen and the tests all see one shape.
 */
export interface NormalizedIngestion {
  adapterId: string;
  sourceType: SourceType;
  title?: string;
  occurredAt?: string;
  externalUrl?: string;
  /** Verbatim Layer 1. Stored unedited, and never reconstructed from segments. */
  raw: string;
  segments: NormalizedSegment[];
  code?: ClaudeCodeMetadata;
  /** Free-text hints from the source. Suggestions only — never applied. */
  hints?: { topic?: string; subtopic?: string; tags?: string[] };
  /** Structured payload kept alongside the raw text for audit. */
  payload?: Record<string, unknown>;
  /** Non-fatal problems worth showing the user before they import. */
  warnings?: string[];
}

export interface IngestionAdapter<TInput = string> {
  id: string;
  /** What a person would call this route in. */
  label: string;
  sourceType: SourceType;
  /**
   * Cheap, side-effect-free shape test for the "paste anything" Inbox.
   * Returning false must never mean "cannot parse" — only "not mine".
   */
  detect(input: unknown): boolean;
  parse(input: TInput): NormalizedIngestion;
}

/** Raised when an adapter is handed input it recognised but cannot read. */
export class IngestionError extends Error {
  constructor(
    message: string,
    readonly adapterId: string,
  ) {
    super(message);
    this.name = 'IngestionError';
  }
}
