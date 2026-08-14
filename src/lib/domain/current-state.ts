import type { Decision, Idea, KnowledgeEntry } from './types';

/**
 * The Current-State-vs-History split, as pure functions.
 *
 * The database can express this as a WHERE clause, but the rule is important
 * enough — it is the product's central promise — that it lives here too, where
 * it can be tested without a database and reused by the Phase 4 Resume
 * assembler. Both must agree; `supabase/tests/03_history.test.sql` proves the
 * SQL side, `current-state.test.ts` proves this side.
 */

/** What is true right now: active, and not replaced by anything newer. */
export function currentEntries(entries: KnowledgeEntry[]): KnowledgeEntry[] {
  return entries.filter((e) => e.status === 'active' && e.supersededById === null);
}

/** Everything that ever happened, newest first. Nothing is filtered out. */
export function history(entries: KnowledgeEntry[]): KnowledgeEntry[] {
  return [...entries].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));
}

export interface AvoidItem {
  title: string;
  reason: string | null;
  kind: 'superseded_entry' | 'rejected_entry' | 'superseded_decision' | 'rejected_idea';
}

/**
 * Directions already evaluated and set aside, with the reasoning attached.
 *
 * This is the list that stops a fresh Claude session from re-proposing the
 * checkmark icon three months later. It is required in every Resume density
 * (CLAUDE.md rule 9), which is why it is computed here rather than inline in
 * the Phase 4 formatter.
 */
export function avoidList(input: {
  entries: KnowledgeEntry[];
  decisions: Decision[];
  ideas: Idea[];
}): AvoidItem[] {
  const items: AvoidItem[] = [];

  for (const entry of input.entries) {
    if (entry.status === 'superseded') {
      items.push({ title: entry.title, reason: entry.supersedesReason, kind: 'superseded_entry' });
    } else if (entry.status === 'rejected' || entry.knowledgeType === 'rejected_idea') {
      items.push({ title: entry.title, reason: entry.content, kind: 'rejected_entry' });
    }
  }

  for (const decision of input.decisions) {
    // `proposed` is excluded, and the exclusion is load-bearing rather than
    // tidy. "Not active" used to be a safe stand-in for "was decided and is no
    // longer", because every decision had been decided by somebody. Since
    // Phase 5 a Claude Code delivery can create one that was never decided at
    // all — and putting that on the avoid list would tell the next session
    // that a direction nobody has even reviewed was "evaluated and set aside".
    // It would refuse to do something that was never turned down, which is the
    // avoid list's own failure mode pointed the wrong way.
    if (decision.status !== 'active' && decision.status !== 'proposed') {
      items.push({
        title: decision.title,
        reason: decision.supersedeReason ?? decision.reason,
        kind: 'superseded_decision',
      });
    }
  }

  for (const idea of input.ideas) {
    if (idea.status === 'rejected') {
      items.push({ title: idea.title, reason: idea.rationale, kind: 'rejected_idea' });
    }
  }

  return items;
}

/**
 * Walks a supersession chain from any entry to the version in force.
 * Defends against a cycle rather than looping forever — a corrupt chain should
 * degrade, not hang the page.
 */
export function resolveCurrentVersion(
  entries: KnowledgeEntry[],
  startId: string,
): KnowledgeEntry | null {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const seen = new Set<string>();
  let node = byId.get(startId) ?? null;

  while (node?.supersededById) {
    if (seen.has(node.id)) return node;
    seen.add(node.id);
    const next = byId.get(node.supersededById);
    if (!next) return node;
    node = next;
  }
  return node;
}
