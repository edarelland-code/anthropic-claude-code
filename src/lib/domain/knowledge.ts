import type { EntryStatus, KnowledgeType, SourceType } from './types';

/**
 * Presentation metadata for the knowledge model.
 *
 * CLAUDE.md rule 23: colour carries exactly one meaning — knowledge type.
 * Source is a secondary, monochrome badge. Nothing else in the UI may
 * introduce a competing colour signal.
 */

export interface KnowledgeTypeMeta {
  label: string;
  /** Tailwind classes for the chip. Neutral surface + one hue. */
  chip: string;
  /** Left rail colour on cards and timeline dots. */
  accent: string;
  group: 'progress' | 'decision' | 'idea' | 'prompt' | 'change' | 'problem' | 'reference';
}

export const KNOWLEDGE_TYPE_META: Record<KnowledgeType, KnowledgeTypeMeta> = {
  progress: { label: 'Progress', chip: 'bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-500/10 dark:text-green-300 dark:ring-green-400/20', accent: 'bg-green-500', group: 'progress' },
  implementation: { label: 'Implementation', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20', accent: 'bg-emerald-500', group: 'progress' },
  decision: { label: 'Decision', chip: 'bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/20', accent: 'bg-violet-500', group: 'decision' },
  idea: { label: 'Idea', chip: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20', accent: 'bg-amber-500', group: 'idea' },
  suggestion: { label: 'Suggestion', chip: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20', accent: 'bg-amber-400', group: 'idea' },
  prompt: { label: 'Prompt', chip: 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-400/20', accent: 'bg-blue-500', group: 'prompt' },
  winning_prompt: { label: 'Winning Prompt', chip: 'bg-cyan-50 text-cyan-700 ring-cyan-600/20 dark:bg-cyan-500/10 dark:text-cyan-300 dark:ring-cyan-400/20', accent: 'bg-cyan-500', group: 'prompt' },
  failed_prompt: { label: 'Failed Prompt', chip: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20', accent: 'bg-rose-400', group: 'prompt' },
  requirement: { label: 'Requirement', chip: 'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-500/10 dark:text-slate-300 dark:ring-slate-400/20', accent: 'bg-slate-500', group: 'reference' },
  change: { label: 'Change', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20', accent: 'bg-emerald-400', group: 'change' },
  added: { label: 'Added', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20', accent: 'bg-emerald-500', group: 'change' },
  removed: { label: 'Removed', chip: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20', accent: 'bg-rose-500', group: 'change' },
  refactored: { label: 'Refactored', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20', accent: 'bg-emerald-400', group: 'change' },
  bug: { label: 'Bug', chip: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/20', accent: 'bg-red-500', group: 'problem' },
  fix: { label: 'Fix', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20', accent: 'bg-emerald-500', group: 'problem' },
  research: { label: 'Research', chip: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-400/20', accent: 'bg-indigo-500', group: 'reference' },
  file: { label: 'File', chip: 'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-500/10 dark:text-slate-300 dark:ring-slate-400/20', accent: 'bg-slate-500', group: 'reference' },
  link: { label: 'Link', chip: 'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-500/10 dark:text-slate-300 dark:ring-slate-400/20', accent: 'bg-slate-400', group: 'reference' },
  blocker: { label: 'Blocker', chip: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/20', accent: 'bg-red-500', group: 'problem' },
  question: { label: 'Question', chip: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20', accent: 'bg-amber-500', group: 'problem' },
  next_step: { label: 'Next Step', chip: 'bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-500/10 dark:text-green-300 dark:ring-green-400/20', accent: 'bg-green-500', group: 'progress' },
  milestone: { label: 'Milestone', chip: 'bg-green-50 text-green-700 ring-green-600/20 dark:bg-green-500/10 dark:text-green-300 dark:ring-green-400/20', accent: 'bg-green-600', group: 'progress' },
  rejected_idea: { label: 'Rejected Idea', chip: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20', accent: 'bg-rose-500', group: 'idea' },
  important_context: { label: 'Important Context', chip: 'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-500/10 dark:text-slate-300 dark:ring-slate-400/20', accent: 'bg-slate-600', group: 'reference' },
};

export const SOURCE_META: Record<SourceType, { label: string; short: string }> = {
  claude_chat: { label: 'Claude Chat', short: 'Chat' },
  claude_cowork: { label: 'Claude Cowork', short: 'Cowork' },
  claude_code: { label: 'Claude Code', short: 'Code' },
  manual: { label: 'Manual entry', short: 'Manual' },
  file: { label: 'File', short: 'File' },
  url: { label: 'URL', short: 'URL' },
  imported_transcript: { label: 'Imported transcript', short: 'Import' },
  api: { label: 'API', short: 'API' },
  mcp: { label: 'MCP', short: 'MCP' },
  browser_extension: { label: 'Browser companion', short: 'Browser' },
};

export const ENTRY_STATUS_META: Record<EntryStatus, { label: string; muted: boolean }> = {
  active: { label: 'Active', muted: false },
  superseded: { label: 'Superseded', muted: true },
  rejected: { label: 'Rejected', muted: true },
  replaced: { label: 'Replaced', muted: true },
  deprecated: { label: 'Deprecated', muted: true },
  archived: { label: 'Archived', muted: true },
};

/** Timeline filter groups, per the spec's filter list. */
export const TIMELINE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'claude_chat', label: 'Claude Chat', sourceType: 'claude_chat' as SourceType },
  { id: 'claude_cowork', label: 'Cowork', sourceType: 'claude_cowork' as SourceType },
  { id: 'claude_code', label: 'Claude Code', sourceType: 'claude_code' as SourceType },
  { id: 'decisions', label: 'Decisions', types: ['decision'] as KnowledgeType[] },
  { id: 'ideas', label: 'Ideas', types: ['idea', 'suggestion', 'rejected_idea'] as KnowledgeType[] },
  { id: 'prompts', label: 'Prompts', types: ['prompt', 'winning_prompt', 'failed_prompt'] as KnowledgeType[] },
  { id: 'changes', label: 'Changes', types: ['change', 'added', 'removed', 'refactored', 'implementation'] as KnowledgeType[] },
  { id: 'progress', label: 'Progress', types: ['progress', 'milestone', 'next_step'] as KnowledgeType[] },
  { id: 'files', label: 'Files', types: ['file', 'link'] as KnowledgeType[] },
  { id: 'problems', label: 'Problems', types: ['bug', 'blocker', 'question', 'fix'] as KnowledgeType[] },
] as const;
