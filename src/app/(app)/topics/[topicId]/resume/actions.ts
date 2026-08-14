'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getData } from '@/lib/data';
import { CONTEXT_DENSITIES, RESUME_TARGETS } from '@/lib/domain/types';
import { toUserFacingError } from '@/lib/errors';
import { assembleResumeContext } from '@/lib/resume/assemble';
import { formatResume } from '@/lib/resume/format';
import { reductionSuggestions } from '@/lib/resume/size';
import type { ResumeContext } from '@/lib/resume/types';

export interface FormState {
  error: string | null;
  message?: string | null;
}

/**
 * Everything the preview needs to render one generated Resume.
 *
 * Assembled fresh on every call from the authoritative records. Nothing here is
 * read back from `context_snapshots` — a past export is an audit record of what
 * was handed to Claude, never evidence about what is true now.
 */
export interface GeneratedResume {
  markdown: string;
  size: {
    characters: number;
    words: number;
    approxTokens: number;
    band: string;
    bySection: Array<{ section: string; characters: number; share: number }>;
  };
  suggestions: string[];
  freshness: ResumeContext['freshness'];
  conflicts: ResumeContext['conflicts'];
  sectionsIncluded: string[];
  sectionsOmitted: string[];
  truncations: ResumeContext['truncations'];
  recordIds: string[];
  topicName: string;
  subtopicName: string | null;
}

const generateSchema = z.object({
  topicId: z.string().uuid(),
  subtopicId: z.string().uuid().nullable().optional(),
  target: z.enum(RESUME_TARGETS),
  density: z.enum(CONTEXT_DENSITIES),
  excludeSections: z.array(z.string().max(60)).max(30).optional(),
});

/**
 * Generates a Resume without writing anything.
 *
 * Reads once through `getContext`, which batches every record type in parallel,
 * and once more for the relationship edges when the density warrants them. No
 * query is issued per record, and none is issued per section.
 */
export async function generateResume(input: {
  topicId: string;
  subtopicId?: string | null;
  target: (typeof RESUME_TARGETS)[number];
  density: (typeof CONTEXT_DENSITIES)[number];
  excludeSections?: string[];
}): Promise<{ ok: true; resume: GeneratedResume } | { ok: false; error: string }> {
  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'That is not a resume this app can generate.' };

  const data = await getData();
  try {
    const ctx = await data.topics.getContext(parsed.data.topicId);
    if (!ctx) return { ok: false, error: 'That topic is no longer available.' };

    // Relationship traversal, bounded (4M). Depth 1 by default; Full Audit
    // takes one more hop, and only from the records the first hop returned.
    // A visited set makes a cycle terminate, and the whole thing is skipped for
    // a topic-wide resume, where nothing is being scoped out in the first place.
    let relatedIds: Set<string> | undefined;
    if (parsed.data.subtopicId) {
      relatedIds = await collectRelated(
        data,
        parsed.data.subtopicId,
        parsed.data.density === 'full_audit' ? 2 : 1,
      );
    }

    const resumeContext = assembleResumeContext(
      {
        topic: ctx.topic,
        subtopics: ctx.subtopics,
        entries: ctx.timeline,
        decisions: [...ctx.activeDecisions, ...ctx.supersededDecisions],
        ideas: ctx.rejectedIdeas,
        actions: ctx.openActions,
        files: ctx.files,
        sessions: ctx.sessions,
        milestones: ctx.milestones,
        prompts: ctx.winningPrompts,
        relatedIds,
      },
      {
        target: parsed.data.target,
        density: parsed.data.density,
        subtopicId: parsed.data.subtopicId ?? null,
        now: new Date().toISOString(),
        excludeSections: parsed.data.excludeSections,
      },
    );

    const formatted = formatResume(resumeContext);

    return {
      ok: true,
      resume: {
        markdown: formatted.markdown,
        size: formatted.size,
        suggestions: reductionSuggestions(formatted.size, parsed.data.density),
        freshness: resumeContext.freshness,
        conflicts: resumeContext.conflicts,
        sectionsIncluded: resumeContext.sectionsIncluded,
        sectionsOmitted: resumeContext.sectionsOmitted,
        truncations: resumeContext.truncations,
        recordIds: collectRecordIds(resumeContext),
        topicName: resumeContext.scope.topic.name,
        subtopicName: resumeContext.scope.subtopic?.name ?? null,
      },
    };
  } catch (cause) {
    return { ok: false, error: toUserFacingError(cause).message };
  }
}

/**
 * Ids reachable from the scope through `relationships`, to a bounded depth.
 *
 * One query per level, never one per record — the repository resolves a whole
 * frontier at a time. `seen` prevents both cycles and repeat work, so a densely
 * linked topic costs the same as a sparse one.
 */
async function collectRelated(
  data: Awaited<ReturnType<typeof getData>>,
  subtopicId: string,
  maxDepth: number,
): Promise<Set<string>> {
  const seen = new Set<string>([subtopicId]);
  let frontier: Array<{ type: 'subtopic' | 'knowledge_entry' | 'decision' | 'idea' | 'prompt'; id: string }> = [
    { type: 'subtopic', id: subtopicId },
  ];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const next: typeof frontier = [];
    for (const node of frontier.slice(0, 25)) {
      const edges = await data.relationships.listFor(node.type, node.id);
      for (const edge of edges) {
        if (seen.has(edge.entityId)) continue;
        seen.add(edge.entityId);
        if (
          edge.entityType === 'knowledge_entry' ||
          edge.entityType === 'decision' ||
          edge.entityType === 'idea' ||
          edge.entityType === 'prompt'
        ) {
          next.push({ type: edge.entityType, id: edge.entityId });
        }
      }
    }
    frontier = next;
  }

  seen.delete(subtopicId);
  return seen;
}

/** Exactly which records went into this export, for the audit record. */
function collectRecordIds(ctx: ResumeContext): string[] {
  return [
    ...ctx.activeDecisions.map((d) => d.id),
    ...ctx.historicalDecisions.map((d) => d.id),
    ...ctx.requirements.map((e) => e.id),
    ...ctx.constraints.map((e) => e.id),
    ...ctx.completedWork.map((e) => e.id),
    ...ctx.recentChanges.map((c) => c.id),
    ...ctx.winningPrompts.map((p) => p.versionId),
    ...ctx.blockers.map((a) => a.id),
    ...ctx.openQuestions.map((a) => a.id),
    ...ctx.references.map((r) => r.id),
    ...(ctx.nextAction.primary ? [ctx.nextAction.primary.id] : []),
  ];
}

const recordSchema = generateSchema.extend({
  markdown: z.string().min(1).max(1_000_000),
  characters: z.number().int().nonnegative(),
  words: z.number().int().nonnegative(),
  approxTokens: z.number().int().nonnegative(),
  sections: z.array(z.string().max(60)).max(40),
  recordIds: z.array(z.string().uuid()).max(2000),
  freshness: z.string().max(40),
  conflicts: z.number().int().nonnegative(),
  label: z.string().trim().max(120).optional(),
});

/**
 * Records what was exported.
 *
 * Called after a copy, not before — the audit trail should say what was
 * actually taken to Claude, not what happened to be previewed. Failing to
 * record is reported but does not lose the user their copied text, which is
 * the part they came for.
 */
export async function recordResumeExport(input: unknown): Promise<FormState> {
  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) return { error: 'That export could not be recorded.' };

  const data = await getData();
  try {
    const topic = await data.topics.getById(parsed.data.topicId);
    if (!topic) return { error: 'That topic is no longer available.' };

    await data.resumeHistory.record({
      workspaceId: topic.workspaceId,
      topicId: parsed.data.topicId,
      subtopicId: parsed.data.subtopicId ?? null,
      target: parsed.data.target,
      density: parsed.data.density,
      body: parsed.data.markdown,
      meta: {
        characters: parsed.data.characters,
        words: parsed.data.words,
        approxTokens: parsed.data.approxTokens,
        sections: parsed.data.sections,
        recordIds: parsed.data.recordIds,
        freshness: parsed.data.freshness,
        conflicts: parsed.data.conflicts,
        label: parsed.data.label ?? null,
      },
    });
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }

  revalidatePath(`/topics/${parsed.data.topicId}`);
  return { error: null, message: 'Recorded in this topic’s resume history.' };
}

const deleteSchema = z.object({ id: z.string().uuid(), topicId: z.string().uuid() });

export async function deleteResumeExportAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = deleteSchema.safeParse({
    id: formData.get('id'),
    topicId: formData.get('topicId'),
  });
  if (!parsed.success) return { error: 'That export could not be identified.' };

  const data = await getData();
  try {
    // Hard delete, and correct: a snapshot is derived and regenerable (AD-8),
    // and removing one changes no authoritative record.
    await data.resumeHistory.remove(parsed.data.id);
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }
  revalidatePath(`/topics/${parsed.data.topicId}`);
  return { error: null };
}
