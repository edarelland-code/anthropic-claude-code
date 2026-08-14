/**
 * Realistic sources for the extraction regressions (Phase 6AI).
 *
 * These are conversations, not keyword soup, because the failure they guard
 * against is a plausible one: a system that reads "I recommend X" and files an
 * approved decision. Each case names what a correct extractor must and must
 * not produce, and the tests assert both — a missed record and an invented one
 * are different bugs and only one of them is dangerous.
 *
 * They are regression fixtures, not a benchmark. Nine hand-written cases cannot
 * support an accuracy figure and none is claimed (6AJ).
 */

export interface ExtractionCase {
  name: string;
  source: string;
  /** What a correct extractor should propose. */
  expects: string;
  /** What it must never propose. */
  forbids: string;
}

/** CASE 1 — a recommendation with no approval anywhere in it. */
export const caseRecommendationOnly = `User: we need to pick a store for the timeline merge

Assistant: I recommend doing the merge in a database view rather than in the
application. Views cannot drift from the rows they summarise, and the
application-level version would need its own cache invalidation.

User: interesting, let me think about it

Assistant: happy to sketch either one when you decide.`;

/** CASE 2 — an explicit approval. Still only ever a PROPOSED decision. */
export const caseExplicitApproval = `User: what should we do about the timeline merge?

Assistant: a database view is the safer option.

User: Approved. Proceed with the database view.

Decision: Timeline merge lives in a database view
The application-level merge would need cache invalidation nobody would maintain.`;

/** CASE 3 — a Claude Code completion summary whose facts Phase 5 already has. */
export const caseCodeSummary = `Assistant: done. Implemented the receipt view and wired it to the export
button. Found a bug: the clipboard rejected the write without a user gesture on
Firefox. Fixed it by selecting the text as a fallback.

Build: passed
Tests: 214 passed, 0 failed

TODO: render the receipt ids in the topic page`;

/** CASE 4 — a mixed transcript with one of nearly everything. */
export const caseMixedTranscript = `User: two things today.

Decision: Ingestion tokens are hashed, never stored
Storing a token would mean it could be stolen later.

Idea: we could add a browser companion that posts the same payload
Nothing about it is decided yet.

Assistant: here is the prompt I used for the extraction step.

Prompt: Extract only what the source states. Do not infer completion from silence.

User: we ruled out putting the merge in the application layer, it drifts.

Bug: the resume preview showed stale text after switching destination
Fix: wait for the preview to change rather than for a word it already contained

Question: should the avoid list include proposed decisions?

TODO: run the responsive audit on the topic page`;

/** CASE 5 — prose that says nothing definite. */
export const caseAmbiguous = `User: hmm

Assistant: There are a few directions here. Some teams go one way, some the
other. It depends on what matters more to you. We could revisit it later, or
not — it may not matter much either way.`;

/** CASE 8 — a source carrying things that look like credentials. */
export const caseWithSecrets = `User: here is the config that broke

export ANTHROPIC_API_KEY=sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH
DATABASE_PASSWORD=hunter2hunter2
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U

Assistant: the key is fine, the password has a typo.`;

/** CASE 9 — long enough to require chunking. */
export function caseLargeTranscript(turns = 400): string {
  const block = (i: number) =>
    [
      `User: question number ${i} about the relay`,
      '',
      `Assistant: answer number ${i}. ${'Some substantive detail about the relay work. '.repeat(6)}`,
      '',
      i === 12 ? 'Decision: Use a database view for the timeline\nIt cannot drift.\n' : '',
      i === 380 ? 'Decision: Use a database view for the timeline\nIt cannot drift.\n' : '',
    ].join('\n');
  return Array.from({ length: turns }, (_, i) => block(i)).join('\n');
}

export const CASES: ExtractionCase[] = [
  {
    name: 'recommendation without approval',
    source: caseRecommendationOnly,
    expects: 'an idea or recommendation',
    forbids: 'an active decision',
  },
  {
    name: 'explicit approval',
    source: caseExplicitApproval,
    expects: 'a decision suggestion carrying its evidence',
    forbids: 'anything already active',
  },
  {
    name: 'mixed transcript',
    source: caseMixedTranscript,
    expects: 'decision, idea, prompt, bug, fix, question, next step',
    forbids: 'records with no source anchor',
  },
  {
    name: 'ambiguous prose',
    source: caseAmbiguous,
    expects: 'nothing, or something low-confidence',
    forbids: 'a decision',
  },
];
