import Link from 'next/link';
import { ExternalLink, FileCode, Link2 } from 'lucide-react';

import { getData } from '@/lib/data';
import type { FileReference, Topic } from '@/lib/domain/types';
import { formatDate } from '@/lib/utils';

import { AddReferenceForm } from './add-reference-form';

export const dynamic = 'force-dynamic';

/**
 * Files and links, across every topic.
 *
 * These are references: a path, a repository, a URL. ContextShelf stores where
 * something lives and what work it belongs to, and it does not hold a copy.
 *
 * Uploads are absent rather than stubbed. `file_references.kind` already has an
 * `upload` value and a `storage_path` column waiting for a real object store,
 * but an upload control that stored a filename and no file would be a UI
 * claiming something the system cannot do (rule 13) — and rule 14 says an
 * unbuilt feature names the phase it lands in, which the note at the bottom
 * does.
 */
export default async function FilesPage() {
  const data = await getData();
  const workspace = await data.workspaces.getDefault();

  if (!workspace) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:py-8">
        <h1 className="text-xl font-semibold tracking-tight">Files</h1>
        <p className="mt-2 text-sm muted">No workspace available.</p>
      </div>
    );
  }

  const [files, topicSummaries] = await Promise.all([
    data.files.listForWorkspace(workspace.id),
    data.topics.list(workspace.id),
  ]);
  const topics = topicSummaries.map((t) => t.topic);
  const subtopicsByTopic: Record<string, { id: string; name: string }[]> = {};
  for (const t of topics) {
    subtopicsByTopic[t.id] = (await data.subtopics.listForTopic(t.id)).map((s) => ({
      id: s.id,
      name: s.name,
    }));
  }

  const repoFiles = files.filter((f) => f.kind === 'repo_file');
  const links = files.filter((f) => f.kind === 'url');
  const uploads = files.filter((f) => f.kind === 'upload');

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:py-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Files</h1>
        <p className="mt-1 text-sm muted">
          Where the work lives. Each of these points at a file or a page — ContextShelf records the
          reference and what it belongs to, never a copy of the contents.
        </p>
      </header>

      <div className="mt-5">
        <AddReferenceForm topics={topics} subtopicsByTopic={subtopicsByTopic} />
      </div>

      {files.length === 0 ? (
        <div className="mt-6 rounded-lg p-6 surface">
          <p className="text-sm font-medium">Nothing referenced yet.</p>
          <p className="mt-1.5 text-sm leading-6 muted">
            Add the files a topic keeps coming back to, or the pages you keep looking up. They
            become part of what a fresh Claude session is told about the work.
          </p>
        </div>
      ) : (
        <>
          <FileSection
            title="Repository files"
            icon={<FileCode className="size-4 muted" aria-hidden />}
            files={repoFiles}
            topics={topics}
          />
          <FileSection
            title="Links"
            icon={<Link2 className="size-4 muted" aria-hidden />}
            files={links}
            topics={topics}
          />
          {uploads.length > 0 && (
            <FileSection title="Uploads" files={uploads} topics={topics} />
          )}
        </>
      )}

      <p className="mt-8 text-xs leading-5 muted">
        Uploading a file so ContextShelf stores the bytes is not built. It needs an object store and
        its own access rules, and it lands in Phase 5 alongside the Claude Code ingestion endpoint.
        Until then a reference is what is offered, because it is what is real.
      </p>
    </div>
  );
}

function FileSection({
  title,
  icon,
  files,
  topics,
}: {
  title: string;
  icon?: React.ReactNode;
  files: FileReference[];
  topics: Topic[];
}) {
  if (files.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider muted">
        {icon}
        {title} · {files.length}
      </h2>
      <ul className="mt-2 space-y-2">
        {files.map((file) => {
          const topic = topics.find((t) => t.id === file.topicId);
          const label = file.displayName ?? file.path ?? file.url ?? 'Untitled';
          return (
            <li key={file.id} className="relative overflow-hidden rounded-lg p-4 surface">
              <span className="absolute inset-y-0 left-0 w-1 bg-slate-400" aria-hidden />
              <div className="pl-2">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h3 className="text-sm font-medium break-all">
                    {file.url ? (
                      <a
                        href={file.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        {label}
                        <ExternalLink className="size-3.5 shrink-0 muted" aria-hidden />
                      </a>
                    ) : (
                      label
                    )}
                  </h3>
                  {topic && (
                    <Link
                      href={`/topics/${topic.id}`}
                      className="inline-flex min-h-11 items-center text-xs muted hover:underline"
                    >
                      {topic.name}
                    </Link>
                  )}
                  <time className="ml-auto text-xs tabular-nums muted" dateTime={file.createdAt}>
                    {formatDate(file.createdAt)}
                  </time>
                </div>

                {file.path && file.displayName && (
                  <p className="mt-1 font-mono text-xs break-all muted">{file.path}</p>
                )}
                {(file.repoUrl || file.branch) && (
                  <p className="mt-1 text-xs break-all muted">
                    {file.repoUrl}
                    {file.branch ? ` · ${file.branch}` : ''}
                    {file.commitSha ? ` · ${file.commitSha.slice(0, 8)}` : ''}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
