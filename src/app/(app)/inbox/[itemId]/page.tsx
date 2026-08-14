import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { SourceBadge } from '@/components/ui/badges';
import { getData } from '@/lib/data';
import { INGESTION_STATUS_LABELS } from '@/lib/domain/types';
import { suggestKnowledgeType, suggestTopic } from '@/lib/ingestion/classify';
import { extractCandidates, extractSegments } from '@/lib/ingestion/extract';
import { assessSource, findSecrets, secretWarning } from '@/lib/extraction/prepare';
import { defaultProvider, providerById } from '@/lib/extraction/providers';
import { formatDate } from '@/lib/utils';

import { AnalyzePanel } from './analyze-panel';
import { TriageForm, type TriageSegment } from './triage-form';

export const dynamic = 'force-dynamic';

/**
 * Triage — where a captured item becomes knowledge.
 *
 * Extraction runs here rather than at capture, because it needs the whole
 * document and the user's attention at the same time. Path A reads the
 * structure the author wrote; Path B offers suggestions for the rest. Both are
 * shown, labelled differently, and only what the user confirms is written.
 *
 * Duplicate proposals are computed before anything is written, using the same
 * fingerprint the database generates, so a re-paste is caught at the moment it
 * would otherwise become a second copy (rule 17).
 */
export default async function TriagePage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const data = await getData();

  const item = await data.inbox.getById(itemId);
  if (!item) notFound();

  // The saved review, if there is one. Reading it here is what makes a review
  // survive a closed tab (6AB) — the workspace below is rendered from rows,
  // not from anything held in the browser.
  const runs = await data.extraction.listRunsForRecord(item.id);
  const latestRun = runs[0] ?? null;
  const runSuggestions = latestRun ? await data.extraction.listSuggestions(latestRun.id) : [];

  const provider = defaultProvider();
  const modelProvider = providerById('anthropic');
  const assessment = assessSource(item.rawContent ?? '');
  const secretsMessage = secretWarning(findSecrets(item.rawContent ?? ''));

  const workspace = await data.workspaces.getDefault();
  const topics = workspace ? (await data.topics.list(workspace.id)).map((t) => t.topic) : [];
  const subtopicsByTopic: Record<string, { id: string; name: string }[]> = {};
  for (const t of topics) {
    subtopicsByTopic[t.id] = (await data.subtopics.listForTopic(t.id)).map((s) => ({
      id: s.id,
      name: s.name,
    }));
  }

  const raw = item.rawContent ?? '';

  // Path A: only what the text states. Path B: everything else, as proposals.
  const extracted = extractSegments(raw);
  const candidates = extractCandidates(raw);
  const topicSuggestion = topics.length > 0 ? suggestTopic(raw, topics) : null;

  const segments: TriageSegment[] = [
    ...extracted.segments.map((s, i) => ({
      key: `stated-${i}`,
      origin: 'stated' as const,
      knowledgeType: s.knowledgeType,
      title: s.title,
      content: s.content,
      sourceReference: s.sourceReference,
    })),
    ...candidates.map((c, i) => {
      const suggestion = suggestKnowledgeType(`${c.title} ${c.content ?? ''}`);
      return {
        key: `candidate-${i}`,
        origin: 'suggested' as const,
        knowledgeType: suggestion?.value ?? null,
        title: c.title,
        content: c.content,
        sourceReference: c.sourceReference,
        basis: suggestion?.basis,
        confidence: suggestion?.confidence,
      };
    }),
  ];

  // A whole-document fallback, so an unsplittable paste is still filable as
  // one entry the user types — chosen deliberately, never applied by default.
  if (segments.length === 0 && raw.trim()) {
    const suggestion = suggestKnowledgeType(raw);
    segments.push({
      key: 'whole',
      origin: 'suggested',
      knowledgeType: suggestion?.value ?? null,
      title: raw.replace(/\s+/g, ' ').trim().slice(0, 110),
      content: raw,
      sourceReference: null,
      basis: suggestion?.basis ?? ['the whole capture, kept as one entry'],
      confidence: suggestion?.confidence,
    });
  }

  const duplicates = workspace
    ? await data.proposals.duplicateSources({ workspaceId: workspace.id, raw })
    : [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:py-8">
      <Link
        href="/inbox"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm muted hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Inbox
      </Link>

      <header className="mt-2">
        <h1 className="text-xl font-semibold tracking-tight break-words">
          {item.sourceHint || 'Captured item'}
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium muted ring-1 ring-inset hairline">
            {INGESTION_STATUS_LABELS[item.status]}
          </span>
          <SourceBadge source={item.sourceType} />
          <time className="text-xs tabular-nums muted" dateTime={item.createdAt}>
            Captured {formatDate(item.createdAt)}
          </time>
        </div>
      </header>

      {duplicates.length > 0 && (
        <section className="mt-5 rounded-lg p-4 ring-1 ring-inset ring-amber-600/30">
          <h2 className="text-sm font-medium text-amber-800 dark:text-amber-300">
            This may already be here
          </h2>
          <p className="mt-1 text-xs leading-5 muted">
            Nothing has been merged or changed. Choosing what to do with these is yours.
          </p>
          <ul className="mt-2 space-y-1.5">
            {duplicates.map((d) => (
              <li key={d.candidateId} className="text-sm leading-6 break-words">
                {/*
                  A block target rather than a word inside a sentence. It reads
                  as prose but it is the only way to reach the existing record,
                  so on a phone it has to be reachable with a thumb.
                */}
                <Link
                  href={`/sources/${d.candidateId}`}
                  className="inline-flex min-h-11 items-center font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  {d.candidateTitle}
                </Link>
                <span className="block text-xs leading-5 muted">{d.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-5">
        <h2 className="text-xs font-medium uppercase tracking-wider muted">What was captured</h2>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg p-4 text-xs leading-6 surface">
          {raw || 'No content.'}
        </pre>
        <p className="mt-1.5 text-xs muted">
          Kept exactly as it arrived. Filing this stores it as the source everything below points
          back to.
        </p>
      </section>

      {/*
        Analysis sits ABOVE manual triage, and manual triage stays exactly where
        it was. If no provider is ever configured — or if a run fails — the
        Phase 3 path below is untouched and complete (6C).
      */}
      <AnalyzePanel
        itemId={item.id}
        topicId={item.topicId ?? topicSuggestion?.value.id ?? null}
        subtopicId={item.subtopicId}
        topics={topics.map((t) => ({ id: t.id, name: t.name }))}
        providerLabel={provider.label}
        providerIsModel={provider.id !== 'deterministic'}
        providerProblem={modelProvider?.configurationProblem() ?? null}
        sizeMessage={assessment.message}
        secretWarning={secretsMessage}
        tooLarge={assessment.tooLarge}
        existingRun={
          latestRun
            ? {
                id: latestRun.id,
                suggestions: runSuggestions,
                warnings: latestRun.warnings,
                chunkCount: latestRun.chunkCount,
                status: latestRun.status,
                failureDetail: latestRun.failureDetail,
              }
            : null
        }
      />

      <div className="mt-6">
        <TriageForm
          itemId={item.id}
          defaultTitle={item.sourceHint ?? ''}
          segments={segments}
          topics={topics}
          subtopicsByTopic={subtopicsByTopic}
          suggestedTopicId={topicSuggestion?.value.id ?? null}
          suggestedTopicBasis={topicSuggestion?.basis ?? []}
          suggestedTopicConfidence={topicSuggestion?.confidence}
          extractionNotes={extracted.notes}
        />
      </div>
    </div>
  );
}
