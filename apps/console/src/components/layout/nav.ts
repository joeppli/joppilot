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
