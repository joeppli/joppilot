import { ReactNode } from 'react';

export type BadgeTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

export function Badge({ tone = 'neutral', dot = true, children }: { tone?: BadgeTone; dot?: boolean; children: ReactNode }) {
  return <span className={`badge badge-${tone}${dot ? '' : ' badge-plain'}`}>{children}</span>;
}

/** Map a vehicle state to a badge tone for consistent status colouring. */
export function vehicleStateTone(state?: string): BadgeTone {
  switch (state) {
    case 'SAFE_STOPPED': return 'danger';
    case 'REMOTE_DRIVE':
    case 'SUPERVISED_ASSIST': return 'success';
    case 'MISSION_PAUSED': return 'warning';
    default: return 'neutral';
  }
}

/** Map a mission status to a badge tone. */
export function missionTone(status?: string): BadgeTone {
  switch (status) {
    case 'ACTIVE': return 'success';
    case 'COMPLETED': return 'info';
    case 'ABORTED': return 'danger';
    case 'PAUSED': return 'warning';
    default: return 'warning';
  }
}
