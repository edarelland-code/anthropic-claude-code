import { Construction } from 'lucide-react';

/**
 * CLAUDE.md rule 14: an unbuilt section says what it will do and which phase
 * builds it. It never renders fake data or an empty shell that reads as done.
 */
export function PhaseNotice({
  title,
  phase,
  summary,
  willInclude,
}: {
  title: string;
  phase: number;
  summary: string;
  willInclude: string[];
}) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <div className="rounded-lg p-6 surface">
        <div className="flex items-center gap-2.5">
          <Construction className="size-4 muted" aria-hidden />
          <h1 className="text-base font-semibold">{title}</h1>
          <span className="ml-auto rounded px-1.5 py-0.5 text-[11px] font-medium muted ring-1 ring-inset hairline">
            Phase {phase}
          </span>
        </div>
        <p className="mt-3 text-sm leading-6 muted">{summary}</p>
        <p className="mt-5 text-xs font-medium uppercase tracking-wider muted">Will include</p>
        <ul className="mt-2 space-y-1.5">
          {willInclude.map((item) => (
            <li key={item} className="flex gap-2 text-sm muted">
              <span aria-hidden>·</span>
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-5 border-t pt-4 text-xs leading-5 muted hairline">
          Not built yet — this screen holds no data and does nothing. The roadmap and current
          status live in <code>docs/DEVELOPMENT_STATE.md</code>.
        </p>
      </div>
    </div>
  );
}
