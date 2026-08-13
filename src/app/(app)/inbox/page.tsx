import { PhaseNotice } from '@/components/ui/phase-notice';

export default function InboxPage() {
  return (
    <PhaseNotice
      title="Inbox"
      phase={3}
      summary="Frictionless capture. Paste anything — a Claude response, a full transcript, JSON, a URL, a quick note — and file it later. Items start uncategorized on purpose, because capture that demands decisions does not get used."
      willInclude={[
        'Paste text, Claude responses, and transcripts',
        'Structured JSON and Claude Code summaries',
        'URLs and file uploads',
        'Assign to Topic, Subtopic, and Knowledge Type after the fact',
        'Suggested classification you confirm — never applied silently',
      ]}
    />
  );
}
