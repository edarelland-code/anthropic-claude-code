import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="mt-2 text-sm leading-6 muted">
        That topic or page does not exist, or it belongs to a different account. Nothing was
        deleted — if you archived it, it is still on your shelf.
      </p>
      <Link
        href="/home"
        className="mt-5 inline-flex rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
      >
        Back to Home
      </Link>
    </main>
  );
}
