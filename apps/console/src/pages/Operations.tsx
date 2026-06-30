import { Card, CardHeader, Button, Badge } from '../components/ui';
import { useSession } from '../context/SessionContext';

export function Operations() {
  const { telemetry: t, hasControl, operatorId, vehicleId, token, takeControl, cmdPost, estop } = useSession();

  const drive = (payload: object) => cmdPost('command', { payload });

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
          <CardHeader title="Mode 2 commands" />
          <div className="card-pad">
            <p className="text-sm muted" style={{ marginBottom: 12 }}>Direct driving — depot / private zone only.</p>
            <div className="row gap-2 wrap">
              <Button size="sm" disabled={!hasControl} onClick={() => drive({ action: 'STEER', angle: -5 })}>Steer left</Button>
              <Button size="sm" disabled={!hasControl} onClick={() => drive({ action: 'STEER', angle: 5 })}>Steer right</Button>
              <Button size="sm" disabled={!hasControl} onClick={() => drive({ action: 'DRIVE', throttle: 20, brake: 0 })}>Throttle</Button>
              <Button size="sm" disabled={!hasControl} onClick={() => drive({ action: 'DRIVE', throttle: 0, brake: 50 })}>Brake</Button>
              <Button size="sm" variant="ghost" disabled={!hasControl} onClick={() => drive({ action: 'HORN', durationMs: 500 })}>Horn</Button>
              <Button size="sm" variant="ghost" disabled={!hasControl} onClick={() => drive({ action: 'LIGHTS', state: 'HAZARD' })}>Hazard</Button>
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
    </div>
  );
}
