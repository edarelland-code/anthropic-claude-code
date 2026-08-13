import { PhaseNotice } from '@/components/ui/phase-notice';

export default function FilesPage() {
  return (
    <PhaseNotice
      title="Files"
      phase={3}
      summary="Every file, path, repository, and link that relates to a topic — so months later you can find the code without remembering which session touched it."
      willInclude={[
        'Repository files with repo, branch, and commit',
        'Uploads and external URLs',
        'The Implementation each file belongs to',
        'Which Claude Code session last touched it',
      ]}
    />
  );
}
