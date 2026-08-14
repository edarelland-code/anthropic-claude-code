import { describe, expect, it } from 'vitest';

import {
  claudeSessionJsonAdapter,
  detectAdapter,
  manualNoteAdapter,
  normalize,
  transcriptPasteAdapter,
  urlAdapter,
} from './adapters';
import { CLAUDE_SESSION_EXAMPLE, validateClaudeSessionImport } from './schema';
import { IngestionError } from './types';

describe('adapter detection', () => {
  it('recognises the canonical JSON format', () => {
    expect(detectAdapter(CLAUDE_SESSION_EXAMPLE).id).toBe('claude-session-json');
  });

  it('recognises a bare URL', () => {
    expect(detectAdapter('https://claude.ai/chat/abc').id).toBe('url-reference');
  });

  it('recognises a conversation by its speaker turns', () => {
    expect(detectAdapter('User: hi\nAssistant: hello\nUser: bye').id).toBe('transcript-paste');
  });

  it('falls back to a note, never to a failure', () => {
    // The Inbox accepts anything. An unrecognised paste is a note, which is a
    // true statement about it rather than an error.
    expect(detectAdapter('just some thoughts').id).toBe('manual-note');
    expect(detectAdapter('').id).toBe('manual-note');
  });

  it('detect is side-effect free and never throws on rubbish', () => {
    for (const adapter of [claudeSessionJsonAdapter, urlAdapter, transcriptPasteAdapter]) {
      expect(() => adapter.detect('{not json')).not.toThrow();
      expect(() => adapter.detect(null)).not.toThrow();
      expect(adapter.detect(42)).toBe(false);
    }
  });
});

describe('manualNoteAdapter', () => {
  it('preserves the text exactly and extracts nothing', () => {
    // Quick Capture must stay one step. Extraction happens in triage, once the
    // user has decided where the item belongs.
    const raw = '  Decision: this looks like a label but capture must not act on it  ';
    const result = manualNoteAdapter.parse(raw);
    expect(result.raw).toBe(raw);
    expect(result.segments).toHaveLength(0);
    expect(result.sourceType).toBe('manual');
  });

  it('refuses empty content', () => {
    expect(() => manualNoteAdapter.parse('   ')).toThrow(IngestionError);
  });
});

describe('urlAdapter', () => {
  it('records the link without pretending to have read the page', () => {
    const result = urlAdapter.parse('https://example.com/some/page');
    expect(result.externalUrl).toBe('https://example.com/some/page');
    expect(result.title).toBe('example.com');
    expect(result.warnings?.join(' ')).toContain('not downloaded');
  });

  it('rejects a non-URL', () => {
    expect(() => urlAdapter.parse('not a url')).toThrow(IngestionError);
  });
});

describe('transcriptPasteAdapter', () => {
  it('fans a labelled transcript out into several entries', () => {
    const result = transcriptPasteAdapter.parse(
      [
        'User: should the icon be blue?',
        'Assistant: it reads as a status dot.',
        '',
        'Decision: use the slash geometry',
        '',
        'Next step: render at 16px',
      ].join('\n'),
    );
    expect(result.segments.map((s) => s.knowledgeType)).toEqual(['decision', 'next_step']);
    // Layer 1 is the whole paste, not a reconstruction from the segments.
    expect(result.raw).toContain('status dot');
  });
});

describe('claudeSessionJsonAdapter', () => {
  it('parses the documented example', () => {
    const result = claudeSessionJsonAdapter.parse(CLAUDE_SESSION_EXAMPLE);
    expect(result.sourceType).toBe('claude_chat');
    expect(result.title).toBe('Icon exploration');
    expect(result.externalUrl).toContain('claude.ai');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]!.knowledgeType).toBe('decision');
    expect(result.segments[0]!.sourceReference).toBe('msg:2');
    // The transcript is rendered from the messages, so provenance survives.
    expect(result.raw).toContain('Should the icon be blue?');
  });

  it('treats a hint as a suggestion, not an assignment', () => {
    const result = claudeSessionJsonAdapter.parse(CLAUDE_SESSION_EXAMPLE);
    expect(result.hints?.topic).toBe('DailyRelay');
    expect(result.warnings?.join(' ')).toContain('never applied automatically');
  });

  it('extracts from the transcript when no segments are supplied', () => {
    const payload = JSON.stringify({
      version: 1,
      source: 'claude_chat',
      messages: [
        { role: 'user', content: 'what next?' },
        { role: 'assistant', content: 'Decision: ship the icon' },
      ],
    });
    const result = claudeSessionJsonAdapter.parse(payload);
    expect(result.segments.map((s) => s.knowledgeType)).toEqual(['decision']);
  });

  it('reports every problem at once, naming the field', () => {
    const result = validateClaudeSessionImport({
      version: 2,
      source: 'slack',
      messages: [{ role: 'nobody', content: 5 }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
    expect(result.errors.join(' ')).toContain('messages[0].role');
  });

  it('refuses a payload with nothing to import', () => {
    const result = validateClaudeSessionImport({ version: 1, source: 'claude_chat' });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('at least one message or one segment');
  });

  it('rejects an unknown knowledge type instead of coercing it', () => {
    const result = validateClaudeSessionImport({
      version: 1,
      source: 'claude_code',
      segments: [{ knowledgeType: 'vibes', title: 'x' }],
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('knowledgeType');
  });

  it('explains bad JSON rather than failing silently', () => {
    expect(() => claudeSessionJsonAdapter.parse('{oops')).toThrow(/not valid JSON/);
  });
});

describe('normalize', () => {
  it('routes through the detected adapter', () => {
    expect(normalize('https://example.com').adapterId).toBe('url-reference');
  });

  it('honours an explicitly chosen adapter over detection', () => {
    // The Inbox lets a user override the guess. Detection is a default, not a
    // decision.
    const result = normalize('User: a\nAssistant: b', 'manual-note');
    expect(result.adapterId).toBe('manual-note');
    expect(result.segments).toHaveLength(0);
  });
});
