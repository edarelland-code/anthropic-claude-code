import { describe, expect, it } from 'vitest';

import { bearerFromHeader, hashToken, mintToken, tokenLabel } from './token';

/**
 * The token module has one job and one prohibition: produce something that
 * cannot be guessed, and never let the secret back out.
 *
 * The prohibition is the part worth testing. A prefix long enough to recognise
 * a token in a list is fine; a prefix long enough to shorten a search is not.
 */

describe('mintToken', () => {
  it('produces a recognisable, high-entropy token', async () => {
    const { token } = await mintToken();
    expect(token.startsWith('cs_live_')).toBe(true);
    // 32 bytes base64url is 43 characters.
    expect(token.length).toBe('cs_live_'.length + 43);
  });

  it('never repeats', async () => {
    const minted = await Promise.all(Array.from({ length: 200 }, () => mintToken()));
    expect(new Set(minted.map((m) => m.token)).size).toBe(200);
    expect(new Set(minted.map((m) => m.hash)).size).toBe(200);
  });

  it('stores a hash, and the hash is not the token', async () => {
    const { token, hash } = await mintToken();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(token).not.toContain(hash);
  });

  it('keeps the prefix short enough to be useless', async () => {
    const { token, prefix } = await mintToken();
    expect(token.startsWith(prefix)).toBe(true);
    // Eight characters of the secret. What remains unrevealed is 35
    // base64url characters — about 208 bits.
    expect(prefix.length).toBe('cs_live_'.length + 8);
    expect(token.slice(prefix.length).length).toBeGreaterThan(30);
  });

  it('hashes the same token to the same value, and a different one differently', async () => {
    const a = await hashToken('cs_live_abcdefg');
    expect(await hashToken('cs_live_abcdefg')).toBe(a);
    expect(await hashToken('cs_live_abcdefh')).not.toBe(a);
  });

  it('ignores surrounding whitespace, which a copy-paste always brings', async () => {
    expect(await hashToken('  cs_live_abc\n')).toBe(await hashToken('cs_live_abc'));
  });
});

describe('bearerFromHeader', () => {
  it('reads a bearer token', () => {
    expect(bearerFromHeader('Bearer cs_live_abcdefghijklmnop')).toBe('cs_live_abcdefghijklmnop');
    expect(bearerFromHeader('bearer cs_live_abcdefghijklmnop')).toBe('cs_live_abcdefghijklmnop');
  });

  it.each([
    ['no header', null],
    ['empty', ''],
    ['a bare token', 'cs_live_abcdefghijklmnop'],
    ['basic auth', 'Basic dXNlcjpwYXNz'],
    ['a bearer with nothing after it', 'Bearer '],
    ['something implausibly short', 'Bearer abc'],
  ])('returns null for %s', (_label, header) => {
    expect(bearerFromHeader(header)).toBeNull();
  });
});

describe('tokenLabel', () => {
  it('reveals only what Settings already shows', async () => {
    const { token, prefix } = await mintToken();
    const label = tokenLabel(token);
    expect(label).toBe(`${prefix}…`);
    expect(label.length).toBeLessThan(token.length);
    expect(token.startsWith(label.replace('…', ''))).toBe(true);
  });
});
