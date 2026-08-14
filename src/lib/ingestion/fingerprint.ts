/**
 * The TypeScript half of `content_fingerprint()` (migration 0004 §2).
 *
 * The database generates this hash for every stored row. This copy exists for
 * the one case the database cannot cover: text that has not been inserted yet.
 * Triage proposes duplicates *before* writing, so the candidate's fingerprint
 * has to be computed here and compared against the stored ones.
 *
 * The two implementations must agree, which is why the normalisation is spelled
 * out identically in both and asserted by `fingerprint.test.ts`. If they ever
 * drift on some exotic input, the consequence is a missed proposal rather than
 * a wrong write — nothing in the system acts on a fingerprint, it only offers
 * the user a comparison (rule 17).
 */

import { createHash } from 'node:crypto';

/**
 * Trimmed, whitespace-collapsed, case-folded — in that order.
 *
 * Collapse before trim, matching the SQL. Two pastes of the same transcript
 * that differ only in indentation or line endings normalise to one string;
 * genuinely different text never does.
 */
export function normalizeForFingerprint(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Returns null for empty or whitespace-only input, exactly as the SQL does. */
export function contentFingerprint(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const normalized = normalizeForFingerprint(text);
  if (normalized === '') return null;
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/** The composite the `knowledge_entries.content_hash` column is generated from. */
export function entryFingerprint(title: string | null, content: string | null): string | null {
  return contentFingerprint(`${title ?? ''} ${content ?? ''}`);
}

/**
 * Dice coefficient over character bigrams — the same family of measure as the
 * `pg_trgm` similarity used for near-duplicate proposals in SQL, computed here
 * for text that is not in the database yet.
 *
 * Not identical to `pg_trgm` (that pads and uses trigrams), and it does not
 * need to be: both produce a 0–1 number a person reads next to two texts shown
 * side by side. Neither number is ever compared against a threshold that skips
 * a confirmation.
 */
export function similarity(a: string, b: string): number {
  const x = normalizeForFingerprint(a);
  const y = normalizeForFingerprint(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;

  const bigrams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i += 1) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };

  const ax = bigrams(x);
  const by = bigrams(y);
  let shared = 0;
  for (const [g, count] of ax) {
    const other = by.get(g);
    if (other) shared += Math.min(count, other);
  }
  return (2 * shared) / (x.length - 1 + (y.length - 1));
}
