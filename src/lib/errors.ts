import { ConflictError } from '@/lib/ports/repositories';

/**
 * Turns anything thrown by the data layer into a message safe to render.
 *
 * Two rules:
 *  - Never surface a raw driver error. Postgres error text can name tables,
 *    columns, constraints, and connection strings.
 *  - Never fail silently. Every branch returns something the user can act on.
 */

export interface UserFacingError {
  message: string;
  /** True when retrying the same action might work (network, cold start). */
  retryable: boolean;
  /** True when the user must reload before their edit can succeed. */
  conflict: boolean;
}

const GENERIC = 'Something went wrong saving that. Your previous data is unaffected.';

export function toUserFacingError(cause: unknown): UserFacingError {
  if (cause instanceof ConflictError) {
    return { message: cause.message, retryable: false, conflict: true };
  }

  const raw = cause instanceof Error ? cause.message : String(cause ?? '');
  const lower = raw.toLowerCase();

  // Configuration — actionable, and names no secret.
  if (lower.includes('not configured')) {
    return {
      message: 'ContextShelf is not connected to its database. Check the server configuration.',
      retryable: false,
      conflict: false,
    };
  }

  // Auth
  if (lower.includes('not signed in') || lower.includes('jwt') || lower.includes('session')) {
    return {
      message: 'Your session expired. Sign in again — nothing you saved has been lost.',
      retryable: false,
      conflict: false,
    };
  }

  // Reachability
  if (
    lower.includes('fetch failed') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('etimedout') ||
    lower.includes('network') ||
    lower.includes('timeout')
  ) {
    return {
      message:
        'Cannot reach the database right now. Nothing was saved — check your connection and try again.',
      retryable: true,
      conflict: false,
    };
  }

  // Permission. RLS denials surface as a policy violation.
  if (lower.includes('row-level security') || lower.includes('permission denied') || lower.includes('42501')) {
    return {
      message: 'You do not have access to that.',
      retryable: false,
      conflict: false,
    };
  }

  // Duplicate submits (double-click, retried request).
  if (lower.includes('duplicate key') || lower.includes('23505')) {
    return {
      message: 'That already exists. It may have been created by an earlier attempt.',
      retryable: false,
      conflict: false,
    };
  }

  // Deliberate phase gates and validation errors are already user-facing.
  if (cause instanceof Error && /lands in Phase \d/.test(raw)) {
    return { message: raw, retryable: false, conflict: false };
  }
  if (lower.includes('a reason is required') || lower.includes('is required')) {
    return { message: raw, retryable: false, conflict: false };
  }

  // Log the detail server-side; hand the user the generic message.
  if (typeof console !== 'undefined') console.error('[contextshelf] unhandled data error:', cause);
  return { message: GENERIC, retryable: true, conflict: false };
}
