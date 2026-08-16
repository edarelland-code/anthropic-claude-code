import Link from 'next/link';

import { EMPTY, type BoardSectionRows } from '@/lib/topics/board';

/**
 * The same board data at phone and tablet widths.
 *
 * Not a shrunken table — seven columns at 390px is unreadable however it is
 * squeezed, and sideways scrolling to read a dashboard is worse than no
 * dashboard. Both layouts render server-side and are swapped by a media query
 * rather than by measuring the viewport, so there is no flash of the wrong one.
 *
 * Secondary values appear only when they exist; the em dash is reserved for the
 * fields that are always shown, so a card never lists four empty rows.
 */
export function TopicsBoardCards({ sections }: { sections: BoardSectionRows[] }) {
  return (
    <div className="mt-6 space-y-8">
      {sections.map(({ section, rows }) => (
        <section key={section.key} aria-labelledby={`m-section-${section.key}`}>
          <h2
            id={`m-section-${section.key}`}
            className="mb-2 text-xs font-semibold uppercase tracking-wider muted"
          >
            {section.label}
          </h2>

          {rows.length === 0 ? (
            <p className="rounded-lg p-4 text-sm muted surface">No projects</p>
          ) : (
            <ul className="space-y-2.5">
              {rows.map((row) => (
                <li key={`${row.kind}-${row.id}`}>
                  <Link
                    href={row.href}
                    // min-w-0 for the same reason the topic card needs it: a
                    // flex child refuses to shrink below its content otherwise,
                    // and one long unbroken string then scrolls the page.
                    className="flex min-w-0 flex-col rounded-lg p-4 transition-colors surface hover:border-indigo-300 dark:hover:border-indigo-500/40"
                  >
                    <div className="flex items-start gap-2">
                      <span className="min-w-0 flex-1 text-sm font-semibold">{row.project}</span>
                      <span className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset muted hairline">
                        {row.status}
                      </span>
                    </div>
                    {row.context && <span className="mt-0.5 text-xs muted">in {row.context}</span>}

                    <p className="mt-2 line-clamp-2 text-sm leading-5 muted">{row.what}</p>

                    <p className="mt-2 line-clamp-3 text-sm leading-5">
                      <span className="text-xs font-medium uppercase tracking-wider muted">
                        State ·{' '}
                      </span>
                      {row.state}
                    </p>

                    <p className="mt-2 line-clamp-2 text-sm leading-5">
                      <span className="text-xs font-medium uppercase tracking-wider muted">
                        Next ·{' '}
                      </span>
                      {row.next}
                    </p>

                    {row.completed !== EMPTY && (
                      <p className="mt-2 line-clamp-2 text-sm leading-5 muted">
                        <span className="text-xs font-medium uppercase tracking-wider">Done · </span>
                        {row.completed}
                      </p>
                    )}
                    {row.unfinished !== EMPTY && (
                      <p className="mt-1.5 line-clamp-2 text-sm leading-5 muted">
                        <span className="text-xs font-medium uppercase tracking-wider">Open · </span>
                        {row.unfinished}
                      </p>
                    )}

                    <span className="mt-3 border-t pt-2.5 text-[11px] muted hairline">
                      {row.activity}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
