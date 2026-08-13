import {
  Files,
  FolderTree,
  History,
  Home,
  Inbox,
  Lightbulb,
  Scale,
  Search,
  Settings,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react';

/**
 * Primary navigation is fixed by CLAUDE.md rule 3. Claude Chat, Cowork, and
 * Claude Code are source filters, never sections.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Phase this section becomes functional; null means it works today. */
  phase: number | null;
  /** Shown in the mobile bottom bar rather than behind "More". */
  mobilePrimary?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/home', label: 'Home', icon: Home, phase: null, mobilePrimary: true },
  { href: '/topics', label: 'Topics', icon: FolderTree, phase: null, mobilePrimary: true },
  { href: '/inbox', label: 'Inbox', icon: Inbox, phase: 3 },
  { href: '/timeline', label: 'Timeline', icon: History, phase: 2 },
  { href: '/prompts', label: 'Prompts', icon: SquareTerminal, phase: 2 },
  { href: '/ideas', label: 'Ideas', icon: Lightbulb, phase: 2 },
  { href: '/decisions', label: 'Decisions', icon: Scale, phase: 2 },
  { href: '/files', label: 'Files', icon: Files, phase: 3 },
  { href: '/search', label: 'Search', icon: Search, phase: 3, mobilePrimary: true },
  { href: '/settings', label: 'Settings', icon: Settings, phase: null },
];
