import { Card, CardHeader, Button, Badge } from '../components/ui';
import { useSession } from '../context/SessionContext';
import { ZONE_MODE_MATRIX } from '@joppilot/contract';
import { TeleopPanel } from '../teleop/TeleopPanel';

export function Operations() {
  const { telemetry: t, hasControl, operatorId, vehicleId, token, takeControl, cmdPost, estop } = useSession();

  const drive = (payload: object) => cmdPost('command', { payload });

  // ICD §1: Joppilot (1st gate) "never shows a disallowed control to the
  // operator" — Mode 2 driving controls only render in a zone whose matrix
  // row permits Mode 2. The vehicle (2nd gate) re-checks regardless.
  const zone = t?.currentZone;
  const mode2Allowed = !!(zone && ZONE_MODE_MATRIX[zone]?.mode2);

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">Remote Operations &amp; Safety</div>
        <div className="page-sub">OAD Mode 1 supervision · vehicle control · session</div>
      </div>

      <div className="grid grid-3">
        <Card>
          <CardHeader title="Emergency controls" />
          <div className="card-pad col gap-2">
            <button className="btn btn-danger btn-lg btn-block" disabled={!hasControl} onClick={estop}
              aria-label="Emergency stop. Keyboard shortcut: Spacebar"
              style={{ fontWeight: 'var(--fw-extra)', letterSpacing: '.04em' }}>
              E-STOP
            </button>
            <Button variant="warning" block disabled={!hasControl} onClick={() => cmdPost('command', { payload: { action: 'SAFE_STOP' } })}>Safe stop</Button>
            <Button variant="ghost" block disabled={!hasControl} onClick={() => cmdPost('clear-safe-stop')}>Clear safe-stop latch</Button>
            <span className="text-xs muted" style={{ marginTop: 4 }}>Keyboard: Spacebar = E-STOP</span>
          </div>
        </Card>

        <Card>
          <CardHeader title="Driving & signalling" />
          <div className="card-pad">
            {mode2Allowed ? (
              <>
                <p className="text-sm muted" style={{ marginBottom: 12 }}>Mode 2 direct driving — permitted in zone '{zone}'.</p>
                {/* Direction (ICD §4: forward / reverse / neutral) */}
                <p className="text-xs muted" style={{ marginBottom: 6 }}>Direction</p>
                <div className="row gap-2 wrap" style={{ marginBottom: 10 }}>
                  <Button size="sm" disabled={!hasControl} onClick={() => drive({ action: 'SELECT_DIRECTION', direction: 'FORWARD' })}>Forward</Button>
                  <Button size="sm" disabled={!hasControl} onClick={() => drive({ action: 'SELECT_DIRECTION', direction: 'NEUTRAL' })}>Neutral</Button>
                  <Button size="sm" disabled={!hasControl} onClick={() => drive({ action: 'SELECT_DIRECTION', direction: 'REVERSE' })}>Backward</Button>
                </div>
                {/* Steering (ICD §4: left / right) */}
                <p className="text-xs muted" style={{ marginBottom: 6 }}>Steering</p>
                <div className="row gap-2 wrap" style={{ marginBottom: 10 }}>
                  <Button size="sm" disabled={!hasControl} onClick={() => drive({ action: 'TURN', direction: 'LEFT' })}>Left</Button>
                  <Button size="sm" disabled={!hasControl} onClick={() => drive({ action: 'TURN', direction: 'RIGHT' })}>Right</Button>
                  <Button size="sm" disabled={!hasControl} onClick={() => drive({ action: 'STEER', angle: 0 })}>Center</Button>
                </div>
                {/* Throttle / brake (ICD §4) */}
                <p className="text-xs muted" style={{ marginBottom: 6 }}>Throttle / brake</p>
                <div className="row gap-2 wrap" style={{ marginBottom: 12 }}>
                  <Button size="sm" disabled={!hasControl} onClick={() => drive({ action: 'DRIVE', throttle: 20, brake: 0 })}>Throttle</Button>
                  <Button size="sm" disabled={!hasControl} onClick={() => drive({ action: 'DRIVE', throttle: 0, brake: 50 })}>Brake</Button>
                </div>
              </>
            ) : (
              // ICD §1 first gate: a disallowed control is NOT shown. On a
              // public approved route the law permits supervision, not
              // remote driving — so no driving buttons exist to misclick.
              <p className="text-sm muted" style={{ marginBottom: 12 }}>
                Direct driving (Mode 2) is not available in zone '{zone ?? 'unknown'}' — supervision only (ICD §1).
              </p>
            )}
            <p className="text-sm muted" style={{ marginBottom: 8 }}>Signalling (Mode 1 — valid in any operating zone):</p>
            <div className="row gap-2 wrap">
              <Button size="sm" variant="ghost" disabled={!hasControl} onClick={() => drive({ action: 'HORN', durationMs: 500 })}>Horn</Button>
              {/* ICD §4: hazards are the Mode 1 signalling capability; head-
                  lights / turn signals are Mode-2-only (LIGHTS command). */}
              <Button size="sm" variant="ghost" disabled={!hasControl} onClick={() => drive({ action: 'HAZARD_LIGHTS', on: true })}>Hazard</Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Session" action={<Badge tone={hasControl ? 'success' : 'neutral'}>{hasControl ? 'Active' : 'Observing'}</Badge>} />
          <div className="card-pad">
            <div className="kv"><span>Operator</span><strong>{operatorId}</strong></div>
            <div className="kv"><span>Vehicle</span><strong>{vehicleId}</strong></div>
            <div className="kv"><span>Mode</span><strong>{t?.mode ?? '—'}</strong></div>
            <div className="kv"><span>Zone</span><strong>{t?.currentZone ?? '—'}</strong></div>
            {!token && <Button block onClick={takeControl} style={{ marginTop: 12 }}>Take control</Button>}
          </div>
        </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        <TeleopPanel />
      </div>
    </div>
  );
}
