import VehicleMap from '../VehicleMap';
import { Badge, Progress, vehicleStateTone } from '../components/ui';
import { useSession } from '../context/SessionContext';

export function MapDispatch() {
  const { telemetry: t, isLatched } = useSession();

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', height: 'calc(100vh - var(--header-h))' }}>
      <div style={{ width: 320, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--bg-surface)', overflowY: 'auto' }}>
        <div style={{ padding: 'var(--sp-4) var(--sp-5)', borderBottom: '1px solid var(--border)' }}>
          <strong>Fleet</strong>
          <div className="text-xs muted">1 vehicle · live</div>
        </div>
        <div style={{ padding: 'var(--sp-4) var(--sp-5)' }}>
          <div className="row between" style={{ marginBottom: 10 }}>
            <strong>JÖP-01</strong>
            <Badge tone={isLatched ? 'danger' : vehicleStateTone(t?.vehicleState)}>{t?.vehicleState ?? 'N/A'}</Badge>
          </div>
          <div className="kv"><span>Battery</span><strong>{t ? `${t.battery.percent.toFixed(1)}%` : '—'}</strong></div>
          <Progress value={t?.battery.percent ?? 0} />
          <div className="kv" style={{ marginTop: 10 }}><span>Speed</span><strong>{t ? `${t.speedKmh.toFixed(1)} km/h` : '—'}</strong></div>
          <div className="kv"><span>Zone</span><strong>{t?.currentZone ?? '—'}</strong></div>
          <div className="kv"><span>Location</span><strong className="text-xs">{t ? `${t.location.lat.toFixed(4)}, ${t.location.lng.toFixed(4)}` : '—'}</strong></div>
        </div>
      </div>
      <div className="grow" style={{ position: 'relative' }}>
        {t
          ? <div style={{ position: 'absolute', inset: 0 }}>
              <VehicleMap lat={t.location.lat} lng={t.location.lng} vehicleState={t.vehicleState} speedKmh={t.speedKmh} zone={t.currentZone ?? 'unknown'} />
            </div>
          : <div className="row" style={{ height: '100%', justifyContent: 'center' }}><span className="muted">Waiting for telemetry…</span></div>}
      </div>
    </div>
  );
}
