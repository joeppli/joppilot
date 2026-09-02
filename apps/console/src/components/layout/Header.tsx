import { useLocation } from 'react-router-dom';
import { Button, Badge } from '../ui';
import { useSession } from '../../context/SessionContext';
import { useMode } from '../../mode/ModeContext';
import { entryStrings as t } from '../../mode/strings';
import { NAV } from './nav';

function currentLabel(path: string): string {
  for (const s of NAV) for (const it of s.items) if (it.to === path) return it.label;
  return 'Console';
}

export function Header() {
  const { hasControl, operatorId, takeControl, cloudState, cloudSignIn, cloudSignOut } = useSession();
  const { mode, reset } = useMode();
  const { pathname } = useLocation();

  /**
   * Leave the session and go back to the entry gate — available in EVERY mode,
   * so a demo visitor is never trapped in the console with no way back.
   *
   * Order matters for an operator: clearing the mode must happen BEFORE the
   * Cognito logout redirect. That redirect returns the browser to this same
   * origin, and if the stored mode were still 'operator' the app would simply
   * mount itself again instead of showing the gate.
   */
  function leaveSession() {
    reset();
    if (mode === 'operator' && cloudState !== 'off') cloudSignOut();
  }

  const exitLabel =
    mode === 'operator' ? t.exitOperator : mode === 'demo' ? t.exitDemo : t.exitLocal;

  return (
    <header className="header">
      <span className="header-breadcrumb">Stadt Zürich · ERZ · {currentLabel(pathname)}</span>
      <div className="header-right">
        {/* Simulated data must never be mistakable for a real vehicle — this
            console is shown publicly, and every number on screen in demo mode
            is invented by the in-tab simulator. */}
        {mode === 'demo' && <Badge tone="warning">{t.demoBadge}</Badge>}
        {/* M3-4b: live-WSS cloud mode (renders only when VITE_AWS_* is configured) */}
        {cloudState !== 'off' && (
          cloudState === 'signed-out'
            ? <Button size="sm" variant="ghost" onClick={cloudSignIn}>Sign in (AWS)</Button>
            : <Badge tone={cloudState === 'live' ? 'success' : cloudState === 'connecting' ? 'warning' : 'danger'}>
                {cloudState === 'live' ? 'Cloud telemetry LIVE' : cloudState === 'connecting' ? 'Cloud connecting…' : 'Cloud error'}
              </Badge>
        )}
        {hasControl
          ? <Badge tone="success">Control active — {operatorId}</Badge>
          : <Button size="sm" onClick={takeControl}>Take Control</Button>}
        <div className="avatar" title={operatorId}>{operatorId.slice(3, 5) || 'OP'}</div>
        {/* Replaces the old cloud-only "Sign out": that one existed only when
            AWS was configured and left the app mounted, so it could not return
            a demo or local session to the gate. */}
        <Button size="sm" variant="ghost" onClick={leaveSession} aria-label={t.exitAria}>
          {exitLabel}
        </Button>
      </div>
    </header>
  );
}
