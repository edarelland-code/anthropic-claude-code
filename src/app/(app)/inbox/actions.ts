'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { getData } from '@/lib/data';
import { INGESTION_STATUSES, KNOWLEDGE_TYPES, SOURCE_TYPES } from '@/lib/domain/types';
import { toUserFacingError } from '@/lib/errors';
import { detectAdapter, normalize } from '@/lib/ingestion/adapters';
import { normaliseNewlines } from '@/lib/forms';

export interface FormState {
  error: string | null;
  /** Set on success so the form can confirm without navigating away. */
  message?: string | null;
}

/**
 * Quick Capture.
 *
 * CLARIFICATION 2, enforced by the schema below: `content` is the only required
 * field. There is no topic, subtopic, knowledge type, source, tag or
 * classification to supply, because the whole point of the Inbox is that
 * capture does not interrupt whatever the user was doing in Claude. Everything
 * else is an optional enhancement, filled in later during triage.
 *
 * The adapter is detected only to record HOW the text arrived; detection never
 * extracts here, so a pasted "Decision: …" is stored verbatim and stays
 * unfiled until someone decides.
 */
const captureSchema = z.object({
  content: z.string().trim().min(1, 'There is nothing to capture yet.').max(500_000),
  sourceHint: z.string().trim().max(200).optional(),
});

export async function captureAction(_prev: FormState, formData: FormData): Promise<FormState> {
  normaliseNewlines(formData);
  const parsed = captureSchema.safeParse({
    content: formData.get('content'),
    sourceHint: formData.get('sourceHint') || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  const data = await getData();
  const workspace = await data.workspaces.getDefault();
  if (!workspace) return { error: 'No workspace available.' };

  const adapter = detectAdapter(parsed.data.content);

  try {
    await data.inbox.capture({
      workspaceId: workspace.id,
      rawContent: parsed.data.content,
      adapterId: adapter.id,
      sourceType: adapter.sourceType,
      sourceHint: parsed.data.sourceHint ?? null,
    });
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }

  revalidatePath('/inbox');
  revalidatePath('/home');
  return { error: null, message: 'Saved to your Inbox. File it whenever you like.' };
}

/**
 * A confirmed segment.
 *
 * `knowledgeType` is required and must be a real type. A suggestion cannot
 * reach this action: the triage UI resolves every suggestion to a chosen value
 * before submitting, so nothing heuristic is ever written (clarification 4).
 */
const segmentSchema = z.object({
  knowledgeType: z.enum(KNOWLEDGE_TYPES),
  title: z.string().trim().min(1).max(300),
  content: z.string().max(100_000).nullish(),
  sourceReference: z.string().max(200).nullish(),
  confidence: z.number().min(0).max(1).nullish(),
});

const processSchema = z.object({
  id: z.string().uuid(),
  topicId: z.string().uuid('Choose a topic before filing this.'),
  subtopicId: z.string().uuid().nullable().optional(),
  title: z.string().trim().max(300).optional(),
  segments: z.string(),
});

export async function processAction(_prev: FormState, formData: FormData): Promise<FormState> {
  normaliseNewlines(formData);
  const parsed = processSchema.safeParse({
    id: formData.get('id'),
    topicId: formData.get('topicId'),
    subtopicId: formData.get('subtopicId') || null,
    title: formData.get('title') || undefined,
    segments: formData.get('segments'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  let segments: z.infer<typeof segmentSchema>[];
  try {
    segments = z.array(segmentSchema).parse(JSON.parse(parsed.data.segments));
  } catch {
    return { error: 'The entries could not be read. Reload the page and try again.' };
  }
  if (segments.length === 0) {
    return { error: 'Confirm at least one entry, or archive the item instead.' };
  }

  const data = await getData();
  try {
    await data.inbox.process({
      id: parsed.data.id,
      topicId: parsed.data.topicId,
      subtopicId: parsed.data.subtopicId ?? null,
      title: parsed.data.title ?? null,
      segments: segments.map((s) => ({
        knowledgeType: s.knowledgeType,
        title: s.title,
        content: s.content ?? null,
        sourceReference: s.sourceReference ?? null,
        confidence: s.confidence ?? null,
      })),
    });
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }

  revalidatePath('/inbox');
  revalidatePath('/timeline');
  revalidatePath(`/topics/${parsed.data.topicId}`);
  redirect(`/topics/${parsed.data.topicId}`);
}

/**
 * Imports a paste directly, without an Inbox round trip.
 *
 * The segments still arrive confirmed — the preview screen showed them and the
 * user pressed Import — so this action does no extraction of its own.
 */
const importSchema = z.object({
  adapterId: z.string().trim().min(1).max(60),
  sourceType: z.enum(SOURCE_TYPES),
  raw: z.string().trim().min(1, 'There is nothing to import.').max(500_000),
  title: z.string().trim().max(300).optional(),
  occurredAt: z.string().trim().max(40).optional(),
  externalUrl: z.string().trim().max(2000).optional(),
  topicId: z.string().uuid('Choose a topic to import into.'),
  subtopicId: z.string().uuid().nullable().optional(),
  segments: z.string(),
});

export async function importAction(_prev: FormState, formData: FormData): Promise<FormState> {
  normaliseNewlines(formData);
  const parsed = importSchema.safeParse({
    adapterId: formData.get('adapterId'),
    sourceType: formData.get('sourceType'),
    raw: formData.get('raw'),
    title: formData.get('title') || undefined,
    occurredAt: formData.get('occurredAt') || undefined,
    externalUrl: formData.get('externalUrl') || undefined,
    topicId: formData.get('topicId'),
    subtopicId: formData.get('subtopicId') || null,
    segments: formData.get('segments'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  let segments: z.infer<typeof segmentSchema>[];
  try {
    segments = z.array(segmentSchema).parse(JSON.parse(parsed.data.segments));
  } catch {
    return { error: 'The entries could not be read. Preview the import again.' };
  }

  const data = await getData();
  const workspace = await data.workspaces.getDefault();
  if (!workspace) return { error: 'No workspace available.' };

  try {
    await data.inbox.ingest({
      workspaceId: workspace.id,
      adapterId: parsed.data.adapterId,
      sourceType: parsed.data.sourceType,
      raw: parsed.data.raw,
      title: parsed.data.title ?? null,
      occurredAt: parsed.data.occurredAt ?? null,
      externalUrl: parsed.data.externalUrl ?? null,
      topicId: parsed.data.topicId,
      subtopicId: parsed.data.subtopicId ?? null,
      segments: segments.map((s) => ({
        knowledgeType: s.knowledgeType,
        title: s.title,
        content: s.content ?? null,
        sourceReference: s.sourceReference ?? null,
        confidence: s.confidence ?? null,
      })),
    });
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }

  revalidatePath('/inbox');
  revalidatePath('/timeline');
  revalidatePath(`/topics/${parsed.data.topicId}`);
  redirect(`/topics/${parsed.data.topicId}`);
}

const statusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(INGESTION_STATUSES),
});

/**
 * Files an item away, or brings it back.
 *
 * Archiving is not deleting: the raw capture stays exactly where it is and
 * stays searchable, which is why `soft_delete_record()` refuses inbox records
 * outright. Nothing here can lose content.
 */
export async function setInboxStatusAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  normaliseNewlines(formData);
  const parsed = statusSchema.safeParse({
    id: formData.get('id'),
    status: formData.get('status'),
  });
  if (!parsed.success) return { error: 'That is not a state an inbox item can be in.' };

  const data = await getData();
  try {
    await data.inbox.setStatus(parsed.data.id, parsed.data.status);
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }
  revalidatePath('/inbox');
  return { error: null };
}

/**
 * Parses a paste for the preview screen without writing anything.
 *
 * Every import goes through a preview, so a person sees what would be created
 * before it exists. Returning a plain object rather than persisting is what
 * makes that gate real rather than cosmetic.
 */
export async function previewPaste(raw: string, adapterId?: string) {
  try {
    const result = normalize(raw, adapterId);
    return {
      ok: true as const,
      adapterId: result.adapterId,
      sourceType: result.sourceType,
      title: result.title ?? null,
      occurredAt: result.occurredAt ?? null,
      externalUrl: result.externalUrl ?? null,
      segments: result.segments,
      hints: result.hints ?? null,
      warnings: result.warnings ?? [],
    };
  } catch (cause) {
    return { ok: false as const, error: toUserFacingError(cause).message };
  }
}
