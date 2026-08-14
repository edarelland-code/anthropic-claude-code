import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { contentFingerprint, normalizeForFingerprint, similarity } from './fingerprint';

/**
 * These assertions mirror `content_fingerprint()` in migration 0004 §2.
 *
 * The two implementations exist because the database cannot hash text that has
 * not been inserted yet, and triage proposes duplicates before writing. If they
 * disagree, a duplicate goes unproposed — never a wrong write, since nothing
 * acts on a fingerprint — but the feature quietly stops working, which is
 * exactly the kind of failure a test has to catch.
 */
describe('contentFingerprint — must match the SQL', () => {
  it('ignores whitespace and case, which is how a re-paste differs', () => {
    expect(contentFingerprint('Shipped the icon')).toBe(contentFingerprint('  SHIPPED   the Icon '));
    expect(contentFingerprint('a\tb\nc')).toBe(contentFingerprint('a b c'));
    expect(contentFingerprint('line\r\nbreak')).toBe(contentFingerprint('line break'));
  });

  it('collapses before trimming, matching the SQL expression exactly', () => {
    // The order matters: btrim() with no argument removes spaces only, so
    // trimming first would leave a leading tab behind as a leading space.
    expect(contentFingerprint('\t hello \t')).toBe(contentFingerprint('hello'));
  });

  it('distinguishes genuinely different content', () => {
    expect(contentFingerprint('Use the slash geometry')).not.toBe(
      contentFingerprint('Use the blue circle'),
    );
  });

  it('is null for nothing, exactly as the SQL is', () => {
    expect(contentFingerprint(null)).toBeNull();
    expect(contentFingerprint(undefined)).toBeNull();
    expect(contentFingerprint('')).toBeNull();
    expect(contentFingerprint('   \n\t ')).toBeNull();
  });

  it('is sha256 hex of the normalised string, so the SQL can be checked by hand', () => {
    const expected = createHash('sha256').update('shipped the icon', 'utf8').digest('hex');
    expect(contentFingerprint('  Shipped   the ICON  ')).toBe(expected);
    expect(expected).toHaveLength(64);
  });

  it('normalises the way the SQL does', () => {
    expect(normalizeForFingerprint('  A  B\tC\n')).toBe('a b c');
  });
});

describe('similarity', () => {
  it('is 1 for identical text and 0 for nothing', () => {
    expect(similarity('the same words', 'THE SAME  WORDS')).toBe(1);
    expect(similarity('', 'anything')).toBe(0);
  });

  it('scores a near-duplicate high and unrelated text low', () => {
    const near = similarity('Use the slash geometry', 'Use the slash geometry icon');
    const far = similarity('Use the slash geometry', 'Invoice export is broken');
    expect(near).toBeGreaterThan(0.8);
    expect(far).toBeLessThan(0.3);
    expect(near).toBeGreaterThan(far);
  });

  it('is symmetric and bounded, so a displayed percentage is meaningful', () => {
    const a = 'Blue icon reads as a status dot';
    const b = 'Blue icon read as a status dot at 16px';
    expect(similarity(a, b)).toBeCloseTo(similarity(b, a), 10);
    expect(similarity(a, b)).toBeGreaterThanOrEqual(0);
    expect(similarity(a, b)).toBeLessThanOrEqual(1);
  });
});
