/**
 * The three destination formatters.
 *
 * Each is a pure function of one already-assembled `ResumeContext`. None of
 * them queries, filters by status, or decides what is current — that happened
 * once, in `assembleResumeContext`. If a formatter re-derived anything, the
 * three destinations could disagree about what is true, and the whole point of
 * a single memory with three profiles would be lost.
 *
 * What they differ in is emphasis and omission: Chat leads with the story, Code
 * leads with the repository, Cowork leads with the deliverable. Same facts.
 */

import { KNOWLEDGE_TYPE_META } from '../domain/knowledge';
import type { Action, Decision } from '../domain/types';

import { estimateResumeSize, type SizeEstimate } from './size';
import type { MeaningfulChange, ResumeContext, WinningPromptSection } from './types';

/** One rendered section, kept separate so size can be attributed per section. */
interface Block {
  section: string;
  markdown: string;
}

const has = (ctx: ResumeContext, section: string) => ctx.sectionsIncluded.includes(section);
const clean = (s: string | null | undefined) => (s ?? '').trim();
const bullet = (s: string) => `- ${s.replace(/\n+/g, ' ').trim()}`;

function heading(title: string, body: string): string {
  return body.trim() === '' ? '' : `## ${title}\n\n${body.trim()}\n`;
}

// ---------------------------------------------------------------------------
// Shared section renderers
// ---------------------------------------------------------------------------

function renderHeader(ctx: ResumeContext, destinationLabel: string): string {
  const { topic, subtopic } = ctx.scope;
  const lines = [
    '# ContextShelf Resume Context',
    '',
    '## Resume Target',
    '',
    `- **Topic:** ${topic.name}`,
    subtopic ? `- **Subtopic:** ${subtopic.name}` : '- **Subtopic:** (whole topic)',
    `- **Destination:** ${destinationLabel}`,
    `- **Density:** ${ctx.density.replace('_', ' ')}`,
    `- **Generated:** ${ctx.generatedAt}`,
    `- **Context freshness:** ${ctx.freshness.message}`,
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Conflicts, at the top where they cannot be missed.
 *
 * Included only when there are any — an empty "no conflicts" section trains the
 * reader to skip the heading, which is exactly when it matters.
 */
function renderConflicts(ctx: ResumeContext): string {
  if (ctx.conflicts.length === 0) return '';
  const body = [
    'ContextShelf detected contradictions in its own records and has not resolved them. Treat the affected items as open questions rather than settled facts.',
    '',
    ...ctx.conflicts.map((c) => bullet(c.summary)),
  ].join('\n');
  return heading('Unresolved Context Conflicts', body);
}

function renderNextAction(ctx: ResumeContext): string {
  if (!has(ctx, 'nextAction')) return '';
  const { primary, secondary, basis } = ctx.nextAction;

  if (!primary) {
    // Stated plainly rather than filled with a plausible task. A fabricated
    // next action would be indistinguishable from a recorded one.
    return heading(
      'Immediate Next Action',
      'No explicit next action is currently recorded in ContextShelf. Ask before assuming one.',
    );
  }

  const parts = [`**${primary.title}**`];
  if (clean(primary.detail)) parts.push('', clean(primary.detail));
  if (basis) parts.push('', `_Chosen because it is the ${basis}._`);
  if (secondary.length > 0) {
    parts.push('', 'Then, in order:', ...secondary.map((a) => bullet(a.title)));
  }
  return heading('Immediate Next Action', parts.join('\n'));
}

function renderDecision(d: Decision): string {
  const bits = [`**${d.title}** — ${clean(d.decision)}`];
  if (clean(d.reason)) bits.push(`  - Why: ${clean(d.reason)}`);
  if (d.alternatives.length > 0) bits.push(`  - Also considered: ${d.alternatives.join(' · ')}`);
  return `- ${bits.join('\n')}`;
}

/**
 * Active decisions, and — separately — the ones that are not.
 *
 * Never one list. Rule 4T is not a formatting preference: a fresh session that
 * cannot tell a superseded decision from a live one will act on the wrong one,
 * which is the exact failure ContextShelf exists to prevent.
 */
function renderDecisions(ctx: ResumeContext): Block[] {
  const out: Block[] = [];

  if (has(ctx, 'activeDecisions') && ctx.activeDecisions.length > 0) {
    out.push({
      section: 'Active Decisions',
      markdown: heading(
        'Active Decisions — CURRENT',
        ['These are in force. Treat them as authoritative.', '', ...ctx.activeDecisions.map(renderDecision)].join('\n'),
      ),
    });
  }

  // Between the two, and never folded into either. A proposal read as active
  // gets acted on; read as history it looks already rejected.
  if (has(ctx, 'pendingDecisions') && ctx.pendingDecisions.length > 0) {
    const rows = ctx.pendingDecisions.map((d) => {
      const why = clean(d.reason);
      const from = d.sourceType === 'claude_code' ? ' (proposed by a Claude Code session)' : '';
      return `- **${d.title}**${from} — ${clean(d.decision)}${why ? `\n  - Reasoning offered: ${why}` : ''}`;
    });
    out.push({
      section: 'Proposed Decisions',
      markdown: heading(
        'Proposed Decisions — AWAITING REVIEW, NOT IN FORCE',
        [
          'These have been suggested and nobody has approved them. Do NOT treat them as decided and do NOT build on them. If one is relevant to what you are about to do, say so and ask.',
          '',
          ...rows,
        ].join('\n'),
      ),
    });
  }

  if (has(ctx, 'historicalDecisions') && ctx.historicalDecisions.length > 0) {
    const rows = ctx.historicalDecisions.map((d) => {
      const label = d.status === 'superseded' ? 'SUPERSEDED' : d.status.toUpperCase();
      const why = clean(d.supersedeReason) || clean(d.reason);
      return `- **[${label}] ${d.title}** — ${clean(d.decision)}${why ? `\n  - Why it changed: ${why}` : ''}`;
    });
    out.push({
      section: 'Decision History',
      markdown: heading(
        'Decision History — HISTORICAL',
        ['These are no longer in force. They are here to explain how the current direction was reached.', '', ...rows].join('\n'),
      ),
    });
  }

  return out;
}

function renderChanges(ctx: ResumeContext): string {
  if (!has(ctx, 'recentChanges') || ctx.recentChanges.length === 0) return '';
  const line = (c: MeaningfulChange) => {
    const kind = KNOWLEDGE_TYPE_META[c.kind as keyof typeof KNOWLEDGE_TYPE_META]?.label ?? c.kind.replace(/_/g, ' ');
    const state =
      c.state === 'historical'
        ? ' _(historical)_'
        : c.state === 'proposed'
          ? ' _(proposed — not approved)_'
          : '';
    return `- **${kind}:** ${c.title}${state}${clean(c.detail) ? ` — ${clean(c.detail)}` : ''}`;
  };
  return heading('Recent Meaningful Changes', ctx.recentChanges.map(line).join('\n'));
}

function renderWinningPrompts(ctx: ResumeContext, includeBodies: boolean): string {
  if (!has(ctx, 'winningPrompts') || ctx.winningPrompts.length === 0) return '';
  const render = (p: WinningPromptSection) => {
    const parts = [`### ${p.title} — winning version v${p.version}`];
    if (clean(p.purpose)) parts.push(`Purpose: ${clean(p.purpose)}`);
    if (clean(p.reason)) parts.push(`Chosen because: ${clean(p.reason)}`);
    if (p.result) parts.push(`Outcome: ${p.result.replace(/_/g, ' ')}`);
    if (includeBodies) parts.push('', '```text', p.body, '```');
    if (p.otherVersions.length > 0) {
      parts.push(
        '',
        'Other versions tried:',
        ...p.otherVersions.map((v) => bullet(`v${v.version} — ${v.result.replace(/_/g, ' ')}${clean(v.notes) ? `: ${clean(v.notes)}` : ''}`)),
      );
    }
    return parts.join('\n');
  };
  return heading(
    'Winning Prompts',
    [
      'These are the exact versions that worked — not necessarily the newest ones. Reuse the text below rather than rewriting it.',
      '',
      ctx.winningPrompts.map(render).join('\n\n'),
    ].join('\n'),
  );
}

function renderAvoid(ctx: ResumeContext): string {
  if (!has(ctx, 'avoid') || ctx.avoid.length === 0) return '';
  const line = (a: (typeof ctx.avoid)[number]) =>
    `- ${a.title}${clean(a.reason) ? ` — ${clean(a.reason)}` : ''}`;
  return heading(
    'Avoid / Do Not Repeat',
    [
      'These directions were evaluated and set aside. Do not reintroduce them unless new evidence has appeared since.',
      '',
      ...ctx.avoid.map(line),
    ].join('\n'),
  );
}

function renderTriggers(ctx: ResumeContext): string {
  if (!has(ctx, 'triggers') || ctx.triggers.length === 0) return '';
  const blocks = ctx.triggers.map((t) =>
    [`**${t.scopeName}**`, `- IF ${clean(t.ifText) || '—'}`, `- THEN ${clean(t.thenText) || '—'}`].join('\n'),
  );
  return heading('Resume Trigger', blocks.join('\n\n'));
}

function renderActions(title: string, actions: Action[]): string {
  if (actions.length === 0) return '';
  return heading(title, actions.map((a) => `- ${a.title}${clean(a.detail) ? ` — ${clean(a.detail)}` : ''}`).join('\n'));
}

function renderRequirements(ctx: ResumeContext): string {
  if (!has(ctx, 'requirements')) return '';
  const rows = [...ctx.requirements, ...ctx.constraints];
  if (rows.length === 0) return '';
  return heading(
    'Requirements and Constraints',
    rows.map((e) => `- **${e.title}**${clean(e.content) ? ` — ${clean(e.content)}` : ''}`).join('\n'),
  );
}

function renderCurrentState(ctx: ResumeContext): string {
  const parts: string[] = [];
  if (clean(ctx.currentState)) parts.push(clean(ctx.currentState));
  if (clean(ctx.parentCurrentState)) {
    parts.push('', `**Topic-level state (${ctx.scope.topic.name}):** ${clean(ctx.parentCurrentState)}`);
  }
  if (parts.length === 0) {
    parts.push('No current state has been recorded. Ask before assuming where the work stands.');
  }
  return heading('Current State — CURRENT', parts.join('\n'));
}

/**
 * The closing instructions.
 *
 * The most important paragraph in the document: it is what turns a pile of
 * facts into a session that behaves. Without it a fresh Claude will helpfully
 * re-propose the rejected approach in its first reply.
 */
function renderInstructions(ctx: ResumeContext, extra: string[] = []): string {
  const lines = [
    'Continue this work from the state above. Specifically:',
    '',
    '- Treat **Current State** and **Active Decisions** as authoritative. They are the current direction.',
    '- Preserve every constraint listed under Requirements and Constraints.',
    '- Do not reintroduce anything under **Avoid / Do Not Repeat** unless new evidence has appeared. If you believe it has, say so explicitly before acting.',
    '- Anything labelled HISTORICAL or SUPERSEDED is background. Do not act on it as if it were current.',
    ctx.nextAction.primary
      ? '- Start with the **Immediate Next Action**. Do not restart earlier work that is already recorded as completed.'
      : '- No next action is recorded. Ask what to work on before starting.',
    ...extra,
    '- Ask only when something you genuinely need in order to proceed is missing. Everything above is the full context ContextShelf holds.',
  ];
  if (ctx.conflicts.length > 0) {
    lines.splice(1, 0, '', `- ${ctx.conflicts.length} unresolved contradiction${ctx.conflicts.length === 1 ? '' : 's'} ${ctx.conflicts.length === 1 ? 'is' : 'are'} listed above. Ask about ${ctx.conflicts.length === 1 ? 'it' : 'them'} rather than choosing for me.`);
  }
  return heading('Instructions for This Claude Session', lines.join('\n'));
}

function assemble(blocks: Block[]): { markdown: string; sections: Block[] } {
  const kept = blocks.filter((b) => b.markdown.trim() !== '');
  return { markdown: kept.map((b) => b.markdown.trim()).join('\n\n'), sections: kept };
}

export interface FormattedResume {
  markdown: string;
  size: SizeEstimate;
}

// ---------------------------------------------------------------------------
// Claude Chat
// ---------------------------------------------------------------------------

/**
 * Prose-first, and no repository detail.
 *
 * A branch name and a commit sha cost tokens and buy nothing in a chat that
 * cannot see the repository (4X).
 */
export function formatForClaudeChat(ctx: ResumeContext): FormattedResume {
  const blocks: Block[] = [
    { section: 'Header', markdown: renderHeader(ctx, 'Claude Chat') },
    { section: 'Conflicts', markdown: renderConflicts(ctx) },
    {
      section: 'Objective',
      markdown: has(ctx, 'objective')
        ? heading('Objective', clean(ctx.objective) || 'No objective has been recorded for this topic.')
        : '',
    },
    { section: 'Current State', markdown: has(ctx, 'currentState') ? renderCurrentState(ctx) : '' },
    { section: 'Immediate Next Action', markdown: renderNextAction(ctx) },
    ...renderDecisions(ctx),
    { section: 'Requirements and Constraints', markdown: renderRequirements(ctx) },
    {
      section: 'Work Already Completed',
      markdown:
        has(ctx, 'completedWork') && ctx.completedWork.length > 0
          ? heading('Work Already Completed', ctx.completedWork.map((e) => bullet(e.title)).join('\n'))
          : '',
    },
    { section: 'Recent Meaningful Changes', markdown: renderChanges(ctx) },
    { section: 'Winning Prompts', markdown: renderWinningPrompts(ctx, true) },
    { section: 'Current Blockers', markdown: has(ctx, 'blockers') ? renderActions('Current Blockers', ctx.blockers) : '' },
    { section: 'Open Questions', markdown: has(ctx, 'openQuestions') ? renderActions('Open Questions', ctx.openQuestions) : '' },
    { section: 'Avoid / Do Not Repeat', markdown: renderAvoid(ctx) },
    { section: 'Resume Trigger', markdown: renderTriggers(ctx) },
    { section: 'Instructions', markdown: renderInstructions(ctx) },
  ];

  const { markdown, sections } = assemble(blocks);
  return { markdown, size: estimateResumeSize(markdown, sections) };
}

// ---------------------------------------------------------------------------
// Claude Cowork
// ---------------------------------------------------------------------------

/**
 * Deliverable framing, with an honest account of what Cowork can actually open.
 *
 * ContextShelf stores a *reference* to a file; it has no way to know whether
 * that file is in the Cowork workspace. Claiming otherwise would send a session
 * looking for something that is not there, so references are labelled as
 * references and the instructions say so (4W).
 */
export function formatForCowork(ctx: ResumeContext): FormattedResume {
  const references = has(ctx, 'references') ? ctx.references : [];
  const files = references.filter((r) => r.kind === 'file');
  const sessions = references.filter((r) => r.kind === 'session');

  const filesBlock =
    files.length === 0
      ? ''
      : heading(
          'Files to Review',
          [
            'ContextShelf holds a reference to each of these. It does not know whether the file is present in this workspace — open what is available and say so if something is missing.',
            '',
            ...files.map((f) => `- **Referenced file:** ${f.label}${clean(f.detail) ? ` — ${clean(f.detail)}` : ''}`),
          ].join('\n'),
        );

  const sourcesBlock =
    sessions.length === 0
      ? ''
      : heading(
          'Supporting Sources',
          sessions.map((s) => `- ${s.label}${clean(s.detail) ? ` — ${clean(s.detail)}` : ''} (full transcript in ContextShelf at ${s.href})`).join('\n'),
        );

  const blocks: Block[] = [
    { section: 'Header', markdown: renderHeader(ctx, 'Claude Cowork') },
    { section: 'Conflicts', markdown: renderConflicts(ctx) },
    {
      section: 'Workspace Goal',
      markdown: has(ctx, 'objective')
        ? heading('Workspace Goal', clean(ctx.objective) || 'No objective has been recorded for this topic.')
        : '',
    },
    { section: 'Current State', markdown: has(ctx, 'currentState') ? renderCurrentState(ctx) : '' },
    {
      section: 'Expected Deliverable',
      markdown: ctx.nextAction.primary
        ? heading('Expected Deliverable', `**${ctx.nextAction.primary.title}**${clean(ctx.nextAction.primary.detail) ? `\n\n${clean(ctx.nextAction.primary.detail)}` : ''}`)
        : heading('Expected Deliverable', 'No deliverable is currently recorded. Ask what is expected before producing anything.'),
    },
    { section: 'Files to Review', markdown: filesBlock },
    ...renderDecisions(ctx),
    { section: 'Requirements and Constraints', markdown: renderRequirements(ctx) },
    {
      section: 'Work Already Completed',
      markdown:
        has(ctx, 'completedWork') && ctx.completedWork.length > 0
          ? heading('Work Already Completed', ctx.completedWork.map((e) => bullet(e.title)).join('\n'))
          : '',
    },
    {
      section: 'Outstanding Work',
      markdown: ctx.nextAction.secondary.length > 0 ? renderActions('Outstanding Work', ctx.nextAction.secondary) : '',
    },
    { section: 'Recent Meaningful Changes', markdown: renderChanges(ctx) },
    { section: 'Current Blockers', markdown: has(ctx, 'blockers') ? renderActions('Current Blockers', ctx.blockers) : '' },
    { section: 'Open Questions', markdown: has(ctx, 'openQuestions') ? renderActions('Open Questions', ctx.openQuestions) : '' },
    { section: 'Supporting Sources', markdown: sourcesBlock },
    { section: 'Winning Prompts', markdown: renderWinningPrompts(ctx, ctx.density !== 'compact') },
    { section: 'Avoid / Do Not Repeat', markdown: renderAvoid(ctx) },
    { section: 'Resume Trigger', markdown: renderTriggers(ctx) },
    {
      section: 'Instructions',
      markdown: renderInstructions(ctx, [
        '- Files listed above are references held by ContextShelf. Check what is actually in this workspace before relying on one.',
      ]),
    },
  ];

  const { markdown, sections } = assemble(blocks);
  return { markdown, size: estimateResumeSize(markdown, sections) };
}

// ---------------------------------------------------------------------------
// Claude Code
// ---------------------------------------------------------------------------

/**
 * Repository state first, and one concrete coding task.
 *
 * The architecture document is POINTED AT rather than inlined, except at Full
 * Audit. A CLAUDE.md is thousands of tokens that Claude Code can read from the
 * repository it already has open; pasting it into every Resume would crowd out
 * the state it cannot discover for itself (4V).
 */
export function formatForClaudeCode(ctx: ResumeContext): FormattedResume {
  const code = ctx.code;

  const repoBlock = !code
    ? ''
    : heading(
        'Repository',
        [
          code.repoUrl ? `- **Repository:** ${code.repoUrl}` : null,
          code.branch ? `- **Branch:** ${code.branch}` : null,
          code.commitSha ? `- **Last recorded commit:** ${code.commitSha}` : null,
          code.buildStatus ? `- **Build:** ${code.buildStatus}` : null,
          code.testSummary ? `- **Tests:** ${code.testSummary}` : null,
          code.hasArchitectureDoc
            ? `- **Architecture rules:** read \`${code.architectureDocPath}\` in the repository before making changes. It is not reproduced here.`
            : null,
        ]
          .filter(Boolean)
          .join('\n'),
      );

  const filesChanged =
    code && code.filesChanged.length > 0
      ? heading('Files Changed in the Last Recorded Session', code.filesChanged.map(bullet).join('\n'))
      : '';

  const referenceFiles = has(ctx, 'references') ? ctx.references.filter((r) => r.kind === 'file') : [];
  const relevantFiles =
    referenceFiles.length > 0
      ? heading('Relevant Files', referenceFiles.map((f) => `- \`${f.label}\`${clean(f.detail) ? ` — ${clean(f.detail)}` : ''}`).join('\n'))
      : '';

  const technical = ctx.completedWork.filter((e) => e.knowledgeType === 'fix' || e.knowledgeType === 'implementation');
  const bugs = ctx.recentChanges.filter((c) => c.kind === 'bug' && c.state === 'current');

  const blocks: Block[] = [
    { section: 'Header', markdown: renderHeader(ctx, 'Claude Code') },
    { section: 'Conflicts', markdown: renderConflicts(ctx) },
    { section: 'Repository', markdown: repoBlock },
    {
      section: 'Objective',
      markdown: has(ctx, 'objective')
        ? heading('Objective', clean(ctx.objective) || 'No objective has been recorded for this topic.')
        : '',
    },
    { section: 'Current State', markdown: has(ctx, 'currentState') ? renderCurrentState(ctx) : '' },
    {
      section: 'Immediate Coding Task',
      markdown: renderNextAction(ctx).replace('## Immediate Next Action', '## Immediate Coding Task'),
    },
    ...renderDecisions(ctx),
    { section: 'Technical Constraints', markdown: renderRequirements(ctx) },
    { section: 'Relevant Files', markdown: relevantFiles },
    { section: 'Files Changed', markdown: filesChanged },
    {
      section: 'Implemented Work',
      markdown: technical.length > 0 ? heading('Implemented Work', technical.map((e) => bullet(e.title)).join('\n')) : '',
    },
    {
      section: 'Known Issues',
      markdown: bugs.length > 0 ? heading('Known Issues', bugs.map((b) => `- ${b.title}${clean(b.detail) ? ` — ${clean(b.detail)}` : ''}`).join('\n')) : '',
    },
    { section: 'Recent Meaningful Changes', markdown: renderChanges(ctx) },
    { section: 'Current Blockers', markdown: has(ctx, 'blockers') ? renderActions('Current Blockers', ctx.blockers) : '' },
    { section: 'Open Questions', markdown: has(ctx, 'openQuestions') ? renderActions('Open Questions', ctx.openQuestions) : '' },
    { section: 'Winning Prompts', markdown: renderWinningPrompts(ctx, ctx.density !== 'compact') },
    { section: 'Avoid / Do Not Repeat', markdown: renderAvoid(ctx) },
    { section: 'Resume Trigger', markdown: renderTriggers(ctx) },
    {
      section: 'Instructions',
      markdown: renderInstructions(
        ctx,
        code?.hasArchitectureDoc
          ? [`- Read \`${code.architectureDocPath}\` before writing code. Its rules take precedence over anything you would otherwise assume.`]
          : [],
      ),
    },
  ];

  const { markdown, sections } = assemble(blocks);
  return { markdown, size: estimateResumeSize(markdown, sections) };
}

/** Routes to the formatter the context was assembled for. */
export function formatResume(ctx: ResumeContext): FormattedResume {
  switch (ctx.target) {
    case 'claude_code':
      return formatForClaudeCode(ctx);
    case 'claude_cowork':
      return formatForCowork(ctx);
    default:
      return formatForClaudeChat(ctx);
  }
}
