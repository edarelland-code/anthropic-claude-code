import { describe, expect, it } from 'vitest';

import { extractCandidates, extractSegments } from './extract';

/**
 * Path A's contract is narrow on purpose, and these tests exist to hold it
 * there. The failure mode worth guarding is not "missed a segment" — it is
 * "invented one". A wrong extraction files a fact nobody stated into permanent
 * memory, which is the exact thing this product exists to prevent.
 */
describe('extractSegments — deterministic structural extraction', () => {
  it('reads a labelled line as the type the author named', () => {
    const { segments } = extractSegments(
      ['Decision: Use the slash geometry', 'Blue read as a status dot at 16px.'].join('\n'),
    );

    expect(segments).toHaveLength(1);
    expect(segments[0]!.knowledgeType).toBe('decision');
    expect(segments[0]!.title).toBe('Use the slash geometry');
    expect(segments[0]!.content).toContain('status dot');
    // Stated, not inferred — so full confidence is honest here.
    expect(segments[0]!.confidence).toBe(1);
  });

  it('anchors every segment back into the raw text', () => {
    const raw = ['intro line', '', 'Blocker: waiting on brand sign-off', 'since Tuesday'].join('\n');
    const { segments } = extractSegments(raw);
    // "L3-L4": the label opened on line 3 and the block ran to line 4.
    expect(segments[0]!.sourceReference).toBe('L3-L4');
  });

  it('extracts nothing from unstructured prose rather than guessing', () => {
    const { segments, notes } = extractSegments(
      'We talked for a while about the icon and eventually agreed the blue one was wrong.',
    );
    expect(segments).toHaveLength(0);
    expect(notes.join(' ')).toContain('Nothing was extracted rather than guessing');
  });

  it('never files a whole session as one generic entry', () => {
    // rule 4. A transcript with no labels must produce zero entries, not one
    // card called "Claude Chat, Aug 3".
    const transcript = [
      'User: should the icon be blue?',
      'Assistant: blue reads as a status dot at 16px.',
      'User: fine, use the slash.',
    ].join('\n');
    const { segments } = extractSegments(transcript);
    expect(segments).toHaveLength(0);
  });

  it('fans one transcript out into many entries when the labels are there', () => {
    const transcript = [
      'User: should the icon be blue?',
      'Assistant: blue reads as a status dot.',
      'Decision: use the slash geometry',
      'Rejected: the checkmark overlay',
      'Next step: render it at 16px and check',
    ].join('\n');

    const { segments } = extractSegments(transcript);
    expect(segments.map((s) => s.knowledgeType)).toEqual(['decision', 'rejected_idea', 'next_step']);
  });

  it('ignores a label inside a fenced code block', () => {
    // Sample text in a code fence is not a statement about this project.
    const raw = [
      'Decision: adopt the parser',
      '```',
      'Decision: this is example output, not a real decision',
      '```',
    ].join('\n');

    const { segments } = extractSegments(raw);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.title).toBe('adopt the parser');
    expect(segments[0]!.content).toContain('example output');
  });

  it('reads markdown headings that name a type, and keeps ones that do not as prose', () => {
    const raw = ['## Decisions', 'We are going with the slash.', '', '## Notes', 'Nothing yet.'].join('\n');
    const { segments, untypedCount } = extractSegments(raw);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.knowledgeType).toBe('decision');
    expect(untypedCount).toBe(1);
  });

  it('handles bold and list-marker labels, which is how people actually write', () => {
    const raw = ['- **Blocker:** waiting on the brand review', '* Bug: the icon renders at 15px'].join('\n');
    const { segments } = extractSegments(raw);
    expect(segments.map((s) => s.knowledgeType)).toEqual(['blocker', 'bug']);
  });

  it('reports untyped sections separately instead of typing them', () => {
    const raw = ['Some opening prose.', '', 'Decision: ship it', '', 'Some closing prose.'].join('\n');
    const { segments, untypedCount, notes } = extractSegments(raw);
    expect(segments).toHaveLength(1);
    expect(untypedCount).toBe(2);
    expect(notes.join(' ')).toContain('offered as suggestions to confirm, not filed');
  });

  it('is deterministic', () => {
    const raw = 'Decision: A\nIdea: B\nBug: C';
    expect(extractSegments(raw)).toEqual(extractSegments(raw));
  });

  it('returns nothing for empty input', () => {
    expect(extractSegments('').segments).toHaveLength(0);
    expect(extractSegments('   \n  ').segments).toHaveLength(0);
  });
});

describe('extractCandidates — the untyped remainder', () => {
  it('offers unlabelled sections with no type attached', () => {
    const candidates = extractCandidates('Some prose about the icon.\n\nDecision: ship it');
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.knowledgeType).toBeNull();
    // Zero, not a low number: nothing has been suggested yet at this stage.
    expect(candidates[0]!.confidence).toBe(0);
  });

  it('does not re-offer sections that were already extracted', () => {
    const raw = 'Decision: ship it\nIdea: try amber';
    expect(extractCandidates(raw)).toHaveLength(0);
  });
});
