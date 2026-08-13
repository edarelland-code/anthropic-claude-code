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
    if (decision.status !== 'active') {
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
