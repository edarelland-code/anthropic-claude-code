'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { ChevronDown, Upload } from 'lucide-react';

import { SegmentEditor, type EditableSegment } from '@/components/capture/segment-editor';
import { SOURCE_META } from '@/lib/domain/knowledge';
import type { Topic } from '@/lib/domain/types';
import { ADAPTERS } from '@/lib/ingestion/adapters';
import { CLAUDE_SESSION_EXAMPLE } from '@/lib/ingestion/schema';

import { importAction, previewPaste, type FormState } from './actions';

type Preview = Awaited<ReturnType<typeof previewPaste>>;

/**
 * Import with a preview gate.
 *
 * Nothing is written until the user has seen exactly what would be created and
 * pressed Import. That is not a nicety: an import writes into permanent memory,
 * and a wrong one is only removable by superseding it with a reason — expensive
 * enough that a preview is cheaper than the alternative.
 *
 * Behind a disclosure, closed by default, because Quick Capture above it is the
 * flow that has to stay one step.
 */
function ImportButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
    >
      <Upload className="size-4" aria-hidden />
      {pending ? 'Importing…' : 'Import'}
    </button>
  );
}

export function ImportPanel({
  topics,
  subtopicsByTopic,
}: {
  topics: Topic[];
  subtopicsByTopic: Record<string, { id: string; name: string }[]>;
}) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState('');
  const [adapterId, setAdapterId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pendingPreview, startPreview] = useTransition();
  const [topicId, setTopicId] = useState('');
  const [state, action] = useActionState<FormState, FormData>(importAction, { error: null });

  const runPreview = () => {
    startPreview(async () => {
      setPreview(await previewPaste(raw, adapterId || undefined));
    });
  };

  const segments: EditableSegment[] =
    preview?.ok
      ? preview.segments.map((s, i) => ({
          key: `s${i}`,
          origin: 'stated' as const,
          knowledgeType: s.knowledgeType,
          title: s.title,
          content: s.content,
          sourceReference: s.sourceReference,
        }))
      : [];

  return (
    <div className="rounded-lg surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium"
      >
        <Upload className="size-4 muted" aria-hidden />
        Import a transcript, JSON, or link
        <ChevronDown
          className={`ml-auto size-4 muted transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && (
        <div className="border-t px-4 pb-4 pt-3 hairline">
          <label htmlFor="import-raw" className="text-xs font-medium">
            Paste the content
          </label>
          <textarea
            id="import-raw"
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setPreview(null);
            }}
            rows={7}
            placeholder="A transcript, a Claude session JSON payload, or a URL…"
            className="mt-1.5 w-full resize-y rounded-md border-0 px-3 py-2.5 font-mono text-xs leading-6 ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
            style={{ background: 'var(--background)' }}
          />

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={adapterId}
              onChange={(e) => {
                setAdapterId(e.target.value);
                setPreview(null);
              }}
              aria-label="Importer"
              className="min-h-11 rounded-md border-0 px-2 text-xs ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
              style={{ background: 'var(--background)' }}
            >
              <option value="">Detect automatically</option>
              {ADAPTERS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={runPreview}
              disabled={!raw.trim() || pendingPreview}
              className="inline-flex min-h-11 items-center rounded-md px-3 text-xs font-medium ring-1 ring-inset hairline hover:bg-black/[0.04] disabled:opacity-50 dark:hover:bg-white/[0.06]"
            >
              {pendingPreview ? 'Reading…' : 'Preview'}
            </button>

            <details className="ml-auto">
              <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs muted">
                JSON format
              </summary>
              <pre className="mt-1.5 max-h-52 overflow-auto whitespace-pre rounded-md p-2.5 text-[11px] leading-5 hairline">
                {CLAUDE_SESSION_EXAMPLE}
              </pre>
            </details>
          </div>

          {preview && !preview.ok && (
            <p role="alert" className="mt-3 text-sm text-rose-600 dark:text-rose-400">
              {preview.error}
            </p>
          )}

          {preview?.ok && (
            <form action={action} className="mt-4">
              <input type="hidden" name="adapterId" value={preview.adapterId} />
              <input type="hidden" name="sourceType" value={preview.sourceType} />
              <input type="hidden" name="raw" value={raw} />
              {preview.title && <input type="hidden" name="title" value={preview.title} />}
              {preview.occurredAt && (
                <input type="hidden" name="occurredAt" value={preview.occurredAt} />
              )}
              {preview.externalUrl && (
                <input type="hidden" name="externalUrl" value={preview.externalUrl} />
              )}

              <p className="text-xs muted">
                Read as <span className="font-medium">{SOURCE_META[preview.sourceType].label}</span>
                {preview.title ? ` · ${preview.title}` : ''}
              </p>

              {preview.warnings.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-xs leading-5 muted">
                  {preview.warnings.map((w) => (
                    <li key={w}>· {w}</li>
                  ))}
                </ul>
              )}

              <div className="mt-3">
                <SegmentEditor segments={segments} />
              </div>

              <div className="mt-4 flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1">
                  <label htmlFor="import-topic" className="text-xs font-medium">
                    File into
                  </label>
                  <select
                    id="import-topic"
                    name="topicId"
                    required
                    value={topicId}
                    onChange={(e) => setTopicId(e.target.value)}
                    className="mt-1 min-h-11 w-full rounded-md border-0 px-2 text-sm ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
                    style={{ background: 'var(--background)' }}
                  >
                    <option value="">Choose a topic…</option>
                    {topics.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                {topicId && (subtopicsByTopic[topicId]?.length ?? 0) > 0 && (
                  <div className="min-w-0 flex-1">
                    <label htmlFor="import-subtopic" className="text-xs font-medium">
                      Subtopic
                    </label>
                    <select
                      id="import-subtopic"
                      name="subtopicId"
                      className="mt-1 min-h-11 w-full rounded-md border-0 px-2 text-sm ring-1 ring-inset hairline focus:ring-2 focus:ring-indigo-500"
                      style={{ background: 'var(--background)' }}
                    >
                      <option value="">None</option>
                      {subtopicsByTopic[topicId]!.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <ImportButton />
              </div>

              {topics.length === 0 && (
                <p className="mt-2 text-xs muted">
                  Create a topic first — every record belongs to one.
                </p>
              )}

              {state.error && (
                <p role="alert" className="mt-2 text-sm text-rose-600 dark:text-rose-400">
                  {state.error}
                </p>
              )}
            </form>
          )}
        </div>
      )}
    </div>
  );
}
