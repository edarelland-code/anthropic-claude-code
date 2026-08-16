import Link from 'next/link';

import { BOARD_COLUMNS, EMPTY, type BoardRow, type BoardSectionRows } from '@/lib/topics/board';
import { cn } from '@/lib/utils';

/**
 * The Topics table view.
 *
 * The alignment requirement is met structurally rather than by care: every
 * section renders `<TableCols />` into a `table-fixed` table. Under
 * `table-layout: fixed` a column's width comes from the colgroup and nothing
 * else — content cannot widen it — so two sections cannot disagree even when
 * one holds a 2,000-character Current State and the next holds nothing at all.
 *
 * This is also why an empty section still renders a full row: the placeholder
 * keeps the section a real table, so its header lines up with every other
 * section's header rather than collapsing to nothing.
 */

/** The one column definition. Every table on the page renders this. */
function TableCols() {
  return (
    <colgroup>
      {BOARD_COLUMNS.map((c) => (
        <col key={c.key} style={{ width: `${c.width}%` }} />
      ))}
    </colgroup>
  );
}

function HeaderRow() {
  return (
    <thead>
      <tr className="border-b hairline">
        {BOARD_COLUMNS.map((c) => (
          <th
            key={c.key}
            scope="col"
            className="px-3 py-2 text-left align-bottom text-[11px] font-medium uppercase tracking-wider muted"
          >
            {c.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/**
 * A narrative cell. `line-clamp-4` caps row height at roughly four lines so one
 * long Current State cannot make a row several screens tall; the full text
 * stays one click away on the Topic page.
 */
function Cell({ value, narrative }: { value: string; narrative: boolean }) {
  const empty = value === EMPTY;
  return (
    <td className="px-3 py-2.5 align-top text-sm leading-5">
      <span className={cn(narrative && 'line-clamp-4', empty && 'muted')}>{value}</span>
    </td>
  );
}

function Row({ row }: { row: BoardRow }) {
  return (
    <tr className="border-b align-top last:border-0 hairline hover:bg-slate-50 dark:hover:bg-slate-800/40">
      <td className="px-3 py-2.5 align-top text-sm">
        {/* Clamped like the narrative cells. Left free it was the only
            unclamped cell in the row, so a long idea title at a 129px column
            width set the height of the whole row — measured at 351px. */}
        <Link
          href={row.href}
          className="line-clamp-3 font-medium text-indigo-700 underline-offset-2 hover:underline focus-visible:underline dark:text-indigo-300"
        >
          {row.project}
        </Link>
        {row.context && <span className="mt-0.5 line-clamp-2 block text-xs muted">in {row.context}</span>}
      </td>
      <Cell value={row.what} narrative />
      <Cell value={row.state} narrative />
      <Cell value={row.completed} narrative />
      <Cell value={row.unfinished} narrative />
      <Cell value={row.next} narrative />
      <td className="px-3 py-2.5 align-top text-sm whitespace-nowrap muted">{row.activity}</td>
    </tr>
  );
}

/** The placeholder row for a section with nothing in it. */
function EmptyRow() {
  return (
    <tr className="border-b last:border-0 hairline">
      <td className="px-3 py-2.5 align-top text-sm muted">No projects</td>
      {BOARD_COLUMNS.slice(1).map((c) => (
        <td key={c.key} className="px-3 py-2.5 align-top text-sm muted">
          {EMPTY}
        </td>
      ))}
    </tr>
  );
}

export function TopicsTable({ sections }: { sections: BoardSectionRows[] }) {
  return (
    <div className="mt-6 space-y-8">
      {sections.map(({ section, rows }) => (
        <section key={section.key} aria-labelledby={`section-${section.key}`}>
          <h2
            id={`section-${section.key}`}
            className="mb-2 text-xs font-semibold uppercase tracking-wider muted"
          >
            {section.label}
            <span className="ml-2 font-normal normal-case tracking-normal">
              {rows.length > 0 ? `${rows.length}` : ''}
            </span>
          </h2>
          <div className="overflow-hidden rounded-lg surface">
            <table className="w-full table-fixed border-collapse">
              <caption className="sr-only">
                {section.label} projects, with what each is, its last known state, completed and
                unfinished work, best next action, and last activity.
              </caption>
              <TableCols />
              <HeaderRow />
              <tbody>
                {rows.length === 0 ? <EmptyRow /> : rows.map((r) => <Row key={`${r.kind}-${r.id}`} row={r} />)}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
