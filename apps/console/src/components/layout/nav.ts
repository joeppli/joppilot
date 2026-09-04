import type { AppMode } from '../../mode/mode';

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  /** Stub pages are routed but not yet built — shown with a muted "soon" hint. */
  stub?: boolean;
}

export interface NavSection {
  heading?: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    items: [
      { to: '/', label: 'Dashboard', icon: 'dashboard' },
      { to: '/map', label: 'Map & Dispatch', icon: 'map' },
      { to: '/vehicles', label: 'Vehicles', icon: 'truck' },
      { to: '/operations', label: 'Remote Operations', icon: 'operations' },
    ],
  },
  {
    heading: 'Fleet',
    items: [
      { to: '/inspections', label: 'Inspections', icon: 'inspection', stub: true },
      { to: '/issues', label: 'Issues', icon: 'issues', stub: true },
      { to: '/reminders', label: 'Reminders', icon: 'reminders', stub: true },
      { to: '/service', label: 'Service', icon: 'service', stub: true },
      { to: '/charging', label: 'Charging & Energy', icon: 'charging', stub: true },
    ],
  },
  {
    heading: 'Operations',
    items: [
      { to: '/contacts', label: 'Contacts & Users', icon: 'contacts', stub: true },
      { to: '/parts', label: 'Parts & Inventory', icon: 'parts', stub: true },
      { to: '/places', label: 'Places', icon: 'places', stub: true },
      { to: '/reports', label: 'Reports', icon: 'reports', stub: true },
    ],
  },
];

/**
 * The navigation a session may actually use.
 *
 * A demo session drops the not-yet-built pages. They are routed and honest
 * about being planned, but every one of them needs a backend the demo never
 * contacts — so to a visitor they are nine identical dead ends between the
 * four screens that do work. The SCOPE they represent is not hidden: the
 * sidebar states it in one line instead (see Sidebar / demoScopeNote).
 *
 * Operator and local sessions keep the full IA — for them the stubs are a
 * roadmap, not a detour.
 */
export function navFor(mode: AppMode | null): NavSection[] {
  if (mode !== 'demo') return NAV;
  return NAV
    .map(section => ({ ...section, items: section.items.filter(item => !item.stub) }))
    .filter(section => section.items.length > 0);
}
