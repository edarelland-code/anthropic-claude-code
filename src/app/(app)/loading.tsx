/** Skeleton shown while a Server Component streams. Mirrors the real layout so
 *  the page does not jump when data arrives. */
export default function AppLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="h-6 w-40 animate-pulse rounded bg-black/[0.07] dark:bg-white/10" />
      <div className="mt-2 h-4 w-64 animate-pulse rounded bg-black/[0.05] dark:bg-white/[0.07]" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="rounded-lg p-4 surface">
            <div className="h-4 w-2/3 animate-pulse rounded bg-black/[0.07] dark:bg-white/10" />
            <div className="mt-2.5 h-3 w-full animate-pulse rounded bg-black/[0.05] dark:bg-white/[0.07]" />
            <div className="mt-1.5 h-3 w-4/5 animate-pulse rounded bg-black/[0.05] dark:bg-white/[0.07]" />
            <div className="mt-4 h-1.5 w-full animate-pulse rounded-full bg-black/[0.05] dark:bg-white/[0.07]" />
          </div>
        ))}
      </div>
    </div>
  );
}
