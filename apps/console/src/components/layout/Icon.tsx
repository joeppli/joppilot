/** Minimal stroke icon set (18×18, inherits currentColor). */
const PATHS: Record<string, string> = {
  dashboard: 'M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 14h7v7H3z',
  map: 'M9 3 3 5v16l6-2 6 2 6-2V3l-6 2-6-2zM9 3v16M15 5v16',
  truck: 'M1 3h13v10H1zM14 7h4l3 3v3h-7zM5.5 18.5a2 2 0 1 0 0-.01M16.5 18.5a2 2 0 1 0 0-.01',
  inspection: 'M9 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 3v3h6V3M8.5 13l2 2 4-4',
  issues: 'M12 3 2 20h20zM12 10v4M12 17h.01',
  reminders: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M10.5 21a2 2 0 0 0 3 0',
  service: 'M14.5 5.5a4 4 0 0 1-5 5L4 16l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2-2z',
  charging: 'M13 2 4 14h7l-1 8 9-12h-7z',
  contacts: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  parts: 'M21 16V8l-9-5-9 5v8l9 5zM3.3 7 12 12l8.7-5M12 12v10',
  places: 'M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  reports: 'M3 3v18h18M7 14v4M12 9v9M17 5v13',
  operations: 'M6 11h4M8 9v4M15 12h.01M18 10h.01M21 13a3 3 0 0 1-3 3c-1.5 0-2-1-3.5-1h-5C6 15 5.5 16 4 16a3 3 0 0 1-3-3l1.2-5A3 3 0 0 1 6 6h12a3 3 0 0 1 2.8 2z',
};

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.dashboard} />
    </svg>
  );
}
