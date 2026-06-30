import { Card, CardHeader, Badge, Progress, vehicleStateTone } from '../components/ui';
import { useSession } from '../context/SessionContext';

export function Vehicles() {
  const { telemetry: t, vehicleId, isLatched } = useSession();

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">Fleet Vehicles &amp; Health</div>
        <div className="page-sub">Per-vehicle telemetry &amp; diagnostics</div>
      </div>

      <Card>
        <table className="table">
          <thead>
            <tr>
              <th>Vehicle</th><th>AV state</th><th>Battery</th><th>Zone</th><th>Speed</th><th>Location</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>JÖP-01</strong>
                <div className="text-xs muted mono-id">{vehicleId}</div>
              </td>
              <td><Badge tone={isLatched ? 'danger' : vehicleStateTone(t?.vehicleState)}>{t?.vehicleState ?? '—'}</Badge></td>
              <td>{t ? `${t.battery.percent.toFixed(1)}%` : '—'}</td>
              <td>{t?.currentZone ?? '—'}</td>
              <td>{t ? `${t.speedKmh.toFixed(1)} km/h` : '—'}</td>
              <td className="text-xs mono-id">{t ? `${t.location.lat.toFixed(5)}, ${t.location.lng.toFixed(5)}` : '—'}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      {t && (
        <div className="grid grid-2" style={{ marginTop: 'var(--sp-5)' }}>
          <Card>
            <CardHeader title="Sensors" />
            <div className="card-pad">
              {t.sensors.map(s => (
                <div className="list-row" key={s.id}>
                  <Badge tone={s.status === 'OK' ? 'success' : s.status === 'DEGRADED' ? 'warning' : 'danger'} dot={false}>{s.status}</Badge>
                  <span className="grow">{s.id}</span>
                  <span className="text-xs muted">{s.type}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Compute health" />
            <div className="card-pad">
              <div className="kv"><span>CPU</span><strong>{t.computeHealth.cpuPercent.toFixed(0)}%</strong></div>
              <Progress value={t.computeHealth.cpuPercent} tone={t.computeHealth.cpuPercent > 80 ? 'var(--color-danger)' : 'var(--color-info)'} />
              <div className="kv" style={{ marginTop: 10 }}><span>RAM</span><strong>{t.computeHealth.ramPercent.toFixed(0)}%</strong></div>
              <Progress value={t.computeHealth.ramPercent} tone={t.computeHealth.ramPercent > 80 ? 'var(--color-danger)' : 'var(--color-info)'} />
              <div className="kv" style={{ marginTop: 10 }}><span>Temperature</span><strong>{t.computeHealth.temperatureC.toFixed(0)}°C</strong></div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
