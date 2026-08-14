'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getData } from '@/lib/data';
import { toUserFacingError } from '@/lib/errors';

export interface FormState {
  error: string | null;
  message?: string | null;
}

/**
 * Records a reference to a file in a repository, or to a URL.
 *
 * A REFERENCE. The bytes are not copied and the page is not fetched, which is
 * the honest description of what this does and is why the form says so.
 * `kind = 'upload'` exists in the schema for a real upload path later; it is
 * not offered here, because offering an upload that quietly stores a path and
 * no file would be faking the feature (rule 13).
 */
const createSchema = z
  .object({
    topicId: z.string().uuid('Choose a topic.'),
    subtopicId: z.string().uuid().nullable().optional(),
    kind: z.enum(['repo_file', 'url']),
    path: z.string().trim().max(1000).optional(),
    url: z.string().trim().max(2000).optional(),
    displayName: z.string().trim().max(300).optional(),
    repoUrl: z.string().trim().max(500).optional(),
    branch: z.string().trim().max(200).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'repo_file' && !v.path) {
      ctx.addIssue({ code: 'custom', message: 'A file path is required.', path: ['path'] });
    }
    if (v.kind === 'url') {
      if (!v.url) {
        ctx.addIssue({ code: 'custom', message: 'A URL is required.', path: ['url'] });
      } else if (!/^https?:\/\/\S+$/i.test(v.url)) {
        ctx.addIssue({
          code: 'custom',
          message: 'The URL must start with http:// or https://.',
          path: ['url'],
        });
      }
    }
  });

export async function createFileReferenceAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createSchema.safeParse({
    topicId: formData.get('topicId'),
    subtopicId: formData.get('subtopicId') || null,
    kind: formData.get('kind'),
    path: formData.get('path') || undefined,
    url: formData.get('url') || undefined,
    displayName: formData.get('displayName') || undefined,
    repoUrl: formData.get('repoUrl') || undefined,
    branch: formData.get('branch') || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };

  const data = await getData();
  try {
    await data.files.create({
      topicId: parsed.data.topicId,
      subtopicId: parsed.data.subtopicId ?? null,
      kind: parsed.data.kind,
      path: parsed.data.path ?? null,
      url: parsed.data.url ?? null,
      displayName: parsed.data.displayName ?? null,
      repoUrl: parsed.data.repoUrl ?? null,
      branch: parsed.data.branch ?? null,
    });
  } catch (cause) {
    return { error: toUserFacingError(cause).message };
  }

  revalidatePath('/files');
  revalidatePath(`/topics/${parsed.data.topicId}`);
  return { error: null, message: 'Reference saved.' };
}
