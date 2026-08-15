import { CheckCircle2, CircleDashed, Cpu } from 'lucide-react';

import type { ProviderStatus } from '@/lib/extraction/providers';
import type { ExtractionRun } from '@/lib/ports/repositories';
import { formatDate } from '@/lib/utils';

/**
 * Extraction settings, and the history of what ran (Phase 6AG/6R/6S).
 *
 * The naming here is the product's honesty in one screen. Two distinct things
 * are listed and never conflated:
 *
 *   * **Deterministic extraction** — labels and phrasing. Always available,
 *     needs no key, sends nothing anywhere.
 *   * **AI-assisted extraction** — a model. When no key is in the server
 *     environment it says so plainly rather than dressing it as "coming soon";
 *     when one is, it names the exact model identifier, because "which model
 *     produced this suggestion" is the question an audit asks.
 *
 * Exactly one row reads Active, and it is the provider a run would really use —
 * not the first configured one, which is always the built-in.
 *
 * There is no field to paste a key into, and that is deliberate rather than
 * unfinished: a key stored in the database would need encrypting at rest, and
 * the server environment is where it belongs. The screen explains that instead
 * of offering a box that would quietly be the wrong thing.
 */
export function ExtractionSettings({
  providers,
  runs,
}: {
  providers: ProviderStatus[];
  runs: ExtractionRun[];
}) {
  return (
    <section className="mt-4 rounded-lg p-4 surface">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Cpu className="size-4 muted" aria-hidden />
        Extraction
      </h2>
      <p className="mt-1 text-xs leading-5 muted">
        Turning a pasted conversation into records you review and confirm. Nothing extraction
        proposes is ever filed without you.
      </p>

      <ul className="mt-3 space-y-2">
        {providers.map((p) => (
          <li key={p.id} className="rounded-md p-3 ring-1 ring-inset hairline">
            <div className="flex flex-wrap items-center gap-2">
              {p.configured ? (
                <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              ) : (
                <CircleDashed className="size-4 shrink-0 muted" aria-hidden />
              )}
              <span className="text-sm font-medium">
                {p.id === 'deterministic' ? 'Deterministic extraction' : 'AI-assisted extraction'}
              </span>
              <span className="text-xs muted">{p.label}</span>
              {p.model && <code className="text-[11px] muted">{p.model}</code>}
              <span className="ml-auto text-xs muted">
                {p.active ? 'Active' : p.configured ? 'Available' : 'Not configured'}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 muted">
              {p.id === 'deterministic'
                ? 'Reads the labels and phrasing in a source. It does not understand the conversation, and it is never described as AI anywhere in the app. Always available, and nothing leaves this server.'
                : (p.problem ??
                  'Sends the selected source to the model provider and returns structured suggestions.')}
            </p>
            {p.sendsContentExternally && (
              <p className="mt-1 text-[11px] muted">
                When configured, analysing sends the selected source content to the provider. It
                never sends ingestion tokens, auth tokens, other topics, or application secrets.
              </p>
            )}
          </li>
        ))}
      </ul>

      {runs.length > 0 && (
        <div className="mt-4 border-t pt-3 hairline">
          <h3 className="text-xs font-medium">Recent extraction runs</h3>
          <ul className="mt-2 space-y-1.5 text-xs">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{r.provider}</span>
                <span className="muted">prompt v{r.promptVersion}</span>
                <span className={r.status === 'succeeded' ? 'muted' : 'text-amber-700 dark:text-amber-400'}>
                  {r.status}
                </span>
                <span className="muted">
                  {r.suggestedCount} suggested · {r.confirmedCount} confirmed · {r.rejectedCount} rejected
                </span>
                {(r.inputTokens ?? 0) + (r.outputTokens ?? 0) > 0 && (
                  <span className="muted">
                    {r.inputTokens ?? 0} in / {r.outputTokens ?? 0} out
                  </span>
                )}
                <time className="ml-auto shrink-0 tabular-nums muted" dateTime={r.startedAt}>
                  {formatDate(r.startedAt)}
                </time>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] muted">
            The prompt version is recorded so a change in extraction behaviour is traceable. No
            model reasoning is stored — only the evidence a suggestion cited.
          </p>
        </div>
      )}
    </section>
  );
}
