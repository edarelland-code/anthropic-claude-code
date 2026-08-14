/**
 * The adapters (ARCHITECTURE §9 stage 1).
 *
 * Each one turns a particular input shape into the same `NormalizedIngestion`.
 * That is their whole job: no adapter writes, classifies, or decides where
 * something belongs. Adding a source later — a browser companion, an MCP
 * pathway, a Claude Code hook — means adding a file here, not a write path
 * (rule 20).
 */

import type { SourceType } from '@/lib/domain/types';

import { extractSegments } from './extract';
import {
  validateClaudeSessionImport,
  type ClaudeSessionImport,
} from './schema';
import { IngestionError, type IngestionAdapter, type NormalizedIngestion, type NormalizedSegment } from './types';

/**
 * A typed note or an untriaged paste.
 *
 * Extracts nothing. Quick Capture must stay one step — paste, save — so this
 * adapter's contract is to preserve the text exactly and get out of the way.
 * Extraction happens later, in triage, when the user has decided where the
 * item belongs.
 */
export const manualNoteAdapter: IngestionAdapter<string> = {
  id: 'manual-note',
  label: 'Note',
  sourceType: 'manual',
  detect: () => true, // the fallback: anything can be a note
  parse(input) {
    const raw = String(input ?? '');
    if (!raw.trim()) throw new IngestionError('There is nothing to save.', 'manual-note');
    return { adapterId: 'manual-note', sourceType: 'manual', raw, segments: [] };
  },
};

/**
 * A pasted transcript.
 *
 * Runs the deterministic extractor, which reads only structure the author put
 * in the text. A transcript with no labels yields no segments, and that is the
 * correct outcome rather than a failure — the raw is preserved and the item
 * waits for review.
 */
export const transcriptPasteAdapter: IngestionAdapter<string> = {
  id: 'transcript-paste',
  label: 'Transcript',
  sourceType: 'imported_transcript',
  detect(input) {
    if (typeof input !== 'string') return false;
    const speakerTurns = /^\s*(user|human|assistant|claude|system)\s*:/gim;
    return (input.match(speakerTurns) ?? []).length >= 2;
  },
  parse(input) {
    const raw = String(input ?? '');
    if (!raw.trim()) throw new IngestionError('The transcript is empty.', 'transcript-paste');
    const { segments, notes } = extractSegments(raw);
    return {
      adapterId: 'transcript-paste',
      sourceType: 'imported_transcript',
      raw,
      segments,
      warnings: notes,
    };
  },
};

/** A bare URL. Layer 1 is the link itself; the page is not fetched. */
export const urlAdapter: IngestionAdapter<string> = {
  id: 'url-reference',
  label: 'Link',
  sourceType: 'url',
  detect(input) {
    return typeof input === 'string' && /^\s*https?:\/\/\S+\s*$/i.test(input);
  },
  parse(input) {
    const url = String(input ?? '').trim();
    if (!/^https?:\/\/\S+$/i.test(url)) {
      throw new IngestionError('That is not a URL starting with http:// or https://.', 'url-reference');
    }
    let host = '';
    try {
      host = new URL(url).hostname.replace(/^www\./, '');
    } catch {
      throw new IngestionError('That URL could not be read.', 'url-reference');
    }
    return {
      adapterId: 'url-reference',
      sourceType: 'url',
      title: host,
      externalUrl: url,
      raw: url,
      segments: [],
      // The page is deliberately not fetched. A stored title would be a claim
      // about content nobody in this system has read.
      warnings: [`Saved as a link to ${host}. The page itself is not downloaded.`],
    };
  },
};

function renderTranscript(session: ClaudeSessionImport): string {
  if (!session.messages || session.messages.length === 0) return '';
  return session.messages
    .map((m) => {
      const who = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'System';
      return `${who}: ${m.content}`;
    })
    .join('\n\n');
}

/**
 * The canonical JSON format.
 *
 * When the payload carries `segments`, those are used verbatim: the producer
 * stated them, so reading them is not a guess. When it does not, the
 * deterministic extractor runs over the rendered transcript instead. Either
 * way nothing is filed until the user confirms.
 */
export const claudeSessionJsonAdapter: IngestionAdapter<string> = {
  id: 'claude-session-json',
  label: 'Claude session JSON',
  sourceType: 'imported_transcript',
  detect(input) {
    if (typeof input !== 'string') return false;
    const t = input.trim();
    if (!t.startsWith('{')) return false;
    try {
      const parsed: unknown = JSON.parse(t);
      return (
        typeof parsed === 'object' &&
        parsed !== null &&
        'version' in parsed &&
        (parsed as { version?: unknown }).version === 1 &&
        'source' in parsed
      );
    } catch {
      return false;
    }
  },
  parse(input) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(input ?? ''));
    } catch (e) {
      throw new IngestionError(
        `That is not valid JSON: ${e instanceof Error ? e.message : 'could not be parsed'}.`,
        'claude-session-json',
      );
    }

    const result = validateClaudeSessionImport(parsed);
    if (!result.ok || !result.value) {
      throw new IngestionError(result.errors.join(' '), 'claude-session-json');
    }
    const session = result.value;

    const transcript = renderTranscript(session);
    const warnings = [...result.warnings];

    let segments: NormalizedSegment[];
    if (session.segments && session.segments.length > 0) {
      segments = session.segments.map((s) => ({
        knowledgeType: s.knowledgeType,
        title: s.title,
        content: s.content ?? null,
        sourceReference: s.sourceReference ?? null,
        confidence: 1,
        occurredAt: s.occurredAt,
      }));
    } else {
      const extracted = extractSegments(transcript);
      segments = extracted.segments;
      warnings.push(...extracted.notes);
    }

    return {
      adapterId: 'claude-session-json',
      sourceType: session.source as SourceType,
      title: session.title,
      occurredAt: session.occurredAt,
      externalUrl: session.externalUrl,
      raw: transcript || JSON.stringify(parsed, null, 2),
      segments,
      code: session.code,
      hints: session.hints,
      payload: parsed as Record<string, unknown>,
      warnings,
    };
  },
};

/**
 * Detection order, most specific first.
 *
 * `manual-note` is last because it accepts everything: it is the honest
 * fallback for a paste nothing else recognises, not a parser.
 */
export const ADAPTERS: readonly IngestionAdapter<string>[] = [
  claudeSessionJsonAdapter,
  urlAdapter,
  transcriptPasteAdapter,
  manualNoteAdapter,
];

export function adapterById(id: string): IngestionAdapter<string> | undefined {
  return ADAPTERS.find((a) => a.id === id);
}

/** Picks the first adapter that recognises the input. Never throws. */
export function detectAdapter(input: string): IngestionAdapter<string> {
  return ADAPTERS.find((a) => a.detect(input)) ?? manualNoteAdapter;
}

/**
 * Runs the funnel's first two stages: pick an adapter, produce the canonical
 * payload. Nothing is persisted here.
 */
export function normalize(input: string, adapterId?: string): NormalizedIngestion {
  const adapter = adapterId ? adapterById(adapterId) : detectAdapter(input);
  if (!adapter) throw new IngestionError(`No importer called “${adapterId}”.`, adapterId ?? 'unknown');
  return adapter.parse(input);
}
