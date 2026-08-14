/**
 * Path B — suggestions.
 *
 * CLARIFICATION 4, and it governs every line in this file: nothing here
 * understands anything. It counts keywords and compares strings. The output is
 * a proposal with its reasoning attached, so the UI can say "Suggested —
 * because the text contains 'we decided'" rather than implying a judgement was
 * made.
 *
 * Three properties this file must keep:
 *
 *   1. Nothing returned here is ever written without a confirmation. The types
 *      say `Suggestion`, not `KnowledgeType`, so a suggestion cannot be passed
 *      where a decided value is expected.
 *   2. `basis` is always populated. A suggestion the user cannot audit is
 *      indistinguishable from a guess dressed up as an answer.
 *   3. It is deterministic. The same text and the same topics always produce
 *      the same suggestion, so a user can learn what it does.
 *
 * Phase 6 may replace the mechanism with a model. It does not get to replace
 * the confirm gate.
 */

import type { KnowledgeType, Topic } from '@/lib/domain/types';

/**
 * A proposal, with the evidence that produced it.
 *
 * Deliberately NOT assignable to the value it proposes: a caller has to reach
 * through `.value`, which is the moment a human decision belongs.
 */
export interface Suggestion<T> {
  value: T;
  /** 0–1. Shown to the user for weighing; never compared against a threshold
   *  to decide whether to skip confirmation. */
  confidence: number;
  /** The literal evidence, e.g. ['matched "we decided"', 'matched "instead of"']. */
  basis: string[];
}

/**
 * Phrases that hint at a knowledge type.
 *
 * These are hints about *how a sentence is phrased*, which is a much weaker
 * signal than the explicit labels Path A reads, and they are weighted
 * accordingly — a suggestion never reaches confidence 1.
 */
const TYPE_HINTS: ReadonlyArray<{ type: KnowledgeType; phrases: readonly string[] }> = [
  { type: 'decision', phrases: ['we decided', 'decided to', "let's go with", 'going with', 'we will use', 'chose to', 'settled on'] },
  { type: 'rejected_idea', phrases: ['rejected', "won't work", 'not going to', 'ruled out', 'decided against', 'scrap that'] },
  { type: 'idea', phrases: ['what if', 'we could', 'idea:', 'maybe we', 'one option', 'consider'] },
  { type: 'blocker', phrases: ['blocked on', 'blocker', "can't proceed", 'waiting on', 'stuck on'] },
  { type: 'question', phrases: ['should we', 'do we need', 'open question', 'not sure whether', '?'] },
  { type: 'bug', phrases: ['bug', 'broken', 'fails with', 'error:', 'regression', 'crashes'] },
  { type: 'fix', phrases: ['fixed', 'resolved', 'patched', 'now works'] },
  { type: 'implementation', phrases: ['implemented', 'built', 'shipped', 'added support', 'wired up'] },
  { type: 'requirement', phrases: ['must', 'has to', 'requirement', 'non-negotiable', 'always'] },
  { type: 'next_step', phrases: ['next step', 'todo', 'still need to', 'follow up', 'then we'] },
  { type: 'research', phrases: ['looked into', 'investigated', 'turns out', 'according to', 'found that'] },
  { type: 'prompt', phrases: ['prompt:', 'system prompt', 'asked claude to'] },
  { type: 'important_context', phrases: ['note that', 'keep in mind', 'context:', 'background'] },
];

/**
 * Suggests a knowledge type from phrasing.
 *
 * Returns null rather than a low-confidence guess when nothing matches. An
 * unmarked segment with no suggestion is a perfectly good outcome — the user
 * picks a type, which is one dropdown, and is never shown a wrong default.
 */
export function suggestKnowledgeType(text: string): Suggestion<KnowledgeType> | null {
  const hay = ` ${(text ?? '').toLowerCase().replace(/\s+/g, ' ')} `;
  if (!hay.trim()) return null;

  let best: { type: KnowledgeType; hits: string[] } | null = null;
  for (const { type, phrases } of TYPE_HINTS) {
    const hits = phrases.filter((p) => hay.includes(p));
    if (hits.length === 0) continue;
    if (!best || hits.length > best.hits.length) best = { type, hits };
  }
  if (!best) return null;

  // Caps at 0.75. A phrase match is evidence about wording, not about meaning,
  // and a number close to 1 would read as certainty this method cannot have.
  const confidence = Math.min(0.75, 0.35 + best.hits.length * 0.2);
  return {
    value: best.type,
    confidence,
    basis: best.hits.map((h) => `matched “${h}”`),
  };
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'for', 'to', 'of', 'in', 'on', 'at', 'is', 'it',
  'we', 'i', 'you', 'this', 'that', 'with', 'as', 'be', 'are', 'was', 'were', 'app', 'new',
]);

function words(s: string): string[] {
  return (s ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Suggests which topic a capture belongs to.
 *
 * Two deterministic signals, in this order:
 *   1. Does the text mention distinctive words from the topic's name or slug?
 *   2. Failing that, which topic was worked on most recently?
 *
 * Recency alone is a weak signal, and it says so: it comes back at 0.2 with
 * "no name match; this is simply the topic you touched most recently" as its
 * basis, which is honest enough for a user to ignore at a glance.
 */
export function suggestTopic(
  text: string,
  topics: readonly Topic[],
): Suggestion<Topic> | null {
  if (topics.length === 0) return null;
  const hay = new Set(words(text));

  let best: { topic: Topic; hits: string[] } | null = null;
  for (const topic of topics) {
    const terms = new Set([...words(topic.name), ...words(topic.slug)]);
    const hits = [...terms].filter((t) => hay.has(t));
    if (hits.length === 0) continue;
    if (!best || hits.length > best.hits.length) best = { topic, hits };
  }

  if (best) {
    return {
      value: best.topic,
      confidence: Math.min(0.8, 0.4 + best.hits.length * 0.2),
      basis: best.hits.map((h) => `the text mentions “${h}”`),
    };
  }

  const recent = [...topics].sort((a, b) =>
    a.lastMeaningfulUpdateAt < b.lastMeaningfulUpdateAt ? 1 : -1,
  )[0];
  if (!recent) return null;
  return {
    value: recent,
    confidence: 0.2,
    basis: ['no name match; this is simply the topic you worked on most recently'],
  };
}

/**
 * Suggests a source from the shape of a paste.
 *
 * Structure, not vocabulary: a claude.ai URL, a git commit line, an
 * `User:`/`Assistant:` alternation. Returns null when the text says nothing —
 * and a null here means `manual`, which is the honest answer (rule 11).
 */
export function suggestSource(text: string): Suggestion<'claude_chat' | 'claude_code' | 'claude_cowork'> | null {
  const t = text ?? '';
  const basis: string[] = [];

  if (/https?:\/\/(www\.)?claude\.ai\/chat\//i.test(t)) basis.push('contains a claude.ai chat link');
  if (/^\s*(user|human)\s*:/im.test(t) && /^\s*(assistant|claude)\s*:/im.test(t)) {
    basis.push('alternates between User and Assistant turns');
  }
  if (basis.length > 0) {
    return { value: 'claude_chat', confidence: Math.min(0.8, 0.4 + basis.length * 0.2), basis };
  }

  const codeBasis: string[] = [];
  if (/\bcommit\s+[0-9a-f]{7,40}\b/i.test(t)) codeBasis.push('contains a commit sha');
  if (/^\s*(diff --git|\+\+\+ b\/|--- a\/)/m.test(t)) codeBasis.push('contains a diff');
  if (/^\s*\$\s+(git|npm|pnpm|yarn)\b/m.test(t)) codeBasis.push('contains a shell command');
  if (codeBasis.length > 0) {
    return { value: 'claude_code', confidence: Math.min(0.8, 0.4 + codeBasis.length * 0.2), basis: codeBasis };
  }

  return null;
}
