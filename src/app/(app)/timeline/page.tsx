import { PhaseNotice } from '@/components/ui/phase-notice';

export default function TimelinePage() {
  return (
    <PhaseNotice
      title="Timeline"
      phase={2}
      summary="Every source folded into one chronological history across all topics, filterable by source, knowledge type, and date. A per-topic timeline already works on each Topic page."
      willInclude={[
        'Cross-topic chronological view',
        'Filters: Claude Chat, Cowork, Claude Code, Decisions, Ideas, Prompts, Changes, Progress, Files, Problems, Date',
        'Superseded and rejected entries shown in place, labelled — never removed',
        'Jump from any entry to its original source',
      ]}
    />
  );
}
