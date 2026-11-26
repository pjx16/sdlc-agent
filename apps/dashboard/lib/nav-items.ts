export interface NavItem {
  label: string;
  href: string;
  /** Which icon the rail shows (see components/nav-icons.tsx). */
  icon: 'dashboard' | 'tickets' | 'support' | 'projects' | 'guidelines' | 'usage' | 'operations' | 'settings';
}

/** Left-rail navigation. */
export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Dashboard', href: '/', icon: 'dashboard' },
  { label: 'Tickets', href: '/tickets', icon: 'tickets' },
  { label: 'Inbox', href: '/inbox', icon: 'support' },
  { label: 'Projects', href: '/projects', icon: 'projects' },
  { label: 'Guidelines', href: '/guidelines', icon: 'guidelines' },
  { label: 'Usage', href: '/usage', icon: 'usage' },
  { label: 'Operations', href: '/operations', icon: 'operations' },
  { label: 'Settings', href: '/settings', icon: 'settings' },
];

export function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}
