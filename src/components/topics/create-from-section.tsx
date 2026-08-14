'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';

import type { Subtopic, Topic } from '@/lib/domain/types';
import { cn } from '@/lib/utils';
import { CreateMemoryActions } from './create-forms';

/**
 * The create action for a global section (Decisions, Ideas, Prompts).
 *
 * Every memory object belongs to a topic — that is rule 1, and it is why there
 * is no "create a decision" that floats free of one. So the section-level
 * action picks a topic first and then hands off to the same forms the Topic
 * workspace uses. Duplicating the forms per section would give three places to
 * change a field.
 *
 * With no topics yet, this points at creating one rather than presenting a form
 * that cannot succeed.
 */
export function CreateFromSection({
  topics,
  subtopicsByTopic,
  label,
}: {
  topics: Topic[];
  subtopicsByTopic: Record<string, Subtopic[]>;
  label: string;
}) {
  const [topicId, setTopicId] = useState<string>(topics[0]?.id ?? '');

  if (topics.length === 0) {
    return (
      <Link
        href="/topics/new"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
      >
        <Plus className="size-4" aria-hidden />
        Create a topic first
      </Link>
    );
  }

  return (
    <div className="rounded-lg p-4 surface">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block min-w-0 flex-1">
          <span className="block text-xs font-medium uppercase tracking-wider muted">
            {label} belongs to
          </span>
          <select
            value={topicId}
            onChange={(e) => setTopicId(e.target.value)}
            className={cn('mt-1 w-full rounded-md px-3 py-2.5 text-sm surface')}
          >
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3">
        <CreateMemoryActions topicId={topicId} subtopics={subtopicsByTopic[topicId] ?? []} />
      </div>
    </div>
  );
}
