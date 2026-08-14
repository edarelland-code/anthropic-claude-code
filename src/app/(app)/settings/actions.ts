'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getData } from '@/lib/data';
import { DELETABLE_ENTITY_TYPES } from '@/lib/domain/types';
import { toUserFacingError } from '@/lib/errors';
import { mintToken } from '@/lib/ingestion/token';

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

// ---------------------------------------------------------------------------
// Claude Code connection
// ---------------------------------------------------------------------------

/**
 * The one shape in this product that carries a secret.
 *
 * `token` is present exactly once, in the response to the action that created
 * it, and is never persisted anywhere it could be read again. The list on the
 * page is built from rows that do not contain it.
 */
export interface TokenFormState extends FormState {
  token?: string | null;
  tokenName?: string | null;
}

const createTokenSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopeTopicId: z.string().uuid().nullable(),
  scopeSubtopicId: z.string().uuid().nullable(),
  rotatedFromId: z.string().uuid().nullable(),
});

export async function createTokenAction(
  _prev: TokenFormState,
  formData: FormData,
): Promise<TokenFormState> {
  const parsed = createTokenSchema.safeParse({
    name: formData.get('name'),
    scopeTopicId: formData.get('scopeTopicId') || null,
    scopeSubtopicId: formData.get('scopeSubtopicId') || null,
    rotatedFromId: formData.get('rotatedFromId') || null,
  });
  if (!parsed.success) return { error: 'Give the token a name so you can recognise it later.' };

  const data = await getData();
  try {
    const workspace = await data.workspaces.getDefault();
    if (!workspace) return { error: 'No workspace is available yet.' };

    const minted = await mintToken();
    await data.tokens.create({
      workspaceId: workspace.id,
      name: parsed.data.name,
      tokenHash: minted.hash,
      tokenPrefix: minted.prefix,
      scopeTopicId: parsed.data.scopeTopicId,
      scopeSubtopicId: parsed.data.scopeSubtopicId,
      rotatedFromId: parsed.data.rotatedFromId,
    });

    // Rotation, when it is one: the replacement exists before the old token
    // stops working, so a machine is never briefly unable to deliver.
    if (parsed.data.rotatedFromId) await data.tokens.revoke(parsed.data.rotatedFromId);

    revalidatePath('/settings');
    return {
      error: null,
      token: minted.token,
      tokenName: parsed.data.name,
      message: parsed.data.rotatedFromId
        ? 'The replacement is live and the old token has been revoked.'
        : 'Created.',
    };
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }
}

const revokeTokenSchema = z.object({ id: z.string().uuid() });

export async function revokeTokenAction(
  _prev: TokenFormState,
  formData: FormData,
): Promise<TokenFormState> {
  const parsed = revokeTokenSchema.safeParse({ id: formData.get('id') });
  if (!parsed.success) return { error: 'That token could not be identified.' };

  const data = await getData();
  try {
    await data.tokens.revoke(parsed.data.id);
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }
  revalidatePath('/settings');
  return { error: null, message: 'Revoked. Any machine still using it will be refused.' };
}
