import { describe, expect, it } from 'vitest';

import { normaliseNewlines } from './forms';

/**
 * Found by comparing what a browser stored against what was typed into it, not
 * by reading the code: nothing in the app rewrites newlines, so nothing in the
 * app looked wrong.
 */
describe('form submissions store the line breaks that were typed', () => {
  const form = (entries: Array<[string, string]>) => {
    const fd = new FormData();
    for (const [k, v] of entries) fd.append(k, v);
    return fd;
  };

  it('undoes the CRLF the browser adds on submission', () => {
    const fd = form([['content', 'line one\r\nline two\r\n\r\nline four']]);
    expect(normaliseNewlines(fd).get('content')).toBe('line one\nline two\n\nline four');
  });

  it('leaves a prompt body byte-for-byte when there is nothing to undo', () => {
    const body = 'You are reviewing a migration.\n\nList every statement.\n';
    const fd = form([['content', body]]);
    expect(normaliseNewlines(fd).get('content')).toBe(body);
  });

  it('leaves single-line fields exactly as they were', () => {
    const fd = form([['title', 'A title with no line breaks']]);
    expect(normaliseNewlines(fd).get('title')).toBe('A title with no line breaks');
  });

  it('keeps every value of a repeated field, in order', () => {
    // Rebuilt by append rather than `set`, which keeps only the last value —
    // a repeated field would lose everything before it.
    const fd = form([
      ['tag', 'first\r\nline'],
      ['tag', 'second'],
      ['tag', 'third\r\nline'],
    ]);
    expect(normaliseNewlines(fd).getAll('tag')).toEqual(['first\nline', 'second', 'third\nline']);
  });

  it('does not touch a lone carriage return that is part of the content', () => {
    // Only the CRLF pair is a transport artefact. A bare \r is something the
    // user's own content carried, and rewriting it would be an edit.
    const fd = form([['content', 'a\rb']]);
    expect(normaliseNewlines(fd).get('content')).toBe('a\rb');
  });

  it('returns the same FormData so it can be used inline', () => {
    const fd = form([['content', 'x\r\ny']]);
    expect(normaliseNewlines(fd)).toBe(fd);
  });
});
