import { Card, CardHeader, StatCard, Badge, Button, vehicleStateTone, missionTone } from '../components/ui';
import { useSession } from '../context/SessionContext';

export function Dashboard() {
  const {
    telemetry: t, connection, hasControl, operatorId,
    mission, checkItems, createMission, setCheckItem, confirmAndStart, missionAction, dismissMission,
  } = useSession();

  const allChecked = checkItems.length > 0 && checkItems.every(i => i.status !== 'PENDING');
  const criticalFail = checkItems.some(i => i.safetyCritical && i.status === 'FAIL');

  return (
    <div className="page">
      <div className="page-head">
        <div className="page-title">Operations Dashboard</div>
        <div className="page-sub">Fleet monitoring & live status</div>
      </div>

      <div className="grid grid-3" style={{ marginBottom: 'var(--sp-5)' }}>
        <Card>
          <CardHeader title="Vehicle status" action={<Badge tone={vehicleStateTone(t?.vehicleState)}>{t?.vehicleState ?? 'N/A'}</Badge>} />
          <div className="card-pad row gap-4">
            <StatCard value={t ? t.speedKmh.toFixed(1) : '—'} label="km/h" tone="var(--color-info)" />
            <StatCard value={t ? `${t.battery.percent.toFixed(0)}%` : '—'} label="Battery" tone="var(--color-success)" />
          </div>
        </Card>

        <Card>
          <CardHeader title="Connection" action={<Badge tone={connection === 'connected' ? 'success' : 'danger'}>{connection}</Badge>} />
          <div className="card-pad">
            <div className="kv"><span>Mode</span><strong>{t?.mode ?? '—'}</strong></div>
            <div className="kv"><span>Zone</span><strong>{t?.currentZone ?? '—'}</strong></div>
            <div className="kv"><span>Operator</span><strong>{hasControl ? operatorId : 'None'}</strong></div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Mission" action={mission ? <Badge tone={missionTone(mission.status)}>{mission.status}</Badge> : undefined} />
          <div className="card-pad">
            {!mission ? (
              <Button variant="success" onClick={createMission}>New mission</Button>
            ) : (
              <>
                <div className="kv"><span>ID</span><strong className="mono-id">{mission.missionId.slice(0, 8)}</strong></div>
                <div className="row gap-2 wrap" style={{ marginTop: 10 }}>
                  {mission.status === 'ACTIVE' && <>
                    <Button size="sm" variant="warning" onClick={() => missionAction('pause')}>Pause</Button>
                    <Button size="sm" onClick={() => missionAction('complete')}>Complete</Button>
                  </>}
                  {mission.status === 'PAUSED' && <Button size="sm" variant="success" onClick={() => missionAction('resume')}>Resume</Button>}
                  {['PENDING', 'PRE_CHECK', 'ACTIVE', 'PAUSED'].includes(mission.status) &&
                    <Button size="sm" variant="danger" onClick={() => missionAction('abort')}>Abort</Button>}
                  {['COMPLETED', 'ABORTED'].includes(mission.status) &&
                    <Button size="sm" variant="ghost" onClick={dismissMission}>Dismiss</Button>}
                </div>
              </>
            )}
          </div>
        </Card>
      </div>

      {mission && ['PRE_CHECK', 'PENDING'].includes(mission.status) && checkItems.length > 0 && (
        <Card>
          <CardHeader title="Pre-departure check (OAD / LEG-03)" action={<Badge tone="warning">Required</Badge>} />
          <div className="card-pad">
            {checkItems.map(item => (
              <div className="list-row" key={item.itemId}>
                <Badge tone={item.status === 'PASS' ? 'success' : item.status === 'FAIL' ? 'danger' : 'warning'} dot={false}>{item.status}</Badge>
                <span className="grow">
                  {item.label}
                  {item.safetyCritical && <span style={{ color: 'var(--color-danger)', marginLeft: 4 }}>*</span>}
                </span>
                <span className="text-xs muted">{item.source}</span>
                {item.status === 'PENDING' && (
                  <div className="row gap-1">
                    <Button size="sm" variant="success" onClick={() => setCheckItem(item.itemId, 'PASS')}>Pass</Button>
                    <Button size="sm" variant="danger" onClick={() => setCheckItem(item.itemId, 'FAIL')}>Fail</Button>
                  </div>
                )}
              </div>
            ))}
            <div className="row between" style={{ marginTop: 14 }}>
              <span className="text-xs muted">* Safety-critical — must pass to confirm</span>
              {allChecked && !criticalFail && <Button onClick={confirmAndStart}>Confirm &amp; start mission</Button>}
              {criticalFail && <span className="text-sm" style={{ color: 'var(--color-danger)', fontWeight: 700 }}>Safety-critical item failed — cannot proceed</span>}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
