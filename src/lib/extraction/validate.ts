/**
 * Provider output validation (Phase 6Z).
 *
 * Never trust model JSON. A provider is an untrusted input boundary in exactly
 * the way an HTTP request body is, and it is a *more* dangerous one, because
 * its output looks plausible when it is wrong.
 *
 * The policy when some records validate and others do not: keep the good ones
 * and REPORT the bad ones by index and reason. Silently dropping a malformed
 * suggestion would mean the user reviewed nine of ten proposals believing they
 * had seen everything; rejecting the whole batch would throw away nine good
 * ones because of a typo in the tenth.
 */

import {
  ACTION_KINDS,
  ACTION_STATUSES,
  KNOWLEDGE_TYPES,
  RELATIONSHIP_TYPES,
  type KnowledgeType,
} from '@/lib/domain/types';

import { SUGGESTION_KINDS, type ExtractionResult, type SuggestedRecord } from './types';

const KINDS = new Set<string>(SUGGESTION_KINDS);
const KNOWLEDGE = new Set<string>(KNOWLEDGE_TYPES);
const ACTION_KIND = new Set<string>(ACTION_KINDS);
const ACTION_STATUS = new Set<string>(ACTION_STATUSES);
const RELATIONSHIP = new Set<string>(RELATIONSHIP_TYPES);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `L12`, `L12-L20`, `msg:3`, `commit:9f2c1ab`. Anything else is not an anchor. */
const SOURCE_REFERENCE = /^(L\d+(-L\d+)?|msg:\d+|commit:[0-9a-f]{7,40}|chunk:\d+(:L\d+(-L\d+)?)?)$/i;

/** Practical ceilings. A provider that returns 900 records has malfunctioned. */
const LIMITS = { records: 200, title: 400, content: 20_000, basis: 12, warnings: 40 };

export interface ValidationOutcome {
  result: ExtractionResult;
  /** One line per rejected record, naming its index and what was wrong. */
  rejected: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function strings(v: unknown, cap: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, cap);
}

/**
 * Validates one record, returning it or the reason it was refused.
 *
 * `knownTopicIds` / `knownSubtopicIds` are passed in rather than looked up:
 * a suggested topic id that names nothing is a hallucination, and accepting it
 * would produce a foreign-key error at confirmation time — long after the user
 * had reviewed and trusted it.
 */
function validateRecord(
  raw: unknown,
  index: number,
  known: { topicIds: Set<string>; subtopicIds: Set<string>; requireProvenance: boolean },
): { ok: true; record: SuggestedRecord } | { ok: false; reason: string } {
  const at = `records[${index}]`;
  if (!isObject(raw)) return { ok: false, reason: `${at} is not an object.` };

  const kind = str(raw.kind ?? raw.type);
  if (!kind || !KINDS.has(kind)) {
    return { ok: false, reason: `${at}.kind "${kind ?? '(missing)'}" is not a record type ContextShelf has.` };
  }

  const title = str(raw.title)?.trim();
  if (!title) return { ok: false, reason: `${at}.title is required.` };
  if (title.length > LIMITS.title) {
    return { ok: false, reason: `${at}.title is longer than ${LIMITS.title} characters.` };
  }

  const content = str(raw.content);
  if (content !== null && content.length > LIMITS.content) {
    return { ok: false, reason: `${at}.content is longer than ${LIMITS.content} characters.` };
  }

  let knowledgeType: KnowledgeType | undefined;
  if (kind === 'knowledge_entry') {
    const t = str(raw.knowledgeType);
    if (!t || !KNOWLEDGE.has(t)) {
      return { ok: false, reason: `${at}.knowledgeType "${t ?? '(missing)'}" is not a knowledge type.` };
    }
    knowledgeType = t as KnowledgeType;
  } else if (raw.knowledgeType !== undefined && raw.knowledgeType !== null) {
    return { ok: false, reason: `${at}.knowledgeType belongs only on a knowledge_entry.` };
  }

  // Confidence: a number in range. `0.99` from a model that has no calibrated
  // notion of probability is still only a hint, but a value outside [0,1] means
  // the output is not the shape it claims to be.
  const confidence = typeof raw.confidence === 'number' ? raw.confidence : NaN;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { ok: false, reason: `${at}.confidence must be a number between 0 and 1.` };
  }

  const sourceReference = str(raw.sourceReference)?.trim() || null;
  if (sourceReference && !SOURCE_REFERENCE.test(sourceReference)) {
    return {
      ok: false,
      reason: `${at}.sourceReference "${sourceReference}" is not an anchor this system can resolve (expected L12, L12-L20, msg:3 or chunk:1:L4).`,
    };
  }
  if (known.requireProvenance && !sourceReference) {
    // The source could have supplied one, so a record without it is a claim
    // nobody can check against the transcript it supposedly came from.
    return { ok: false, reason: `${at} has no sourceReference, and the source supports one.` };
  }

  for (const [field, set] of [
    ['suggestedTopicId', known.topicIds],
    ['suggestedSubtopicId', known.subtopicIds],
  ] as const) {
    const id = str(raw[field]);
    if (id === null || id === '') continue;
    if (!UUID.test(id)) return { ok: false, reason: `${at}.${field} is not a uuid.` };
    if (!set.has(id)) return { ok: false, reason: `${at}.${field} names something that does not exist.` };
  }

  const payload = isObject(raw.payload) ? raw.payload : {};
  const statusSuggestion = str(raw.statusSuggestion)?.trim() || null;

  if (kind === 'action') {
    if (statusSuggestion && !ACTION_STATUS.has(statusSuggestion)) {
      return { ok: false, reason: `${at}.statusSuggestion "${statusSuggestion}" is not an action status.` };
    }
    const actionKind = str(payload.actionKind);
    if (actionKind && !ACTION_KIND.has(actionKind)) {
      return { ok: false, reason: `${at}.payload.actionKind "${actionKind}" is not an action kind.` };
    }
  }

  if (kind === 'relationship') {
    const rel = str(payload.relationshipType);
    if (!rel || !RELATIONSHIP.has(rel)) {
      return { ok: false, reason: `${at}.payload.relationshipType is not a relationship type.` };
    }
    for (const end of ['fromId', 'toId'] as const) {
      const id = str(payload[end]);
      if (!id || !UUID.test(id)) {
        return { ok: false, reason: `${at}.payload.${end} must be the uuid of a record that already exists.` };
      }
    }
    // Supersession has its own function and its own mandatory reason. Reaching
    // it through the generic graph would be a way around that gate (6Q).
    if (rel === 'supersedes') {
      return {
        ok: false,
        reason: `${at} proposes a supersession. Superseding is a review action of its own and requires a reason; it is not a relationship a suggestion can create.`,
      };
    }
  }

  // A decision may only ever be suggested as `proposed`. A provider that says
  // `active` is asking for authority it does not have; the value is corrected
  // rather than the record refused, because the suggestion itself is fine.
  const correctedStatus =
    kind === 'decision' ? 'proposed' : kind === 'idea' ? 'suggested' : statusSuggestion;

  return {
    ok: true,
    record: {
      kind: kind as SuggestedRecord['kind'],
      knowledgeType,
      title,
      content,
      reason: str(raw.reason),
      statusSuggestion: correctedStatus,
      suggestedTopicId: str(raw.suggestedTopicId),
      suggestedSubtopicId: str(raw.suggestedSubtopicId),
      sourceReference,
      confidence,
      basis: strings(raw.basis, LIMITS.basis),
      payload,
    },
  };
}

export function validateExtractionResult(
  raw: unknown,
  known: { topicIds: Set<string>; subtopicIds: Set<string>; requireProvenance: boolean },
): ValidationOutcome {
  const rejected: string[] = [];

  if (!isObject(raw)) {
    return {
      result: { summary: null, topicSuggestions: [], subtopicSuggestions: [], records: [], warnings: [] },
      rejected: ['The provider did not return a JSON object.'],
    };
  }

  const rawRecords = Array.isArray(raw.records) ? raw.records : [];
  if (rawRecords.length > LIMITS.records) {
    rejected.push(
      `The provider returned ${rawRecords.length} records; only the first ${LIMITS.records} were read.`,
    );
  }

  const records: SuggestedRecord[] = [];
  rawRecords.slice(0, LIMITS.records).forEach((r, i) => {
    const outcome = validateRecord(r, i, known);
    if (outcome.ok) records.push(outcome.record);
    else rejected.push(outcome.reason);
  });

  return {
    result: {
      summary: str(raw.summary),
      topicSuggestions: strings(raw.topicSuggestions ?? raw.topic_suggestions, 8),
      subtopicSuggestions: strings(raw.subtopicSuggestions ?? raw.subtopic_suggestions, 8),
      records,
      warnings: strings(raw.warnings, LIMITS.warnings),
      usage: isObject(raw.usage)
        ? {
            inputTokens: typeof raw.usage.inputTokens === 'number' ? raw.usage.inputTokens : undefined,
            outputTokens: typeof raw.usage.outputTokens === 'number' ? raw.usage.outputTokens : undefined,
          }
        : undefined,
    },
    rejected,
  };
}
