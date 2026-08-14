/**
 * Path A — deterministic structural extraction.
 *
 * This is the mandatory half of Phase 3's extraction (ARCHITECTURE §9 stage 4:
 * Phase 3 is deterministic, Phase 6 is model-assisted, and both keep the same
 * confirm gate). It reads STRUCTURE the author already put in the text and
 * nothing else — speaker turns, headings, fenced code, and labels like
 * "Decision:". It never infers meaning from prose.
 *
 * The line it will not cross: a segment only gets a `knowledgeType` when the
 * text names one. Everything else comes back with `knowledgeType: null` and is
 * offered to Path B for a *suggestion* the user has to confirm. That is what
 * makes "Confirmed" and "Suggested" different states in the UI rather than two
 * shades of the same guess.
 *
 * Pure and dependency-free, so the guarantees below are unit-testable without a
 * database, a network, or a model.
 */

import type { KnowledgeType } from '@/lib/domain/types';

import type { NormalizedSegment } from './types';

/**
 * Labels the extractor treats as authoritative.
 *
 * Every one of these is a word the author typed deliberately in front of a
 * colon. That is a statement of intent, not a pattern match on vocabulary, so
 * acting on it is reading rather than guessing.
 */
const TYPE_LABELS: ReadonlyArray<[RegExp, KnowledgeType]> = [
  [/^decisions?\b/i, 'decision'],
  [/^decided\b/i, 'decision'],
  [/^(approved|approved direction)\b/i, 'decision'],
  [/^rejected(\s+idea)?\b/i, 'rejected_idea'],
  [/^ideas?\b/i, 'idea'],
  [/^suggestions?\b/i, 'suggestion'],
  [/^prompts?\b/i, 'prompt'],
  [/^winning prompt\b/i, 'winning_prompt'],
  [/^failed prompt\b/i, 'failed_prompt'],
  [/^requirements?\b/i, 'requirement'],
  [/^(todo|next steps?|action items?)\b/i, 'next_step'],
  [/^blockers?\b/i, 'blocker'],
  [/^(questions?|open questions?)\b/i, 'question'],
  [/^bugs?\b/i, 'bug'],
  [/^(fix|fixed|fixes)\b/i, 'fix'],
  [/^(implemented|implementation)\b/i, 'implementation'],
  [/^added\b/i, 'added'],
  [/^removed\b/i, 'removed'],
  [/^refactored\b/i, 'refactored'],
  [/^(changed?|changes)\b/i, 'change'],
  [/^research\b/i, 'research'],
  [/^milestones?\b/i, 'milestone'],
  [/^(progress|status)\b/i, 'progress'],
  [/^(context|important context|constraints?)\b/i, 'important_context'],
  [/^(files?|references?)\b/i, 'file'],
  [/^links?\b/i, 'link'],
];

/** `User:`, `Human:`, `Assistant:`, `Claude:`, `System:` at the start of a line. */
const SPEAKER = /^(user|human|me|you|assistant|claude|system)\s*:/i;
/** `## Heading` */
const HEADING = /^(#{1,6})\s+(.+?)\s*#*$/;
/** `Decision: …` — a label, a colon, then content. Bold and list markers allowed. */
const LABEL = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?([A-Za-z][A-Za-z /]{1,28}?)(?:\*\*|__)?\s*:\s*(.*)$/;
const FENCE = /^\s*(?:```|~~~)/;

interface Block {
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  /** The label that opened this block, if any. */
  label: string | null;
  heading: string | null;
  speaker: string | null;
  lines: string[];
}

/**
 * Whether a blank line ends this block.
 *
 * A label and a speaker turn are *inline* structures: "Decision: use the slash"
 * is one statement, and the paragraph after the blank line below it is a
 * separate thought. Letting the label keep consuming would file prose nobody
 * called a decision as part of one — over-capture, and the kind that is hard to
 * notice because the entry looks plausible.
 *
 * A heading is a *section* structure, so it keeps its paragraphs and ends only
 * at the next heading or label, which is what markdown means by it.
 */
const endsAtBlankLine = (b: Block) => b.label !== null || b.speaker !== null;

function matchLabel(line: string): { label: string; rest: string; type: KnowledgeType } | null {
  const m = LABEL.exec(line);
  if (!m) return null;
  const label = m[1]!.trim();
  for (const [pattern, type] of TYPE_LABELS) {
    if (pattern.test(label)) return { label, rest: m[2] ?? '', type };
  }
  return null;
}

/**
 * Splits raw text into structural blocks.
 *
 * Fenced code is opaque: a `Decision:` inside a code block is sample text, not
 * a statement about this project, so nothing inside a fence starts a block.
 */
function blocks(raw: string): Block[] {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let current: Block | null = null;
  let inFence = false;

  const open = (i: number, init: Partial<Block>) => {
    current = {
      startLine: i + 1,
      endLine: i + 1,
      label: null,
      heading: null,
      speaker: null,
      lines: [],
      ...init,
    };
    out.push(current);
  };

  lines.forEach((line, i) => {
    if (FENCE.test(line)) {
      inFence = !inFence;
      if (!current) open(i, {});
      current!.lines.push(line);
      current!.endLine = i + 1;
      return;
    }

    if (!inFence) {
      const speaker = SPEAKER.exec(line);
      if (speaker) {
        const rest = line.slice(speaker[0].length).trim();
        // "Assistant: Decision: ship the icon" is a labelled statement that
        // happens to sit inside a turn. Reading only the speaker here would
        // throw away the one part of the line that says what to record.
        const inner = matchLabel(rest);
        open(i, { speaker: speaker[1]!.toLowerCase(), label: inner?.label ?? null });
        const body = inner ? inner.rest.trim() : rest;
        if (body) current!.lines.push(body);
        return;
      }

      const heading = HEADING.exec(line);
      if (heading) {
        open(i, { heading: heading[2]!.trim() });
        return;
      }

      const labelled = matchLabel(line);
      if (labelled) {
        open(i, { label: labelled.label });
        if (labelled.rest.trim()) current!.lines.push(labelled.rest.trim());
        return;
      }
    }

    if (!inFence && !line.trim() && current && endsAtBlankLine(current)) {
      current = null;
      return;
    }

    if (!current) {
      if (!line.trim()) return; // leading blank lines start nothing
      open(i, {});
    }
    current!.lines.push(line);
    current!.endLine = i + 1;
  });

  return out.filter((b) => b.lines.join('').trim() !== '' || b.heading !== null);
}

function titleFrom(text: string, fallback: string): string {
  const firstLine = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !FENCE.test(l));
  if (!firstLine) return fallback;
  // A title is a handle, not a summary. Cut on the first sentence end.
  const sentence = /^(.{10,110}?[.!?])(\s|$)/.exec(firstLine);
  const candidate = (sentence ? sentence[1]! : firstLine).replace(/\s+/g, ' ').trim();
  return candidate.length > 120 ? `${candidate.slice(0, 117)}…` : candidate || fallback;
}

export interface ExtractionResult {
  segments: NormalizedSegment[];
  /** Blocks with no stated type. They become suggestions, never entries. */
  untypedCount: number;
  /** Why the extractor produced what it did, shown to the user verbatim. */
  notes: string[];
}

/**
 * Carves raw text into candidate entries using only its explicit structure.
 *
 * Returns an empty segment list rather than one entry for the whole document
 * when there is no structure to read. That is deliberate: rule 4 says a session
 * must never be filed as one generic card, and an unsplittable paste is an
 * honest `needs_review` item, not twenty invented facts.
 */
export function extractSegments(raw: string): ExtractionResult {
  const notes: string[] = [];
  const text = raw ?? '';
  if (!text.trim()) return { segments: [], untypedCount: 0, notes: ['Nothing to extract.'] };

  const found = blocks(text);
  const segments: NormalizedSegment[] = [];
  let untyped = 0;

  for (const b of found) {
    const body = b.lines.join('\n').trim();
    const labelled = b.label ? matchLabel(`${b.label}:`) : null;
    const headingLabel = b.heading ? matchLabel(`${b.heading}:`) : null;
    const type = labelled?.type ?? headingLabel?.type ?? null;

    if (!body && !b.heading) continue;

    if (type === null) {
      untyped += 1;
      continue;
    }

    segments.push({
      knowledgeType: type,
      title: b.heading && !headingLabel ? b.heading : titleFrom(body, b.heading ?? b.label ?? 'Untitled'),
      content: body || null,
      sourceReference: b.startLine === b.endLine ? `L${b.startLine}` : `L${b.startLine}-L${b.endLine}`,
      confidence: 1,
    });
  }

  if (segments.length === 0) {
    notes.push(
      found.some((b) => b.speaker)
        ? 'This looks like a conversation, but no line states what to record. Label the lines that matter (for example "Decision: …") or file the segments yourself.'
        : 'No headings or labels to split on. Nothing was extracted rather than guessing at the content.',
    );
  } else {
    notes.push(
      `${segments.length} ${segments.length === 1 ? 'entry was' : 'entries were'} read from labels and headings in the text.`,
    );
  }
  if (untyped > 0) {
    notes.push(
      `${untyped} further ${untyped === 1 ? 'section' : 'sections'} had no stated type. They are offered as suggestions to confirm, not filed.`,
    );
  }

  return { segments, untypedCount: untyped, notes };
}

/**
 * The untyped blocks, offered for a person to type by hand or accept a
 * suggestion for. Kept separate from `extractSegments` so nothing can
 * accidentally treat a suggestion as an extraction.
 */
export function extractCandidates(raw: string): NormalizedSegment[] {
  const text = raw ?? '';
  if (!text.trim()) return [];
  return blocks(text)
    .filter((b) => {
      const labelled = b.label ? matchLabel(`${b.label}:`) : null;
      const headingLabel = b.heading ? matchLabel(`${b.heading}:`) : null;
      return !labelled && !headingLabel && b.lines.join('').trim() !== '';
    })
    .map((b) => {
      const body = b.lines.join('\n').trim();
      return {
        knowledgeType: null,
        title: b.heading ?? titleFrom(body, 'Untitled section'),
        content: body || null,
        sourceReference:
          b.startLine === b.endLine ? `L${b.startLine}` : `L${b.startLine}-L${b.endLine}`,
        confidence: 0,
      } satisfies NormalizedSegment;
    });
}
