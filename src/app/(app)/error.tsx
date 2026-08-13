'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

/**
 * Catches anything a Server Component throws — most often the database being
 * unreachable or a session expiring mid-render. Shows a recoverable state
 * rather than a blank page, and never prints the raw error, which can name
 * tables, constraints, or connection details.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[contextshelf]', error);
  }, [error]);

  const expired = /session|jwt|not signed in/i.test(error.message);
  const unreachable = /fetch failed|network|timeout|econnrefused/i.test(error.message);

  return (
    <div className="mx-auto max-w-lg px-6 py-16">
      <div className="rounded-lg p-5 surface">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
          {expired
            ? 'Your session expired'
            : unreachable
              ? 'Cannot reach the database'
              : 'Something went wrong'}
        </h1>

        <p className="mt-2.5 text-sm leading-6 muted">
          {expired
            ? 'Sign in again to continue. Nothing you saved has been lost — everything lives in the cloud database.'
            : unreachable
              ? 'ContextShelf could not load your data. Your shelf is intact; this is a connection problem between this device and the database.'
              : 'This page could not load. Your data is unaffected.'}
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            <RotateCw className="size-4" aria-hidden />
            Try again
          </button>
          {expired && (
            <a
              href="/login"
              className="rounded-md px-3 py-2 text-sm font-medium ring-1 ring-inset hairline hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
            >
              Sign in
            </a>
          )}
        </div>

        {error.digest && (
          <p className="mt-4 border-t pt-3 text-xs muted hairline">
            Reference: <code>{error.digest}</code>
          </p>
        )}
      </div>
    </div>
  );
}
