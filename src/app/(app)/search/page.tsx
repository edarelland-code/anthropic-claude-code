import { PhaseNotice } from '@/components/ui/phase-notice';

export default function SearchPage() {
  return (
    <PhaseNotice
      title="Search"
      phase={3}
      summary="Universal search across topics, subtopics, transcripts, decisions, ideas, prompts, files, and everything else. The full-text index is already built into the schema — the query layer and result UI land in Phase 3."
      willInclude={[
        'Search inside raw transcripts, not just summaries',
        'Result cards showing matching content, Topic, Subtopic, Knowledge Type, Source, and Date',
        'Filter by source, knowledge type, status, and date range',
        'Includes superseded and rejected items, clearly labelled',
      ]}
    />
  );
}
