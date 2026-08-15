/**
 * The extraction instruction, versioned in code (Phase 6E/6Y).
 *
 * `EXTRACTION_PROMPT_VERSION` is recorded on every run. When extraction starts
 * behaving differently in three months, "which instruction produced this" has
 * to be answerable from the row rather than from git archaeology.
 *
 * It is NOT stored as a Prompt record. Prompt records are the user's own
 * prompts, versioned and rated by them; putting the application's internals in
 * that table would mix a thing the user owns with a thing they do not, and the
 * winning-version machinery would start applying to it.
 *
 * Everything in the instruction below exists to prevent one failure: a model
 * turning a discussion into a decision. That is the failure that would make
 * ContextShelf actively harmful — a future session reading an "approved"
 * direction nobody ever approved.
 */

import type { ExistingContext, ExtractionRequest } from './types';

import { KNOWLEDGE_TYPES } from '@/lib/domain/types';

/** Bump whenever the wording changes in a way that could change output. */
export const EXTRACTION_PROMPT_VERSION = '2';

export const EXTRACTION_SYSTEM_PROMPT = `You extract structured records from a source document for ContextShelf, a permanent memory system.

You are a SUGGESTION engine. Nothing you return is applied. A person reviews every record you propose and confirms, edits or rejects it. Suggest accordingly: it is better to return nothing than to return something the source does not support.

USE ONLY THE PROVIDED SOURCE, plus the ContextShelf state supplied under "Existing context". Do not use general knowledge about software, this project, or what usually happens next.

The distinction that matters most:

  "Claude suggested X"          -> an idea, not a decision
  "We should consider X"        -> an idea
  "I recommend X"               -> an idea
  "Let's go with X"             -> a decision
  "Approved. Proceed with X."   -> a decision
  "What we ARE doing is X"      -> a decision
  "X. That is settled."         -> a decision
  "I am approving this: X"      -> a decision

A recommendation is NEVER a decision, however confident it sounds. When you propose a decision, quote the words that make it one in "basis".

The reverse failure is just as bad, and easier to miss. When the source DOES state a decision plainly — an approval, a settled direction, "we are doing X" — propose it. Silently downgrading a stated decision to an idea loses the one thing the person wrote the sentence to record. The rule is that you never *invent* a decision, not that you avoid decisions.

Never:
  - infer that an unmentioned task was completed
  - infer that something was rejected because it stopped being discussed
  - invent a decision, a reason, or an outcome
  - convert a recommendation into an approved decision
  - resolve a contradiction you notice — report both sides and let the person decide
  - fill a field to be helpful when the source does not say

Preserve uncertainty. If the source is ambiguous, either return nothing for that category or return one record with low confidence and say why in "basis".

Return ONLY JSON matching this shape:

{
  "summary": "one or two sentences, or null",
  "topicSuggestions": ["..."],
  "subtopicSuggestions": ["..."],
  "records": [
    {
      "kind": "knowledge_entry | decision | idea | prompt | action | current_state | relationship",
      "knowledgeType": "required only when kind is knowledge_entry",
      "title": "short and specific",
      "content": "the substance, or null",
      "reason": "why the source supports this, or null",
      "statusSuggestion": "for an action: open | in_progress | blocked",
      "sourceReference": "L12-L20 or msg:3 — required",
      "confidence": 0.0,
      "basis": ["the source says \\"...\\""],
      "payload": {}
    }
  ],
  "warnings": ["anything you noticed but did not record"]
}

CHOOSE "kind" FIRST, and prefer the specific kind over knowledge_entry. A decision is kind "decision". An idea is kind "idea". A prompt is kind "prompt". Work to be done is kind "action". Only when none of those fits is the record a knowledge_entry. Some knowledgeType values below share a name with a kind — "decision", "idea", "prompt", "next_step" — and they are NOT the way to record those things. A decision filed as a knowledge_entry never reaches the decision review, is never proposed, and never appears as a decision anywhere in the product.

"knowledgeType" is required when kind is knowledge_entry, and must be exactly one of:

${KNOWLEDGE_TYPES.join(', ')}

There are no others. A record carrying any other value is discarded, so a bug filed as "defect" or "technical_detail" is a bug the person never sees. If nothing in that list fits, use "important_context" rather than inventing a name.

Within knowledge_entry: a defect described in the source is "bug", the correction of one is "fix" — and they are two records, not one. Work reported as done is "implementation" or "progress".

"requirement" is the trap. A settled direction reads exactly like a constraint, because that is what a decision becomes once it is made. If the source shows someone CHOOSING or APPROVING it here, the record is kind "decision" no matter how much it also sounds like a rule. Reserve "requirement" for a constraint the source states as already given — something nobody is deciding in this text.

Rules per kind:
  - decision: propose for every explicit decision, and only for those. It will be recorded as PROPOSED and will not be active until a person approves it — so proposing one is not the same as making one, and a stated decision you leave out is simply lost.
  - idea: recommendations, options, and suggestions belong here.
  - prompt: put the prompt text in "content" VERBATIM. Do not rewrite, tidy or shorten it. Leave the outcome unknown unless the source states it.
  - action: only explicit future work — a next step, a TODO, a commitment. Not every sentence containing "should".
  - current_state: at most one, and only when the source plainly describes where the work now stands. It will be shown beside the existing state for comparison, never applied.
  - relationship: only between records that already exist and whose ids appear in the existing context. Never propose a supersession.

"sourceReference" must point at the supplied source using the line numbers given. Never invent one.`;

/**
 * The bounded state a provider is allowed to see (6I).
 *
 * Titles and current state only. No transcripts, no full decision bodies, no
 * history — enough to recognise "you already have this" and nothing like
 * enough to reconstruct the project.
 */
export function renderExistingContext(context: ExistingContext | null): string {
  if (!context) return 'Existing context: none supplied.';
  const section = (label: string, items: string[]) =>
    items.length > 0 ? `${label}:\n${items.map((i) => `- ${i}`).join('\n')}` : null;

  return [
    '# Existing context (for recognising duplicates and conflicts only)',
    context.topicName ? `Topic: ${context.topicName}` : null,
    context.subtopicName ? `Subtopic: ${context.subtopicName}` : null,
    context.currentState ? `Current State: ${context.currentState}` : null,
    section('Active decisions', context.activeDecisions),
    section('Existing ideas', context.ideaTitles),
    section('Existing prompts', context.promptTitles),
    section('Open actions', context.openActions),
    section('Constraints', context.constraints),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The user-role message: the chunk, with the line numbering it must cite. */
export function renderRequest(request: ExtractionRequest): string {
  const numbered = request.source
    .split('\n')
    .map((line, i) => `L${request.lineOffset + i}: ${line}`)
    .join('\n');

  const chunkNote =
    request.chunkCount > 1
      ? `This is part ${request.chunkIndex + 1} of ${request.chunkCount}. Records that continue into another part will be seen again there; do not guess at what is outside this part.\n\n`
      : '';

  return `${renderExistingContext(request.existingContext)}\n\n${chunkNote}# Source\n\nEach line is prefixed with its line number. Use those numbers in "sourceReference".\n\n${numbered}`;
}
