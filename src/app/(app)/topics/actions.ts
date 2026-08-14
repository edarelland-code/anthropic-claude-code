'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { getData } from '@/lib/data';
import {
  IDEA_STATUSES,
  KNOWLEDGE_TYPES,
  PROMPT_RESULTS,
  SELECTABLE_DECISION_STATUSES,
  SOURCE_TYPES,
} from '@/lib/domain/types';
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

// ---------------------------------------------------------------------------
// Phase 2 memory objects
//
// Each writes through the repository port, so the rules those repositories
// enforce — decisions authoritative with a linked entry, ideas keeping their
// rationale, prompts appending versions and outcomes — apply here without being
// restated. `sourceType` is taken from the form and never guessed: an unknown
// source is 'manual' (rule 11).
// ---------------------------------------------------------------------------

const createDecisionSchema = z.object({
  topicId: z.string().uuid(),
  subtopicId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1, 'A decision needs a title.').max(300),
  decision: z.string().trim().min(1, 'Say what was decided.').max(5000),
  reason: z.string().trim().max(5000).optional(),
  approvedDirection: z.string().trim().max(2000).optional(),
  status: z.enum(SELECTABLE_DECISION_STATUSES).default('active'),
  sourceType: z.enum(SOURCE_TYPES).default('manual'),
  // One per line in the textarea; stored as a jsonb array.
  alternatives: z.string().max(5000).optional(),
});

export async function createDecisionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createDecisionSchema.safeParse({
    topicId: formData.get('topicId'),
    subtopicId: formData.get('subtopicId') || null,
    title: formData.get('title'),
    decision: formData.get('decision'),
    reason: formData.get('reason') || undefined,
    approvedDirection: formData.get('approvedDirection') || undefined,
    status: formData.get('status') || 'active',
    sourceType: formData.get('sourceType') || 'manual',
    alternatives: formData.get('alternatives') || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  const data = await getData();
  try {
    await data.decisions.create({
      topicId: parsed.data.topicId,
      subtopicId: parsed.data.subtopicId ?? null,
      title: parsed.data.title,
      decision: parsed.data.decision,
      reason: parsed.data.reason ?? null,
      alternatives: splitLines(parsed.data.alternatives),
      approvedDirection: parsed.data.approvedDirection ?? null,
      status: parsed.data.status,
      sourceType: parsed.data.sourceType,
    });
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }

  revalidatePath(`/topics/${parsed.data.topicId}`);
  revalidatePath('/decisions');
  revalidatePath('/timeline');
  revalidatePath('/home');
  return { error: null };
}

const createIdeaSchema = z.object({
  topicId: z.string().uuid(),
  subtopicId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1, 'An idea needs a title.').max(300),
  idea: z.string().trim().max(5000).optional(),
  rationale: z.string().trim().max(5000).optional(),
  notes: z.string().trim().max(5000).optional(),
  status: z.enum(IDEA_STATUSES).default('suggested'),
  sourceType: z.enum(SOURCE_TYPES).default('manual'),
});

export async function createIdeaAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = createIdeaSchema.safeParse({
    topicId: formData.get('topicId'),
    subtopicId: formData.get('subtopicId') || null,
    title: formData.get('title'),
    idea: formData.get('idea') || undefined,
    rationale: formData.get('rationale') || undefined,
    notes: formData.get('notes') || undefined,
    status: formData.get('status') || 'suggested',
    sourceType: formData.get('sourceType') || 'manual',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  const data = await getData();
  try {
    // Notes join the rationale rather than becoming a second free-text field
    // the lifecycle would then have to keep in step.
    const rationale = [parsed.data.rationale, parsed.data.notes].filter(Boolean).join('\n\n') || null;
    await data.ideas.create({
      topicId: parsed.data.topicId,
      subtopicId: parsed.data.subtopicId ?? null,
      title: parsed.data.title,
      idea: parsed.data.idea ?? null,
      rationale,
      status: parsed.data.status,
      sourceType: parsed.data.sourceType,
    });
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }

  revalidatePath(`/topics/${parsed.data.topicId}`);
  revalidatePath('/ideas');
  revalidatePath('/timeline');
  return { error: null };
}

const createPromptSchema = z.object({
  topicId: z.string().uuid(),
  subtopicId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1, 'A prompt needs a title.').max(300),
  body: z.string().min(1, 'The prompt body cannot be empty.').max(50_000),
  purpose: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(5000).optional(),
  sourceType: z.enum(SOURCE_TYPES).default('manual'),
  // Only recorded when the prompt has already been run.
  result: z.enum(PROMPT_RESULTS).optional(),
});

export async function createPromptAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = createPromptSchema.safeParse({
    topicId: formData.get('topicId'),
    subtopicId: formData.get('subtopicId') || null,
    title: formData.get('title'),
    body: formData.get('body'),
    purpose: formData.get('purpose') || undefined,
    notes: formData.get('notes') || undefined,
    sourceType: formData.get('sourceType') || 'manual',
    result: formData.get('result') || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  const data = await getData();
  try {
    const { version } = await data.prompts.create({
      topicId: parsed.data.topicId,
      subtopicId: parsed.data.subtopicId ?? null,
      title: parsed.data.title,
      body: parsed.data.body,
      purpose: parsed.data.purpose ?? null,
      sourceType: parsed.data.sourceType,
    });

    // An outcome known at creation is appended, never written onto the version:
    // prompt_versions is insert-only and evaluations live in
    // prompt_version_outcomes (AD-18). create() already seeded an 'untested'
    // outcome, so this appends a second row and the newest wins.
    if (parsed.data.result || parsed.data.notes) {
      await data.prompts.rateVersion({
        versionId: version.id,
        result: parsed.data.result ?? 'untested',
        notes: parsed.data.notes ?? null,
      });
    }
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }

  revalidatePath(`/topics/${parsed.data.topicId}`);
  revalidatePath('/prompts');
  revalidatePath('/timeline');
  return { error: null };
}

/** Textarea lines to a clean array. Blank lines are not alternatives. */
function splitLines(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Phase 4 — subtopic Resume Trigger, and the Phase 2 control gaps
//
// These are here because Resume accuracy depends on them. A supersede control
// that only exists at the repository level means the avoid-list can only ever
// be populated by a developer; a re-rating control that does not exist means a
// prompt that stopped working keeps being exported as one that works. Both are
// the difference between a Resume that reflects reality and one that reflects
// whatever was true when the record was created.
// ---------------------------------------------------------------------------

const subtopicResumeSchema = z.object({
  subtopicId: z.string().uuid(),
  topicId: z.string().uuid(),
  expectedUpdatedAt: z.string().min(1),
  currentState: z.string().trim().max(4000).optional(),
  goal: z.string().trim().max(2000).optional(),
  resumeTriggerIf: z.string().trim().max(500).optional(),
  resumeTriggerThen: z.string().trim().max(500).optional(),
});

export async function updateSubtopicResumeAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = subtopicResumeSchema.safeParse({
    subtopicId: formData.get('subtopicId'),
    topicId: formData.get('topicId'),
    expectedUpdatedAt: formData.get('expectedUpdatedAt'),
    currentState: formData.get('currentState') ?? undefined,
    goal: formData.get('goal') ?? undefined,
    resumeTriggerIf: formData.get('resumeTriggerIf') ?? undefined,
    resumeTriggerThen: formData.get('resumeTriggerThen') ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  const data = await getData();
  try {
    await data.subtopics.updateResume({
      id: parsed.data.subtopicId,
      expectedUpdatedAt: parsed.data.expectedUpdatedAt,
      currentState: parsed.data.currentState || null,
      goal: parsed.data.goal || null,
      resumeTriggerIf: parsed.data.resumeTriggerIf || null,
      resumeTriggerThen: parsed.data.resumeTriggerThen || null,
    });
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }
  revalidatePath(`/topics/${parsed.data.topicId}`);
  return { error: null };
}

/**
 * Moves a decision through the states a user can choose.
 *
 * `superseded` is deliberately absent from the enum: that state is only ever
 * produced by superseding, which also sets the pointer and demands a reason.
 * Offering it as a plain status would let a decision be marked replaced with
 * nothing to point at and no reason recorded — exactly the conflict the Resume
 * assembler now reports.
 */
const decisionStatusSchema = z.object({
  decisionId: z.string().uuid(),
  topicId: z.string().uuid(),
  status: z.enum(SELECTABLE_DECISION_STATUSES),
});

export async function setDecisionStatusAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = decisionStatusSchema.safeParse({
    decisionId: formData.get('decisionId'),
    topicId: formData.get('topicId'),
    status: formData.get('status'),
  });
  if (!parsed.success) return { error: 'That is not a state a decision can be moved to.' };

  const data = await getData();
  try {
    await data.decisions.setStatus(parsed.data.decisionId, parsed.data.status);
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }
  revalidatePath(`/topics/${parsed.data.topicId}`);
  revalidatePath('/decisions');
  return { error: null };
}

/**
 * Replaces a decision with a new one, recording why.
 *
 * The reason is mandatory here, in the repository, and in the database (rule
 * 7). It is the field that turns the avoid-list from a list of dead ends into
 * an explanation, and without it a fresh Claude session has no way to tell a
 * direction that failed from one that was simply not tried.
 */
const supersedeDecisionSchema = z.object({
  decisionId: z.string().uuid(),
  topicId: z.string().uuid(),
  title: z.string().trim().min(1, 'The replacement needs a title.').max(200),
  decision: z.string().trim().min(1, 'Say what is being decided instead.').max(4000),
  reason: z.string().trim().min(1, 'Record why the previous decision was replaced.').max(2000),
});

export async function supersedeDecisionAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = supersedeDecisionSchema.safeParse({
    decisionId: formData.get('decisionId'),
    topicId: formData.get('topicId'),
    title: formData.get('title'),
    decision: formData.get('decision'),
    reason: formData.get('reason'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  const data = await getData();
  try {
    const replacement = await data.decisions.create({
      topicId: parsed.data.topicId,
      title: parsed.data.title,
      decision: parsed.data.decision,
      reason: parsed.data.reason,
    });
    await data.decisions.supersede({
      id: parsed.data.decisionId,
      newDecisionId: replacement.id,
      reason: parsed.data.reason,
    });
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }
  revalidatePath(`/topics/${parsed.data.topicId}`);
  revalidatePath('/decisions');
  revalidatePath('/timeline');
  return { error: null };
}

const ideaStatusSchema = z.object({
  ideaId: z.string().uuid(),
  topicId: z.string().uuid(),
  status: z.enum(IDEA_STATUSES),
  note: z.string().trim().max(2000).optional(),
});

/**
 * Moves an idea through its lifecycle.
 *
 * The note is APPENDED to the rationale rather than replacing it. A rejected
 * idea has to keep both why it was suggested and why it was turned down —
 * losing the first half would make the avoid-list read as a list of arbitrary
 * refusals (rule 9).
 */
export async function setIdeaStatusAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = ideaStatusSchema.safeParse({
    ideaId: formData.get('ideaId'),
    topicId: formData.get('topicId'),
    status: formData.get('status'),
    note: formData.get('note') || undefined,
  });
  if (!parsed.success) return { error: 'That is not a state an idea can be moved to.' };
  if (parsed.data.status === 'rejected' && !parsed.data.note) {
    return { error: 'Record why this is being rejected — it is what stops it being proposed again.' };
  }

  const data = await getData();
  try {
    await data.ideas.setStatus(parsed.data.ideaId, parsed.data.status, parsed.data.note);
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }
  revalidatePath(`/topics/${parsed.data.topicId}`);
  revalidatePath('/ideas');
  return { error: null };
}

/**
 * Re-rates an existing prompt version.
 *
 * Appends to `prompt_version_outcomes`; it never writes onto the version
 * (rule 6, AD-18). A judgement that changes later is history, not a correction
 * — and Resume reads the newest outcome, so a prompt that stopped working stops
 * being exported as one that works.
 */
const rateVersionSchema = z.object({
  versionId: z.string().uuid(),
  promptId: z.string().uuid(),
  topicId: z.string().uuid(),
  result: z.enum(PROMPT_RESULTS),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function rateVersionAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = rateVersionSchema.safeParse({
    versionId: formData.get('versionId'),
    promptId: formData.get('promptId'),
    topicId: formData.get('topicId'),
    result: formData.get('result'),
    rating: formData.get('rating') || undefined,
    notes: formData.get('notes') || undefined,
  });
  if (!parsed.success) return { error: 'That outcome could not be recorded.' };

  const data = await getData();
  try {
    await data.prompts.rateVersion({
      versionId: parsed.data.versionId,
      result: parsed.data.result,
      rating: parsed.data.rating,
      notes: parsed.data.notes,
    });
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }
  revalidatePath(`/topics/${parsed.data.topicId}`);
  revalidatePath('/prompts');
  return { error: null };
}

/**
 * Names the exact version that won.
 *
 * A VERSION, never a prompt (rule 9a). Passing null clears the selection, which
 * is recorded as a row of its own rather than a deletion — the history of what
 * was believed to be best is itself worth keeping.
 */
const markWinningSchema = z.object({
  promptId: z.string().uuid(),
  topicId: z.string().uuid(),
  versionId: z.string().uuid().nullable(),
  reason: z.string().trim().max(2000).optional(),
});

export async function markWinningAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formData.get('versionId');
  const parsed = markWinningSchema.safeParse({
    promptId: formData.get('promptId'),
    topicId: formData.get('topicId'),
    versionId: raw === '' || raw === null ? null : raw,
    reason: formData.get('reason') || undefined,
  });
  if (!parsed.success) return { error: 'That version could not be selected.' };

  const data = await getData();
  try {
    await data.prompts.markWinning({
      promptId: parsed.data.promptId,
      versionId: parsed.data.versionId,
      reason: parsed.data.reason ?? null,
    });
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }
  revalidatePath(`/topics/${parsed.data.topicId}`);
  revalidatePath('/prompts');
  return { error: null };
}
