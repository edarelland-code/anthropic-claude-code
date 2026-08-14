'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getData } from '@/lib/data';
import { DELETABLE_ENTITY_TYPES } from '@/lib/domain/types';
import { toUserFacingError } from '@/lib/errors';

export interface FormState {
  error: string | null;
  message?: string | null;
}

/**
 * Deletes a record, recoverably.
 *
 * `entityType` is constrained twice over, and both are deliberate. Here it is
 * an enum drawn from `DELETABLE_ENTITY_TYPES`, so the compiler and Zod both
 * refuse `prompt_version` before a request is even made. In the database
 * `soft_delete_record()` refuses it again from an allowlist of statically
 * compiled statements — which is the guarantee. This layer only keeps the UI
 * from offering a control that would raise.
 */
const deleteSchema = z.object({
  entityType: z.enum(DELETABLE_ENTITY_TYPES),
  entityId: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});

export async function softDeleteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = deleteSchema.safeParse({
    entityType: formData.get('entityType'),
    entityId: formData.get('entityId'),
    reason: formData.get('reason') || undefined,
  });
  if (!parsed.success) {
    return { error: 'That kind of record cannot be deleted. History and evidence are permanent.' };
  }

  const data = await getData();
  try {
    await data.recycle.softDelete(
      parsed.data.entityType,
      parsed.data.entityId,
      parsed.data.reason ?? null,
    );
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }

  revalidatePath('/settings');
  revalidatePath('/timeline');
  revalidatePath('/topics');
  return { error: null, message: 'Deleted. It is recoverable from Settings.' };
}

const restoreSchema = z.object({ deletionLogId: z.string().uuid() });

export async function restoreAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = restoreSchema.safeParse({ deletionLogId: formData.get('deletionLogId') });
  if (!parsed.success) return { error: 'That record could not be identified.' };

  const data = await getData();
  try {
    await data.recycle.restore(parsed.data.deletionLogId);
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }

  revalidatePath('/settings');
  revalidatePath('/timeline');
  revalidatePath('/topics');
  return { error: null, message: 'Restored.' };
}
