'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { getData } from '@/lib/data';
import { KNOWLEDGE_TYPES } from '@/lib/domain/types';
import { toUserFacingError } from '@/lib/errors';

export interface FormState {
  error: string | null;
}

const createTopicSchema = z.object({
  name: z.string().trim().min(1, 'A name is required.').max(120),
  description: z.string().trim().max(2000).optional(),
  goal: z.string().trim().max(2000).optional(),
});

export async function createTopicAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = createTopicSchema.safeParse({
    name: formData.get('name'),
    description: formData.get('description') || undefined,
    goal: formData.get('goal') || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const data = await getData();
  const workspace = await data.workspaces.getDefault();
  if (!workspace) return { error: 'No workspace available.' };

  let topicId: string;
  try {
    const topic = await data.topics.create({
      workspaceId: workspace.id,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      goal: parsed.data.goal ?? null,
    });
    topicId = topic.id;
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }

  revalidatePath('/home');
  revalidatePath('/topics');
  redirect(`/topics/${topicId}`);
}

const createSubtopicSchema = z.object({
  topicId: z.string().uuid(),
  name: z.string().trim().min(1, 'A name is required.').max(120),
  parentSubtopicId: z.string().uuid().nullable().optional(),
});

export async function createSubtopicAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createSubtopicSchema.safeParse({
    topicId: formData.get('topicId'),
    name: formData.get('name'),
    parentSubtopicId: formData.get('parentSubtopicId') || null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  const data = await getData();
  try {
    await data.subtopics.create({
      topicId: parsed.data.topicId,
      name: parsed.data.name,
      parentSubtopicId: parsed.data.parentSubtopicId ?? null,
    });
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }

  revalidatePath(`/topics/${parsed.data.topicId}`);
  return { error: null };
}

const createEntrySchema = z.object({
  topicId: z.string().uuid(),
  knowledgeType: z.enum(KNOWLEDGE_TYPES),
  title: z.string().trim().min(1, 'A title is required.').max(300),
  content: z.string().trim().max(50_000).optional(),
  subtopicId: z.string().uuid().nullable().optional(),
  sourceType: z
    .enum(['claude_chat', 'claude_cowork', 'claude_code', 'manual', 'file', 'url'])
    .default('manual'),
});

export async function createEntryAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = createEntrySchema.safeParse({
    topicId: formData.get('topicId'),
    knowledgeType: formData.get('knowledgeType'),
    title: formData.get('title'),
    content: formData.get('content') || undefined,
    subtopicId: formData.get('subtopicId') || null,
    sourceType: formData.get('sourceType') || 'manual',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  const data = await getData();
  try {
    await data.knowledge.create({
      topicId: parsed.data.topicId,
      knowledgeType: parsed.data.knowledgeType,
      title: parsed.data.title,
      content: parsed.data.content ?? null,
      sourceType: parsed.data.sourceType,
      subtopicIds: parsed.data.subtopicId ? [parsed.data.subtopicId] : [],
    });
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }

  revalidatePath(`/topics/${parsed.data.topicId}`);
  revalidatePath('/home');
  return { error: null };
}

const updateTopicSchema = z.object({
  id: z.string().uuid(),
  expectedUpdatedAt: z.string().min(1),
  goal: z.string().trim().max(2000).optional(),
  currentState: z.string().trim().max(5000).optional(),
  progress: z.coerce.number().int().min(0).max(100).optional(),
  resumeTriggerIf: z.string().trim().max(500).optional(),
  resumeTriggerThen: z.string().trim().max(500).optional(),
});

export async function updateTopicAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = updateTopicSchema.safeParse({
    id: formData.get('id'),
    expectedUpdatedAt: formData.get('expectedUpdatedAt'),
    goal: formData.get('goal') ?? undefined,
    currentState: formData.get('currentState') ?? undefined,
    progress: formData.get('progress') ?? undefined,
    resumeTriggerIf: formData.get('resumeTriggerIf') ?? undefined,
    resumeTriggerThen: formData.get('resumeTriggerThen') ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  const data = await getData();
  try {
    await data.topics.update({
      id: parsed.data.id,
      expectedUpdatedAt: parsed.data.expectedUpdatedAt,
      goal: parsed.data.goal ?? null,
      currentState: parsed.data.currentState ?? null,
      progress: parsed.data.progress,
      resumeTriggerIf: parsed.data.resumeTriggerIf ?? null,
      resumeTriggerThen: parsed.data.resumeTriggerThen ?? null,
      // Editing goal/state/progress is real progress, so the freshness clock moves.
      meaningful: true,
    });
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }

  revalidatePath(`/topics/${parsed.data.id}`);
  revalidatePath('/home');
  return { error: null };
}

const addActionSchema = z.object({
  topicId: z.string().uuid(),
  kind: z.enum(['next_step', 'blocker', 'question']),
  title: z.string().trim().min(1, 'A title is required.').max(300),
});

export async function addActionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = addActionSchema.safeParse({
    topicId: formData.get('topicId'),
    kind: formData.get('kind'),
    title: formData.get('title'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  const data = await getData();
  try {
    await data.actions.create({
      topicId: parsed.data.topicId,
      kind: parsed.data.kind,
      title: parsed.data.title,
    });
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }

  revalidatePath(`/topics/${parsed.data.topicId}`);
  revalidatePath('/home');
  return { error: null };
}

export async function resolveActionAction(actionId: string, topicId: string): Promise<void> {
  const data = await getData();
  await data.actions.setStatus(actionId, 'done');
  revalidatePath(`/topics/${topicId}`);
  revalidatePath('/home');
}
