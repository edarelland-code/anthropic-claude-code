import { PhaseNotice } from '@/components/ui/phase-notice';

export default function PromptsPage() {
  return (
    <PhaseNotice
      title="Prompt Library"
      phase={2}
      summary="Prompts as first-class records with versions that are never overwritten. The database already enforces this — prompt_versions has no UPDATE or DELETE policy, so a new version can only ever be appended."
      willInclude={[
        'Full prompt, purpose, source environment, and result',
        'Versions with compare — v1 survives v2 permanently',
        'Worked / Partially worked / Failed / Superseded, plus rating',
        'Mark winning prompt; mark failed',
        'Link a prompt to the Decision or Implementation it produced',
        'Copy and duplicate',
      ]}
    />
  );
}
