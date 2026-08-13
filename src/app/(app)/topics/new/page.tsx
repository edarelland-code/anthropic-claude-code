import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { NewTopicForm } from './new-topic-form';

export default function NewTopicPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-6 sm:px-6 lg:py-10">
      <Link href="/topics" className="inline-flex items-center gap-1.5 text-sm muted hover:underline">
        <ArrowLeft className="size-4" aria-hidden />
        Topics
      </Link>
      <h1 className="mt-4 text-xl font-semibold tracking-tight">New topic</h1>
      <p className="mt-1.5 text-sm leading-6 muted">
        Name the thing you are working on, not the conversation you had about it. You can add
        subtopics, decisions, and knowledge once it exists.
      </p>
      <NewTopicForm />
    </div>
  );
}
