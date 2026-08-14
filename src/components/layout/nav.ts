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
  /**
   * Phase this section becomes functional; null means it works today.
   *
   * Kept accurate in both directions. A badge on a section that already works
   * is the same lie as a section that pretends to work — rule 14 cuts both
   * ways, and a stale "P2" tells the user to expect less than they have.
   */
  phase: number | null;
  /** Shown in the mobile bottom bar rather than behind "More". */
  mobilePrimary?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/home', label: 'Home', icon: Home, phase: null, mobilePrimary: true },
  { href: '/topics', label: 'Topics', icon: FolderTree, phase: null, mobilePrimary: true },
  { href: '/inbox', label: 'Inbox', icon: Inbox, phase: null },
  { href: '/timeline', label: 'Timeline', icon: History, phase: null },
  { href: '/prompts', label: 'Prompts', icon: SquareTerminal, phase: null },
  { href: '/ideas', label: 'Ideas', icon: Lightbulb, phase: null },
  { href: '/decisions', label: 'Decisions', icon: Scale, phase: null },
  { href: '/files', label: 'Files', icon: Files, phase: null },
  { href: '/search', label: 'Search', icon: Search, phase: null, mobilePrimary: true },
  { href: '/settings', label: 'Settings', icon: Settings, phase: null },
];
