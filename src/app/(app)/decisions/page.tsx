import { PhaseNotice } from '@/components/ui/phase-notice';

export default function DecisionsPage() {
  return (
    <PhaseNotice
      title="Decision Ledger"
      phase={2}
      summary="Decisions as first-class objects, with the reasoning attached. The point is to stop future Claude sessions from re-recommending directions you already evaluated and rejected — and to remind you why you rejected them."
      willInclude={[
        'Decision, reason, alternatives considered, approved direction',
        'Status: Active, Superseded, Reversed, Deprecated',
        'Supersession chains — a new decision links to the one it replaced, with a required reason',
        'Related prompts, files, and implementation',
        'Conflicting-decision detection that proposes rather than merges',
      ]}
    />
  );
}
