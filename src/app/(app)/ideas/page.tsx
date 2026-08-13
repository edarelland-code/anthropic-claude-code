import { PhaseNotice } from '@/components/ui/phase-notice';

export default function IdeasPage() {
  return (
    <PhaseNotice
      title="Idea Library"
      phase={2}
      summary="The lifecycle of every idea, including the ones you turned down. Rejected ideas keep their reasoning so a future Claude session can be told what has already been evaluated."
      willInclude={[
        'Lifecycle: Suggested → Considering → Approved → Implemented, plus Deferred and Rejected',
        'Original idea and why it was suggested',
        'The Decision it led to, and the Implementation it became',
        'Related prompts and the discussion it came from',
      ]}
    />
  );
}
