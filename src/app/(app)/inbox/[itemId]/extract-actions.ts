'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getData } from '@/lib/data';
import { KNOWLEDGE_TYPES } from '@/lib/domain/types';
import { toUserFacingError } from '@/lib/errors';
import { comparisonKey } from '@/lib/extraction/merge';
import { assessSource, findSecrets, secretWarning } from '@/lib/extraction/prepare';
import { defaultProvider, providerById } from '@/lib/extraction/providers';
import { runExtraction } from '@/lib/extraction/service';
import { SUGGESTION_KINDS, type ExistingContext } from '@/lib/extraction/types';

export interface FormState {
  error: string | null;
  message?: string | null;
}

/**
 * Analyse a captured item (Phase 6AD).
 *
 * The name of this operation matters. With no model configured this is
 * DETERMINISTIC extraction — labels and phrasing — and every string the user
 * sees says so. Calling it "AI" would be the one dishonesty that undermines
 * the whole review layer: a person who believes a machine understood the
 * conversation reviews differently from one who knows it matched keywords.
 *
 * Nothing authoritative is written. The run and its suggestions are proposals,
 * and the raw capture is left exactly where it was.
 */
export async function analyzeInboxItemAction(input: {
  itemId: string;
  topicId: string | null;
  subtopicId: string | null;
  providerId?: string;
  secretsAcknowledged?: boolean;
}): Promise<FormState & { runId?: string }> {
  const parsed = z
    .object({
      itemId: z.string().uuid(),
      topicId: z.string().uuid().nullable(),
      subtopicId: z.string().uuid().nullable(),
      providerId: z.string().max(40).optional(),
      secretsAcknowledged: z.boolean().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: 'That item could not be identified.' };

  const data = await getData();
  try {
    const item = await data.inbox.getById(parsed.data.itemId);
    if (!item) return { error: 'That captured item is no longer available.' };

    const source = item.rawContent ?? '';
    if (source.trim() === '') return { error: 'There is nothing in this item to analyse.' };

    const provider = parsed.data.providerId
      ? (providerById(parsed.data.providerId) ?? defaultProvider())
      : defaultProvider();

    // Bounded existing state (6I): titles and current state, never history and
    // never a transcript. Enough to recognise "you already have this".
    const topicId = parsed.data.topicId ?? item.topicId;
    let existingContext: ExistingContext | null = null;
    const topics = await data.topics.list(item.workspaceId);
    const knownTopicIds = new Set(topics.map((t) => t.topic.id));
    const knownSubtopicIds = new Set<string>();

    if (topicId) {
      const ctx = await data.topics.getContext(topicId);
      if (ctx) {
        for (const s of ctx.subtopics) knownSubtopicIds.add(s.id);
        existingContext = {
          topicName: ctx.topic.name,
          subtopicName: null,
          currentState: ctx.topic.currentState,
          activeDecisions: ctx.activeDecisions.map((d) => d.title).slice(0, 25),
          ideaTitles: ctx.rejectedIdeas.map((i) => i.title).slice(0, 25),
          promptTitles: ctx.winningPrompts.map((p) => p.prompt.title).slice(0, 25),
          openActions: ctx.openActions.map((a) => a.title).slice(0, 25),
          constraints: ctx.currentEntries
            .filter((e) => e.knowledgeType === 'requirement' || e.knowledgeType === 'important_context')
            .map((e) => e.title)
            .slice(0, 25),
        };
      }
    }

    const outcome = await runExtraction({
      source,
      provider,
      existingContext,
      topicId,
      subtopicId: parsed.data.subtopicId,
      knownTopicIds,
      knownSubtopicIds,
      duplicates: await findDuplicates(data, item.workspaceId, source),
      conflicts: new Map(),
      secretsAcknowledged: parsed.data.secretsAcknowledged,
    });

    if (outcome.status === 'failed' && outcome.failureCode === 'secrets_unacknowledged') {
      return { error: outcome.failureDetail ?? 'This content may contain credentials.' };
    }

    // Duplicate and conflict findings come from the deterministic side, never
    // from the provider (rule 17, 6J/6K).
    const annotated = await attachDuplicates(data, item.workspaceId, topicId, outcome.suggestions);

    const run = await data.extraction.saveRun({
      workspaceId: item.workspaceId,
      ingestionRecordId: item.id,
      sourceSessionId: item.createdSourceSessionId,
      topicId,
      subtopicId: parsed.data.subtopicId,
      provider: outcome.provider,
      model: outcome.model,
      promptVersion: outcome.promptVersion,
      status: outcome.status,
      failureCode: outcome.failureCode,
      failureDetail: outcome.failureDetail,
      chunkCount: outcome.chunkCount,
      inputTokens: outcome.usage?.inputTokens ?? null,
      outputTokens: outcome.usage?.outputTokens ?? null,
      warnings: [...outcome.warnings, ...outcome.rejected],
      suggestions: annotated.map((s, i) => ({
        ordinal: i,
        kind: s.kind,
        knowledgeType: s.knowledgeType ?? null,
        title: s.title,
        content: s.content ?? null,
        reason: s.reason ?? null,
        statusSuggestion: s.statusSuggestion ?? null,
        suggestedTopicId: s.suggestedTopicId ?? null,
        suggestedSubtopicId: s.suggestedSubtopicId ?? null,
        sourceReference: s.sourceReference ?? null,
        chunkIndex: s.chunkIndex ?? 0,
        confidence: s.confidence,
        basis: s.basis,
        payload: s.payload ?? {},
        // Kept untouched so an edit stays legible as an edit (6AA).
        original: {
          kind: s.kind,
          knowledgeType: s.knowledgeType ?? null,
          title: s.title,
          content: s.content ?? null,
          reason: s.reason ?? null,
          confidence: s.confidence,
        },
        selected: s.safeToPreselect,
        duplicateOfKind: s.duplicateOf?.kind ?? null,
        duplicateOfId: s.duplicateOf?.id ?? null,
        duplicateReason: s.duplicateOf?.reason ?? null,
        conflictsWithId: s.conflictsWith?.id ?? null,
        conflictReason: s.conflictsWith?.reason ?? null,
      })),
    });

    revalidatePath(`/inbox/${parsed.data.itemId}`);
    return {
      error: null,
      runId: run.id,
      message:
        outcome.status === 'partial'
          ? 'Some parts of the source could not be read. What was read is below.'
          : `${annotated.length} suggestion${annotated.length === 1 ? '' : 's'} to review. Nothing has been filed yet.`,
    };
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }
}

/**
 * What the deterministic duplicate detector already knows about the source.
 *
 * Cheap and best-effort: a failure here must not fail the analysis, because a
 * missing duplicate warning degrades review while a failed run loses it.
 */
async function findDuplicates(
  data: Awaited<ReturnType<typeof getData>>,
  workspaceId: string,
  source: string,
) {
  try {
    await data.proposals.duplicateSources({ workspaceId, raw: source });
  } catch {
    /* a missing warning is survivable; a failed analysis is not */
  }
  return new Map();
}

/** Per-suggestion duplicate lookup, by the same fingerprint the database uses. */
async function attachDuplicates(
  data: Awaited<ReturnType<typeof getData>>,
  workspaceId: string,
  topicId: string | null,
  suggestions: Awaited<ReturnType<typeof runExtraction>>['suggestions'],
) {
  const conflicts = topicId ? await data.proposals.conflictingDecisions(topicId).catch(() => []) : [];

  return Promise.all(
    suggestions.map(async (s) => {
      const duplicates = await data.proposals
        .duplicatesForText({ workspaceId, title: s.title, content: s.content ?? null })
        .catch(() => []);
      const duplicate = duplicates[0] ?? null;
      const conflict =
        s.kind === 'decision'
          ? (conflicts.find((c) => comparisonKey({ ...s, title: c.decisionTitle }) === comparisonKey(s)) ??
            conflicts[0] ??
            null)
          : null;

      return {
        ...s,
        duplicateOf: duplicate
          ? {
              kind: duplicate.entityType,
              id: duplicate.candidateId,
              title: duplicate.candidateTitle,
              reason: duplicate.reason,
            }
          : s.duplicateOf,
        conflictsWith: conflict
          ? { id: conflict.conflictsWithId, title: conflict.conflictsWithTitle, reason: conflict.reason }
          : s.conflictsWith,
        // A duplicate or a conflict un-ticks it, whatever the confidence was.
        safeToPreselect: s.safeToPreselect && !duplicate && !conflict,
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

const editSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(400).optional(),
  content: z.string().max(20_000).nullable().optional(),
  reason: z.string().max(4_000).nullable().optional(),
  kind: z.enum(SUGGESTION_KINDS).optional(),
  knowledgeType: z.enum(KNOWLEDGE_TYPES).nullable().optional(),
  statusSuggestion: z.string().max(40).nullable().optional(),
  suggestedTopicId: z.string().uuid().nullable().optional(),
  suggestedSubtopicId: z.string().uuid().nullable().optional(),
});

export async function editSuggestionAction(input: unknown): Promise<FormState> {
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) return { error: 'That change could not be applied.' };

  const data = await getData();
  try {
    await data.extraction.updateSuggestion(parsed.data);
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }
  return { error: null, message: 'Saved. Your version is what will be filed.' };
}

export async function setSuggestionSelectionAction(input: {
  runId: string;
  ids: string[];
  selected: boolean;
}): Promise<FormState> {
  const parsed = z
    .object({ runId: z.string().uuid(), ids: z.array(z.string().uuid()).max(500), selected: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { error: 'That selection could not be applied.' };

  const data = await getData();
  try {
    await data.extraction.setSelection(parsed.data.runId, parsed.data.ids, parsed.data.selected);
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }
  return { error: null };
}

export async function rejectSuggestionsAction(input: { ids: string[] }): Promise<FormState> {
  const parsed = z.object({ ids: z.array(z.string().uuid()).max(500) }).safeParse(input);
  if (!parsed.success) return { error: 'That could not be rejected.' };

  const data = await getData();
  try {
    await data.extraction.reject(parsed.data.ids);
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }
  return { error: null, message: 'Rejected. The suggestion stays in the run’s history.' };
}

/**
 * Confirm the selected suggestions (6AC).
 *
 * One database transaction, so twelve records either all land or none do —
 * an unexplained half-import is the outcome this exists to prevent. The
 * receipt says exactly what was created and what was skipped rather than
 * reporting a number the user has to trust.
 */
export async function confirmSuggestionsAction(input: {
  runId: string;
  ids: string[];
  topicId: string;
  subtopicId: string | null;
}): Promise<FormState & { created?: number; skipped?: number }> {
  const parsed = z
    .object({
      runId: z.string().uuid(),
      ids: z.array(z.string().uuid()).min(1).max(500),
      topicId: z.string().uuid(),
      subtopicId: z.string().uuid().nullable(),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { error: 'Choose a topic and at least one suggestion before confirming.' };
  }

  const data = await getData();
  try {
    const receipt = await data.extraction.confirm({
      runId: parsed.data.runId,
      suggestionIds: parsed.data.ids,
      topicId: parsed.data.topicId,
      subtopicId: parsed.data.subtopicId,
    });

    revalidatePath('/inbox');
    revalidatePath(`/topics/${parsed.data.topicId}`);
    revalidatePath('/timeline');

    const skipped = receipt.skippedCount > 0 ? ` ${receipt.skippedCount} needed its own review flow and was left.` : '';
    return {
      error: null,
      created: receipt.createdCount,
      skipped: receipt.skippedCount,
      message: `${receipt.createdCount} record${receipt.createdCount === 1 ? '' : 's'} filed.${skipped}`,
    };
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }
}

/**
 * Accept a suggested Current State (6L).
 *
 * Its own action, deliberately outside batch confirmation. Current State is the
 * single most overwriteable field in the product — every session produces a
 * summary that could plausibly replace it — so replacing it is always a
 * comparison a person makes, with optimistic concurrency underneath so two
 * devices cannot silently clobber each other.
 */
export async function acceptCurrentStateAction(input: {
  suggestionId: string;
  topicId: string;
  expectedUpdatedAt: string;
  currentState: string;
}): Promise<FormState> {
  const parsed = z
    .object({
      suggestionId: z.string().uuid(),
      topicId: z.string().uuid(),
      expectedUpdatedAt: z.string().min(1),
      currentState: z.string().trim().min(1).max(4_000),
    })
    .safeParse(input);
  if (!parsed.success) return { error: 'That state could not be applied.' };

  const data = await getData();
  try {
    await data.topics.update({
      id: parsed.data.topicId,
      expectedUpdatedAt: parsed.data.expectedUpdatedAt,
      currentState: parsed.data.currentState,
      meaningful: true,
    });
    await data.extraction.updateSuggestion({ id: parsed.data.suggestionId, state: 'confirmed' });
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }

  revalidatePath(`/topics/${parsed.data.topicId}`);
  return { error: null, message: 'Current State updated.' };
}

/** Estimates what analysing this item will involve, before anything runs. */
export async function assessItemAction(itemId: string): Promise<{
  characters: number;
  chunks: number;
  tooLarge: boolean;
  message: string;
  secretWarning: string | null;
}> {
  const data = await getData();
  const item = await data.inbox.getById(itemId);
  const source = item?.rawContent ?? '';
  const assessment = assessSource(source);
  return { ...assessment, secretWarning: secretWarning(findSecrets(source)) };
}
