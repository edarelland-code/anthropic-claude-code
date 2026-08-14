'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { AlertTriangle, Check, Copy, FileText, Loader2, RefreshCw } from 'lucide-react';

import { CONTEXT_DENSITIES, RESUME_TARGETS, type ContextDensity, type ResumeTarget } from '@/lib/domain/types';
import { cn } from '@/lib/utils';

import { generateResume, recordResumeExport, type GeneratedResume } from './actions';

const TARGET_LABELS: Record<ResumeTarget, string> = {
  claude_chat: 'Claude Chat',
  claude_cowork: 'Claude Cowork',
  claude_code: 'Claude Code',
};

const DENSITY_LABELS: Record<ContextDensity, string> = {
  compact: 'Compact',
  standard: 'Standard',
  full_audit: 'Full Audit',
};

const DENSITY_HINTS: Record<ContextDensity, string> = {
  compact: 'Where you are, what is decided, what not to repeat, what is next.',
  standard: 'A normal continuation session — adds requirements, history, prompts, files.',
  full_audit: 'A handoff or architecture review — the complete record, including what was rejected.',
};

const BAND_LABELS: Record<string, string> = {
  normal: 'Normal',
  moderate: 'Moderate',
  large: 'Large',
  very_large: 'Very large',
};

const FRESHNESS_TONE: Record<string, string> = {
  fresh: 'text-emerald-700 dark:text-emerald-400',
  few_days: 'muted',
  stale: 'text-amber-700 dark:text-amber-400',
  needs_review: 'text-amber-700 dark:text-amber-400',
};

/**
 * The Resume flow.
 *
 * Scope, destination and density are three visible choices with sensible
 * defaults, and the preview regenerates as they change — the common path is
 * open, glance, copy. Nothing is written until the user copies, and then only
 * an audit record of what was taken.
 *
 * Regeneration is deliberate rather than debounced-on-keystroke: each change is
 * a discrete decision, and a preview that flickered while someone read it would
 * be worse than one that updates on click.
 */
export function ResumeFlow({
  topicId,
  subtopics,
  initialSubtopicId,
}: {
  topicId: string;
  subtopics: Array<{ id: string; name: string }>;
  initialSubtopicId: string | null;
}) {
  const [subtopicId, setSubtopicId] = useState<string | null>(initialSubtopicId);
  const [target, setTarget] = useState<ResumeTarget>('claude_chat');
  const [density, setDensity] = useState<ContextDensity>('standard');
  const [excluded, setExcluded] = useState<string[]>([]);
  const [resume, setResume] = useState<GeneratedResume | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Keyed rather than reset in an effect: "copied" is a fact about a
  // particular generated document, so it is derived from which document is on
  // screen. Clearing it from the effect that regenerates would be a cascading
  // render, and would also leave a window where the button says Copied about
  // text that is no longer shown.
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<{ key: string; message: string | null } | null>(null);
  const [pending, start] = useTransition();
  const previewRef = useRef<HTMLPreElement>(null);

  const key = useMemo(
    () => `${subtopicId ?? ''}|${target}|${density}|${excluded.join(',')}`,
    [subtopicId, target, density, excluded],
  );

  const copied = copiedKey === key;
  const recordedMessage = recorded?.key === key ? recorded.message : null;

  useEffect(() => {
    start(async () => {
      const result = await generateResume({
        topicId,
        subtopicId,
        target,
        density,
        excludeSections: excluded,
      });
      if (result.ok) {
        setResume(result.resume);
        setError(null);
      } else {
        setResume(null);
        setError(result.error);
      }
    });
    // `key` collapses the five inputs into one dependency so the preview
    // regenerates exactly once per change rather than once per field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, topicId]);

  const copy = async () => {
    if (!resume) return;

    // The clipboard API is unavailable in some browsers and denied in others.
    // When it fails the text is selected instead, so the user can still take
    // it with one keystroke — and the export is still recorded, because
    // clicking Copy IS the act of taking the context. A history that silently
    // omitted an export whenever the clipboard misbehaved would be worse than
    // one that occasionally records an export the user abandoned.
    let viaClipboard = true;
    try {
      await navigator.clipboard.writeText(resume.markdown);
    } catch {
      viaClipboard = false;
      const pre = previewRef.current;
      if (pre) {
        const range = document.createRange();
        range.selectNodeContents(pre);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setError('The clipboard is blocked in this browser. The context below is selected — press ⌘/Ctrl + C.');
    }
    setCopiedKey(key);

    // Recorded after the copy, so history says what was actually taken to
    // Claude rather than what happened to be on screen. A failure here is
    // reported but never costs the user the text they came for.
    const state = await recordResumeExport({
      topicId,
      subtopicId,
      target,
      density,
      markdown: resume.markdown,
      characters: resume.size.characters,
      words: resume.size.words,
      approxTokens: resume.size.approxTokens,
      sections: resume.sectionsIncluded,
      recordIds: resume.recordIds,
      freshness: resume.freshness.level,
      conflicts: resume.conflicts.length,
    });
    setRecorded({
      key,
      message: state.error ?? (viaClipboard ? state.message : 'Recorded. Press ⌘/Ctrl + C to copy the selected text.') ?? null,
    });
  };

  return (
    <div>
      <section className="rounded-lg p-4 surface sm:p-5">
        <h2 className="text-sm font-semibold">What to resume</h2>

        <div className="mt-3 space-y-3">
          <Choice label="Scope">
            <Chip active={subtopicId === null} onClick={() => setSubtopicId(null)}>
              Entire topic
            </Chip>
            {subtopics.map((s) => (
              <Chip key={s.id} active={subtopicId === s.id} onClick={() => setSubtopicId(s.id)}>
                {s.name}
              </Chip>
            ))}
          </Choice>

          <Choice label="Destination">
            {RESUME_TARGETS.map((t) => (
              <Chip key={t} active={target === t} onClick={() => setTarget(t)}>
                {TARGET_LABELS[t]}
              </Chip>
            ))}
          </Choice>

          <Choice label="Density">
            {CONTEXT_DENSITIES.map((d) => (
              <Chip key={d} active={density === d} onClick={() => setDensity(d)} title={DENSITY_HINTS[d]}>
                {DENSITY_LABELS[d]}
              </Chip>
            ))}
          </Choice>
          <p className="text-xs leading-5 muted">{DENSITY_HINTS[density]}</p>
        </div>
      </section>

      {error && (
        <p role="alert" className="mt-3 rounded-lg p-4 text-sm text-rose-600 surface dark:text-rose-400">
          {error}
        </p>
      )}

      {resume && (
        <>
          <section className="mt-3 rounded-lg p-4 surface sm:p-5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
              <span className={cn('font-medium', FRESHNESS_TONE[resume.freshness.level] ?? 'muted')}>
                {resume.freshness.message}
              </span>
              <span className="muted">
                {resume.size.characters.toLocaleString()} characters · {resume.size.words.toLocaleString()} words ·
                ~{resume.size.approxTokens.toLocaleString()} tokens
              </span>
              <span
                className="rounded px-1.5 py-0.5 font-medium muted ring-1 ring-inset hairline"
                title="Approximate, from a fixed 3.7 characters-per-token ratio. No tokenizer is called."
              >
                {BAND_LABELS[resume.size.band] ?? resume.size.band}
              </span>
            </div>

            {resume.conflicts.length > 0 && (
              <div className="mt-3 rounded-md p-3 ring-1 ring-inset ring-amber-600/30">
                <p className="flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="size-3.5" aria-hidden />
                  {resume.conflicts.length} unresolved{' '}
                  {resume.conflicts.length === 1 ? 'conflict' : 'conflicts'} in your records
                </p>
                <ul className="mt-1.5 space-y-1 text-xs leading-5">
                  {resume.conflicts.map((c) => (
                    <li key={`${c.kind}-${c.recordIds.join('-')}`}>· {c.summary}</li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[11px] muted">
                  Nothing has been resolved. The export includes this warning so the session asks rather
                  than picks.
                </p>
              </div>
            )}

            {resume.suggestions.length > 0 && (
              <div className="mt-3 rounded-md p-3 ring-1 ring-inset hairline">
                <p className="text-xs font-medium">This export is large. Nothing has been removed.</p>
                <ul className="mt-1 space-y-1 text-xs leading-5 muted">
                  {resume.suggestions.map((s) => (
                    <li key={s}>· {s}</li>
                  ))}
                </ul>
              </div>
            )}

            {resume.truncations.length > 0 && (
              <p className="mt-2 text-xs muted">
                Capped by this density:{' '}
                {resume.truncations
                  .map((t) => `${t.section} (${t.shown} of ${t.total})`)
                  .join(', ')}
                . Choose Full Audit to include everything.
              </p>
            )}

            <div className="mt-3">
              <p className="text-xs font-medium">Sections included</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {resume.sectionsIncluded.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setExcluded((prev) => [...prev, s])}
                    className="inline-flex min-h-11 items-center gap-1 rounded-full px-2.5 text-[11px] ring-1 ring-inset hairline hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                    title="Exclude this section"
                  >
                    {s}
                    <span aria-hidden>×</span>
                  </button>
                ))}
                {excluded.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setExcluded((prev) => prev.filter((x) => x !== s))}
                    className="inline-flex min-h-11 items-center gap-1 rounded-full px-2.5 text-[11px] opacity-50 ring-1 ring-inset hairline"
                    title="Put this section back"
                  >
                    {s}
                    <span aria-hidden>+</span>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <div className="sticky bottom-20 z-10 mt-3 flex flex-wrap items-center gap-3 rounded-lg p-3 surface lg:bottom-4">
            <button
              type="button"
              onClick={copy}
              disabled={pending}
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              {copied ? 'Copied' : 'Copy resume context'}
            </button>
            {pending && (
              <span className="inline-flex items-center gap-1.5 text-xs muted">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Regenerating…
              </span>
            )}
            <p aria-live="polite" className="text-xs muted">
              {copied
                ? (recordedMessage ?? 'Paste this into a fresh Claude session.')
                : 'Generated fresh from your records every time.'}
            </p>
          </div>

          <section className="mt-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <FileText className="size-4 muted" aria-hidden />
              Preview
              <button
                type="button"
                onClick={() => setExcluded([])}
                className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-xs ring-1 ring-inset hairline hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
              >
                <RefreshCw className="size-3.5" aria-hidden />
                Reset sections
              </button>
            </h2>
            <pre
              ref={previewRef}
              className="mt-2 max-h-[36rem] overflow-auto whitespace-pre-wrap break-words rounded-lg p-4 text-xs leading-6 surface"
            >
              {resume.markdown}
            </pre>
          </section>
        </>
      )}

      {!resume && !error && (
        <p className="mt-3 rounded-lg p-4 text-sm muted surface">Assembling this topic’s context…</p>
      )}
    </div>
  );
}

function Choice({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="text-xs font-medium">{label}</legend>
      <div className="mt-1.5 flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}

function Chip({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        'inline-flex min-h-11 items-center rounded-full px-3 text-xs ring-1 ring-inset transition-colors',
        active
          ? 'bg-indigo-600 font-medium text-white ring-indigo-600'
          : 'hairline hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
      )}
    >
      {children}
    </button>
  );
}
