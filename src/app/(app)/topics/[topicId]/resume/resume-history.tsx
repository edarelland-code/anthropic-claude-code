'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, ChevronDown, Copy, History, Trash2 } from 'lucide-react';

import type { Subtopic } from '@/lib/domain/types';
import type { ResumeExport } from '@/lib/ports/repositories';
import { formatDate } from '@/lib/utils';

import { deleteResumeExportAction, type FormState } from './actions';

const TARGET_LABELS: Record<string, string> = {
  claude_chat: 'Claude Chat',
  claude_cowork: 'Claude Cowork',
  claude_code: 'Claude Code',
};

/**
 * What context was given to Claude, and when.
 *
 * An audit trail, and the wording throughout says so. These rows answer "what
 * did I tell it?" after the fact; nothing here feeds back into assembly, and
 * "Copy again" copies the stored body verbatim rather than regenerating —
 * which is the point, since the whole reason to look at an old export is to see
 * what was actually sent, not what would be sent now.
 */
export function ResumeHistory({
  topicId,
  exports,
  subtopics,
}: {
  topicId: string;
  exports: ResumeExport[];
  subtopics: Subtopic[];
}) {
  if (exports.length === 0) {
    return (
      <section className="rounded-lg p-4 surface">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <History className="size-4 muted" aria-hidden />
          Resume history
        </h2>
        <p className="mt-2 text-sm leading-6 muted">
          Nothing exported yet. Once you copy a resume context it is recorded here, so months from
          now you can see exactly what a session was told.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg p-4 surface">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <History className="size-4 muted" aria-hidden />
        Resume history
        <span className="ml-auto text-xs muted">{exports.length}</span>
      </h2>
      <p className="mt-1 text-xs leading-5 muted">
        A record of what was exported. These are never read back when assembling a new resume.
      </p>

      <ul className="mt-3 space-y-2">
        {exports.map((e) => (
          <ExportRow
            key={e.id}
            topicId={topicId}
            item={e}
            subtopicName={subtopics.find((s) => s.id === e.subtopicId)?.name ?? null}
          />
        ))}
      </ul>
    </section>
  );
}

function DeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      title="Remove this record. Snapshots are regenerable, so nothing authoritative is lost."
      className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-xs muted ring-1 ring-inset hairline hover:bg-black/[0.04] disabled:opacity-60 dark:hover:bg-white/[0.06]"
    >
      <Trash2 className="size-3.5" aria-hidden />
      {pending ? 'Removing…' : 'Remove'}
    </button>
  );
}

function ExportRow({
  topicId,
  item,
  subtopicName,
}: {
  topicId: string;
  item: ResumeExport;
  subtopicName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [state, action] = useActionState<FormState, FormData>(deleteResumeExportAction, {
    error: null,
  });

  return (
    <li className="rounded-md p-3 ring-1 ring-inset hairline">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">{TARGET_LABELS[item.target] ?? item.target}</span>
        <span className="rounded px-1.5 py-0.5 text-[11px] muted ring-1 ring-inset hairline">
          {item.density.replace('_', ' ')}
        </span>
        {subtopicName && <span className="text-xs muted">{subtopicName}</span>}
        <span className="text-xs tabular-nums muted">
          ~{(item.meta.approxTokens ?? 0).toLocaleString()} tokens
        </span>
        {(item.meta.conflicts ?? 0) > 0 && (
          <span className="text-[11px] text-amber-700 dark:text-amber-400">
            {item.meta.conflicts} conflict{item.meta.conflicts === 1 ? '' : 's'} at the time
          </span>
        )}
        <time className="ml-auto shrink-0 text-xs tabular-nums muted" dateTime={item.generatedAt}>
          {formatDate(item.generatedAt)}
        </time>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(item.body);
              setCopied(true);
            } catch {
              setOpen(true);
            }
          }}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ring-1 ring-inset hairline hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? 'Copied' : 'Copy again'}
        </button>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2.5 text-xs ring-1 ring-inset hairline hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
        >
          View
          <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>

        <form action={action} className="contents">
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="topicId" value={topicId} />
          <DeleteButton />
        </form>

        {state.error && (
          <span role="alert" className="text-xs text-rose-600 dark:text-rose-400">
            {state.error}
          </span>
        )}
      </div>

      {open && (
        <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md p-3 text-xs leading-6 hairline">
          {item.body}
        </pre>
      )}
    </li>
  );
}
