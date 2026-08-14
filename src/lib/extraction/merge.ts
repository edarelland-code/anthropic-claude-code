/**
 * Combining chunks, and attaching what the deterministic side knows
 * (Phase 6J/6K/6T/6U).
 *
 * Two jobs the provider does not get to do:
 *
 *   1. **Collapse suggestions that describe the same thing across chunks.** A
 *      decision discussed either side of a split will be proposed twice. Two
 *      review cards for one decision is not a small annoyance — confirm both
 *      and the shelf now holds a duplicate that a future Resume will export
 *      twice.
 *
 *   2. **Decide what is a duplicate of, or a conflict with, something already
 *      stored.** That stays with the Phase 3 fingerprint and the existing
 *      `ProposalRepository` (rule 17). A model's opinion about whether it has
 *      seen a decision before is a guess about the database, which is the one
 *      thing it cannot see.
 */

import type { ConflictProposal, DuplicateProposal } from '@/lib/domain/types';

import type { SuggestedRecord } from './types';

/**
 * A normal form for comparison only.
 *
 * Mirrors `content_fingerprint()` in SQL — collapse whitespace, trim,
 * lowercase — so "the same thing" means the same thing on both sides of the
 * boundary. Nothing derived here is ever stored as the record's title.
 */
export function comparisonKey(record: SuggestedRecord): string {
  const norm = (s: string | null | undefined) =>
    (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  return `${record.kind}:${record.knowledgeType ?? ''}:${norm(record.title)}`;
}

export interface MergeOutcome {
  records: SuggestedRecord[];
  /** How many were folded into an earlier one, for the run's warnings. */
  collapsed: number;
}

/**
 * Folds duplicates across chunks into the first occurrence.
 *
 * The survivor keeps the EARLIEST source reference and the HIGHEST confidence,
 * and gains the other's evidence. Keeping the earliest anchor matters: it is
 * where the thing was first said, which is what someone checking the source
 * wants to read.
 */
export function mergeAcrossChunks(records: SuggestedRecord[]): MergeOutcome {
  const byKey = new Map<string, SuggestedRecord>();
  let collapsed = 0;

  for (const record of records) {
    const key = comparisonKey(record);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...record, basis: [...record.basis] });
      continue;
    }

    collapsed += 1;
    existing.confidence = Math.max(existing.confidence, record.confidence);
    // Longer content usually means the fuller statement of the same point.
    if ((record.content?.length ?? 0) > (existing.content?.length ?? 0)) {
      existing.content = record.content;
    }
    for (const b of record.basis) if (!existing.basis.includes(b)) existing.basis.push(b);
    if (record.sourceReference && !existing.sourceReference) {
      existing.sourceReference = record.sourceReference;
    }
  }

  return { records: [...byKey.values()], collapsed };
}

/** A suggestion with whatever the deterministic side found out about it. */
export interface AnnotatedSuggestion extends SuggestedRecord {
  duplicateOf: { kind: string; id: string; title: string; reason: string } | null;
  conflictsWith: { id: string; title: string; reason: string } | null;
  /**
   * Whether review may pre-select this (6H).
   *
   * False for anything authority-changing, anything that looks like a
   * duplicate, and anything in conflict — those are exactly the cases where a
   * pre-ticked box would turn a glance into an approval.
   */
  safeToPreselect: boolean;
}

/** Kinds that change what the project believes, and are never pre-selected. */
const AUTHORITY_KINDS = new Set(['decision', 'current_state']);

/**
 * Attaches duplicate and conflict findings, and decides what may be
 * pre-selected.
 *
 * `duplicates` and `conflicts` come from the existing repository, which reads
 * the database. Nothing in this function asks the provider what it thinks.
 */
export function annotate(input: {
  records: SuggestedRecord[];
  duplicates: Map<string, DuplicateProposal>;
  conflicts: Map<string, ConflictProposal>;
  /** High-confidence, non-authority suggestions may start ticked. */
  preselectThreshold?: number;
}): AnnotatedSuggestion[] {
  const threshold = input.preselectThreshold ?? 0.9;

  return input.records.map((record) => {
    const key = comparisonKey(record);
    const duplicate = input.duplicates.get(key) ?? null;
    const conflict = input.conflicts.get(key) ?? null;

    return {
      ...record,
      duplicateOf: duplicate
        ? {
            kind: duplicate.entityType,
            id: duplicate.candidateId,
            title: duplicate.candidateTitle,
            reason: duplicate.reason,
          }
        : null,
      conflictsWith: conflict
        ? {
            id: conflict.conflictsWithId,
            title: conflict.conflictsWithTitle,
            reason: conflict.reason,
          }
        : null,
      // Three independent reasons to leave it unticked. Confidence alone never
      // ticks anything authority-changing, however high it is (6H).
      safeToPreselect:
        !AUTHORITY_KINDS.has(record.kind) &&
        duplicate === null &&
        conflict === null &&
        record.confidence >= threshold,
    };
  });
}
