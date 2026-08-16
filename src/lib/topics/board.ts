/**
 * The Topics table view — every value it shows, derived deterministically.
 *
 * This module is pure on purpose. The three narrative columns ("what appears
 * completed", "what remains unfinished", "best next action") are the ones a
 * model would be tempted to write, and a dashboard that quietly paraphrases its
 * own records is a second memory that can disagree with the first. So they are
 * assembled here from record TITLES only, no model call, no sentence invented
 * that the underlying rows do not already make.
 *
 * The column widths live here too, as ONE exported definition. Every status
 * section renders the same `BOARD_COLUMNS` into a `table-fixed` table, which is
 * what makes the alignment guarantee mechanical rather than a matter of care:
 * under `table-layout: fixed` the column widths come from the colgroup and
 * nothing else, so content cannot move them and two sections cannot disagree.
 */
import type { IdeaStatus, TopicStatus, TopicSummary } from '@/lib/domain/types';

/** What an empty cell shows. Never a blank, so a row never looks truncated. */
export const EMPTY = '—';

export interface BoardColumn {
  key: string;
  label: string;
  /** Percentage of the table width. The seven must total 100. */
  width: number;
  /** Narrative cells are line-clamped; short cells are not. */
  narrative: boolean;
}

/**
 * The seven columns, defined once.
 *
 * Confidence is deliberately absent: the data model has no project-level
 * confidence, and inventing one here would be the dashboard asserting something
 * no record supports.
 */
export const BOARD_COLUMNS: readonly BoardColumn[] = [
  { key: 'project', label: 'Project', width: 13, narrative: false },
  { key: 'what', label: 'What it is', width: 15, narrative: true },
  { key: 'state', label: 'Last known state', width: 17, narrative: true },
  { key: 'completed', label: 'What appears completed', width: 16, narrative: true },
  { key: 'unfinished', label: 'What remains unfinished', width: 16, narrative: true },
  { key: 'next', label: 'Best next action', width: 15, narrative: true },
  { key: 'activity', label: 'Last activity', width: 8, narrative: false },
] as const;

export interface BoardSection {
  key: string;
  label: string;
  /** Canonical statuses that land here. Empty means "not sourced from topics". */
  statuses: TopicStatus[];
}

/**
 * Display sections, mapped onto the canonical statuses rather than a second
 * status field of their own.
 *
 * `probably_complete` has no canonical source, so it always renders the empty
 * row — kept because a section that can never fill is still information: it
 * says the product has no such state. `archived` gets a section because two
 * real topics live there and dropping them would hide them entirely.
 */
export const BOARD_SECTIONS: readonly BoardSection[] = [
  { key: 'active', label: 'Active', statuses: ['active'] },
  { key: 'paused', label: 'Paused', statuses: ['paused'] },
  { key: 'needs_review', label: 'Needs review', statuses: ['blocked'] },
  { key: 'probably_complete', label: 'Probably complete', statuses: [] },
  { key: 'complete', label: 'Complete', statuses: ['completed'] },
  { key: 'archived', label: 'Archived', statuses: ['archived'] },
  { key: 'ideas', label: 'Ideas', statuses: [] },
] as const;

/** Ideas that have not yet been acted on — the ones that never became work. */
export const UNACTED_IDEA_STATUSES: readonly IdeaStatus[] = ['suggested', 'considering'];

export interface BoardRow {
  id: string;
  kind: 'topic' | 'idea';
  href: string;
  project: string;
  /** For idea rows: the topic it belongs to, shown as context. */
  context: string | null;
  what: string;
  state: string;
  completed: string;
  unfinished: string;
  next: string;
  /** Rendered label. Sorting uses `activityAt`, never this. */
  activity: string;
  activityAt: string | null;
  status: TopicStatus | IdeaStatus;
}

export interface BoardSectionRows {
  section: BoardSection;
  rows: BoardRow[];
}

export type BoardSort = 'activity' | 'project' | 'status';

export interface BoardOptions {
  query?: string;
  status?: string;
  sort?: BoardSort;
  now?: Date;
}

/** Joins record titles into one sentence-per-record cell, capped for height. */
function assemble(titles: string[], limit = 3): string {
  const kept = titles.map((t) => t.trim()).filter(Boolean).slice(0, limit);
  if (kept.length === 0) return EMPTY;
  return kept.map((t) => (/[.!?]$/.test(t) ? t : `${t}.`)).join(' ');
}

/**
 * Compact activity label. Sorting never reads this — it reads the timestamp —
 * so a relative label cannot reorder anything.
 */
export function compactActivity(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return EMPTY;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return EMPTY;
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * "What appears completed" — explicit structured evidence only.
 *
 * Two sources qualify: an action someone marked done, and a knowledge entry
 * typed as implementation. Prose in Current State does NOT qualify, however
 * completed it sounds, because "we finished X" in a summary is a claim about
 * the past rather than a record of it.
 */
export function deriveCompleted(summary: TopicSummary): string {
  return assemble(summary.board.completed);
}

/**
 * "What remains unfinished" — unresolved structured records only: open next
 * steps, blockers, and open questions.
 */
export function deriveUnfinished(summary: TopicSummary): string {
  return assemble(summary.board.unfinished);
}

/**
 * "Best next action" — an explicit open action of kind `next_step`, and nothing
 * else.
 *
 * An open question is a thing to find out, not a thing to do. A blocker is what
 * stops work, not the work. Promoting either would put words in the record's
 * mouth, so both are excluded and the cell shows the em dash instead. Ordering
 * comes from the Action model's own `position`, already applied upstream.
 */
export function deriveNextAction(summary: TopicSummary): string {
  const next = summary.nextAction;
  if (!next || next.kind !== 'next_step') return EMPTY;
  return next.title.trim() || EMPTY;
}

function topicRow(summary: TopicSummary, now: Date): BoardRow {
  const { topic } = summary;
  return {
    id: topic.id,
    kind: 'topic',
    href: `/topics/${topic.id}`,
    project: topic.name,
    context: null,
    what: topic.description?.trim() || topic.goal?.trim() || EMPTY,
    state: topic.currentState?.trim() || EMPTY,
    completed: deriveCompleted(summary),
    unfinished: deriveUnfinished(summary),
    next: deriveNextAction(summary),
    activity: compactActivity(topic.lastMeaningfulUpdateAt, now),
    activityAt: topic.lastMeaningfulUpdateAt,
    status: topic.status,
  };
}

function ideaRows(summaries: TopicSummary[], now: Date): BoardRow[] {
  const rows: BoardRow[] = [];
  for (const s of summaries) {
    for (const idea of s.board.ideas) {
      if (!UNACTED_IDEA_STATUSES.includes(idea.status)) continue;
      rows.push({
        id: idea.id,
        kind: 'idea',
        // No per-idea route exists, so the row opens the Idea Library rather
        // than a detail page this feature would have to invent.
        href: '/ideas',
        project: idea.title,
        context: s.topic.name,
        what: idea.body?.trim() || EMPTY,
        state: idea.rationale?.trim() || `Idea status: ${idea.status}.`,
        // An idea carries no completion or next-step records of its own. The
        // honest cell is the em dash, not a guess assembled from its parent.
        completed: EMPTY,
        unfinished: EMPTY,
        next: EMPTY,
        activity: compactActivity(idea.updatedAt, now),
        activityAt: idea.updatedAt,
        status: idea.status,
      });
    }
  }
  return rows;
}

function matches(row: BoardRow, summary: TopicSummary | null, q: string): boolean {
  const haystack = [
    row.project,
    row.context ?? '',
    summary?.topic.description ?? '',
    summary?.topic.goal ?? '',
    summary?.topic.currentState ?? '',
    row.kind === 'idea' ? row.what : '',
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(q);
}

const BY = {
  activity: (a: BoardRow, b: BoardRow) => {
    const at = a.activityAt ? Date.parse(a.activityAt) : -Infinity;
    const bt = b.activityAt ? Date.parse(b.activityAt) : -Infinity;
    // Newest first, then name so the order is total and paging is stable.
    return bt - at || a.project.localeCompare(b.project);
  },
  project: (a: BoardRow, b: BoardRow) => a.project.localeCompare(b.project),
  status: (a: BoardRow, b: BoardRow) =>
    String(a.status).localeCompare(String(b.status)) || a.project.localeCompare(b.project),
} satisfies Record<BoardSort, (a: BoardRow, b: BoardRow) => number>;

/**
 * Builds every section. Sections are never dropped for being empty — an empty
 * one still renders its header and a single placeholder row, which is what
 * keeps the seven columns lined up down the whole page.
 */
export function buildBoard(summaries: TopicSummary[], opts: BoardOptions = {}): BoardSectionRows[] {
  const now = opts.now ?? new Date();
  const q = (opts.query ?? '').trim().toLowerCase();
  const sort = opts.sort ?? 'activity';
  const wanted = opts.status && opts.status !== 'all' ? opts.status : null;

  const byId = new Map(summaries.map((s) => [s.topic.id, s]));
  const topics = summaries.map((s) => topicRow(s, now));
  const ideas = ideaRows(summaries, now);

  return BOARD_SECTIONS.filter((section) => !wanted || section.key === wanted).map((section) => {
    let rows =
      section.key === 'ideas'
        ? ideas
        : topics.filter((r) => section.statuses.includes(r.status as TopicStatus));

    if (q) rows = rows.filter((r) => matches(r, r.kind === 'topic' ? byId.get(r.id) ?? null : null, q));
    return { section, rows: [...rows].sort(BY[sort]) };
  });
}
