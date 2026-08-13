import { redirect } from 'next/navigation';

import { MobileNav } from '@/components/layout/mobile-nav';
import { Sidebar } from '@/components/layout/sidebar';
import { getData, isConfigured } from '@/lib/data';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!isConfigured()) redirect('/setup');

  const data = await getData();
  const user = await data.auth.getUser();
  if (!user) redirect('/login');

  const workspace = await data.workspaces.getDefault();
  const topics = workspace ? await data.topics.list(workspace.id) : [];
  const pinned = topics
    .filter((t) => t.topic.pinned)
    .map((t) => ({ id: t.topic.id, name: t.topic.name }));

  return (
    <div className="flex min-h-dvh">
      <Sidebar
        workspaceName={workspace?.name ?? 'No workspace'}
        pinnedTopics={pinned}
        email={user.email}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 pb-24 lg:pb-0">{children}</main>
      </div>
      <MobileNav />
    </div>
  );
}
