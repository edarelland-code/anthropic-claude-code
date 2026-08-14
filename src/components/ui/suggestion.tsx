import { CircleHelp, Quote } from 'lucide-react';

/**
 * The visible difference between "the text said this" and "we guessed this".
 *
 * CLARIFICATION 4. A deterministic keyword match must never look like
 * understanding. These two chips are the only way a classification is allowed
 * to be labelled in the UI, and they never appear on the same segment: a
 * segment is either read from something the author wrote, or it is a proposal
 * waiting on a person.
 *
 * `Suggested` carries its evidence in a tooltip because a suggestion the user
 * cannot audit is indistinguishable from an answer.
 */
export function StatedChip({ detail }: { detail?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/25 dark:text-emerald-400"
      title={detail ?? 'Read from a label or heading in the text you pasted.'}
    >
      <Quote className="size-3" aria-hidden />
      In the text
    </span>
  );
}

export function SuggestedChip({ basis, confidence }: { basis?: string[]; confidence?: number }) {
  const why = basis?.length ? basis.join('; ') : 'A keyword match, not an interpretation.';
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-600/30 dark:text-amber-400"
      title={
        confidence === undefined
          ? `Suggested — ${why}`
          : `Suggested (${Math.round(confidence * 100)}% keyword confidence) — ${why}`
      }
    >
      <CircleHelp className="size-3" aria-hidden />
      Suggested
    </span>
  );
}

/**
 * The sentence that goes above any group of suggestions.
 *
 * Written to be read, not skimmed past: it says what the mechanism is, so the
 * user calibrates on the method rather than on the confidence number.
 */
export function SuggestionNotice({ children }: { children?: React.ReactNode }) {
  return (
    <p className="mt-1 text-xs leading-5 muted">
      {children ?? (
        <>
          Suggestions come from matching words and dates — not from reading for meaning. Nothing
          below is recorded until you confirm it.
        </>
      )}
    </p>
  );
}
