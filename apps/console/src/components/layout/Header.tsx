import { useLocation } from 'react-router-dom';
import { Button, Badge } from '../ui';
import { useSession } from '../../context/SessionContext';
import { NAV } from './nav';

function currentLabel(path: string): string {
  for (const s of NAV) for (const it of s.items) if (it.to === path) return it.label;
  return 'Console';
}

export function Header() {
  const { hasControl, operatorId, takeControl, cloudState, cloudSignOut } = useSession();
  const { pathname } = useLocation();

  return (
    <header className="header">
      <span className="header-breadcrumb">Stadt Zürich · ERZ · {currentLabel(pathname)}</span>
      <div className="header-right">
        {/* M3-4b: live-WSS cloud mode (renders only when VITE_AWS_* is configured).
            No sign-in branch here: signed-out never reaches the shell — the
            AuthGate in App.tsx shows the Login page instead. */}
        {cloudState !== 'off' && (
          <>
            <Badge tone={cloudState === 'live' ? 'success' : cloudState === 'connecting' ? 'warning' : 'danger'}>
              {cloudState === 'live' ? 'Cloud telemetry LIVE' : cloudState === 'connecting' ? 'Cloud connecting…' : 'Cloud error'}
            </Badge>
            <Button size="sm" variant="ghost" onClick={cloudSignOut}>Sign out</Button>
          </>
        )}
        {hasControl
          ? <Badge tone="success">Control active — {operatorId}</Badge>
          : <Button size="sm" onClick={takeControl}>Take Control</Button>}
        <div className="avatar" title={operatorId}>{operatorId.slice(3, 5) || 'OP'}</div>
      </div>
    </header>
  );
}
