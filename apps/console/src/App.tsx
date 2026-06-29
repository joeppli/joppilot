import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { TelemetryPayload, ManeuverProposal, ManeuverProposalStatusUpdate, CheckItem } from '@joppilot/contract';
import VehicleMap from './VehicleMap';
import './app.css';

type Page = 'dashboard' | 'map' | 'vehicle' | 'operations';

interface MissionState {
  missionId: string;
  status: string;
  checklistId?: string;
}

function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [telemetry, setTelemetry] = useState<TelemetryPayload | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [operatorId] = useState(`OP-${Math.floor(Math.random() * 1000)}`);
  const [token, setToken] = useState<string | null>(null);
  const [activeProposal, setActiveProposal] = useState<ManeuverProposal | null>(null);
  const [proposalTimeLeft, setProposalTimeLeft] = useState(0);
  const [lastProposalResult, setLastProposalResult] = useState<string | null>(null);
  const [mission, setMission] = useState<MissionState | null>(null);
  const [checkItems, setCheckItems] = useState<CheckItem[]>([]);

  const vehicleId = 'VEH-001';
  const heartbeatRef = useRef<number | null>(null);
  const proposalTimerRef = useRef<number | null>(null);
  const proposalDeadlineRef = useRef(0);

  // ── Socket connections ──
  useEffect(() => {
    const telSock: Socket = io('http://localhost:4001');
    const cmdSock: Socket = io('http://localhost:4000');
    telSock.on('connect', () => setConnectionStatus('connected'));
    telSock.on('disconnect', () => setConnectionStatus('disconnected'));
    telSock.on('connect_error', () => setConnectionStatus('disconnected'));
    telSock.on(`telemetry/${vehicleId}`, (p: TelemetryPayload) => setTelemetry(p));
    cmdSock.on(`maneuver/proposal/${vehicleId}`, (p: ManeuverProposal) => {
      setActiveProposal(p); setLastProposalResult(null);
      proposalDeadlineRef.current = Date.now() + p.validityWindowMs;
      if (proposalTimerRef.current) clearInterval(proposalTimerRef.current);
      proposalTimerRef.current = window.setInterval(() => {
        const r = Math.max(0, proposalDeadlineRef.current - Date.now());
        setProposalTimeLeft(r);
        if (r <= 0 && proposalTimerRef.current) clearInterval(proposalTimerRef.current);
      }, 200);
    });
    cmdSock.on(`maneuver/status/${vehicleId}`, (u: ManeuverProposalStatusUpdate) => {
      if (['DECIDED', 'TIMED_OUT', 'CANCELLED'].includes(u.status)) {
        setActiveProposal(null);
        if (proposalTimerRef.current) clearInterval(proposalTimerRef.current);
        setLastProposalResult(u.status === 'TIMED_OUT' ? `Timed out → safe default (${u.selectedOptionId})` : `${u.status} (${u.selectedOptionId ?? 'rejected'})`);
        setTimeout(() => setLastProposalResult(null), 8000);
      }
    });
    return () => { telSock.disconnect(); cmdSock.disconnect(); };
  }, [vehicleId]);

  // ── Heartbeat (deadman) ──
  useEffect(() => {
    if (token) {
      heartbeatRef.current = window.setInterval(async () => {
        try {
          const r = await fetch(`http://127.0.0.1:4000/api/command/${vehicleId}/heartbeat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operatorId, token }) });
          const d = await r.json();
          if (d.status === 'deadman_triggered') { setToken(null); clearInterval(heartbeatRef.current!); }
        } catch {}
      }, 2000);
    } else if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    return () => { if (heartbeatRef.current) clearInterval(heartbeatRef.current); };
  }, [token, operatorId, vehicleId]);

  // ── API helpers ──
  const cmdPost = async (path: string, body: object = {}) => {
    if (!token) return null;
    const r = await fetch(`http://127.0.0.1:4000/api/command/${vehicleId}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operatorId, token, ...body }) });
    if (r.status === 401) { setToken(null); return null; }
    return r.json();
  };
  const fleetPost = async (path: string, body?: object) => {
    try {
      const r = await fetch(`http://127.0.0.1:4002/api/fleet${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : '{}' });
      if (!r.ok) return null;
      return r.json();
    } catch { return null; }
  };
  const fleetGet = async (path: string) => { try { const r = await fetch(`http://127.0.0.1:4002/api/fleet${path}`); return r.ok ? r.json() : null; } catch { return null; } };

  const handleTakeControl = async () => {
    const r = await fetch(`http://127.0.0.1:4000/api/command/${vehicleId}/take-control`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operatorId }) });
    if (r.ok) { const d = await r.json(); setToken(d.token); }
  };

  const handleManeuverDecision = useCallback(async (decision: 'CONFIRM' | 'REJECT' | 'SELECT_ALTERNATIVE', optionId?: string) => {
    if (!activeProposal || !token) return;
    await fetch(`http://127.0.0.1:4000/api/maneuver/${activeProposal.proposalId}/decide`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operatorId, token, decision, optionId }) });
  }, [activeProposal, token, operatorId]);

  // ── Mission helpers ──
  const handleCreateMission = async () => {
    const d = await fleetPost(`/${vehicleId}/mission`);
    if (!d?.mission) return;
    setMission({ missionId: d.mission.id, status: d.mission.status, checklistId: d.checklist?.checklistId });
    setCheckItems(d.checklist?.items || []);
  };
  const handleCheckItem = async (itemId: string, status: 'PASS' | 'FAIL') => {
    if (!mission?.checklistId) return;
    const d = await fleetPost(`/pre-departure/${mission.checklistId}/item/${itemId}`, { status });
    if (d?.items) setCheckItems(d.items);
  };
  const handleConfirmAndStart = async () => {
    if (!mission?.checklistId) return;
    const hasPending = checkItems.some(i => i.status === 'PENDING');
    const hasCriticalFail = checkItems.some(i => i.safetyCritical && i.status === 'FAIL');
    if (hasPending || hasCriticalFail) return;
    const confirmed = await fleetPost(`/pre-departure/${mission.checklistId}/confirm`, { operatorId });
    if (!confirmed) return;
    const d = await fleetPost(`/mission/${mission.missionId}/start`);
    if (d?.status) setMission(prev => prev ? { ...prev, status: d.status } : null);
  };
  const handleMissionAction = async (action: string) => {
    if (!mission) return;
    const d = await fleetPost(`/mission/${mission.missionId}/${action}`);
    if (d?.status) setMission(prev => prev ? { ...prev, status: d.status } : null);
  };

  useEffect(() => { fleetGet(`/${vehicleId}/mission`).then(d => { if (d?.id) { setMission({ missionId: d.id, status: d.status, checklistId: d.checklistId }); if (d.checklist?.items) setCheckItems(d.checklist.items); } }); }, [vehicleId]);

  // ── E-STOP keyboard ──
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.code === 'Space' && token) { e.preventDefault(); cmdPost('estop'); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [token, operatorId, vehicleId]);

  const isLatched = telemetry?.vehicleState === 'SAFE_STOPPED';
  const t = telemetry;

  // ── RENDER ──
  return (
    <div className="layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <h2><span className="logo">J</span>Jöppli x ERZ</h2>
          <span>Stadt Zürich</span>
        </div>
        <nav className="sidebar-nav">
          {([
            ['dashboard', '📊', 'Dashboard'],
            ['map', '🗺️', 'Map & Dispatch'],
            ['vehicle', '🚛', 'Vehicle'],
            ['operations', '🎮', 'Remote Operations'],
          ] as [Page, string, string][]).map(([id, icon, label]) => (
            <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}>
              <span className="icon">{icon}</span>{label}
            </button>
          ))}
        </nav>
        <div className="sidebar-status">
          <span className={`dot ${connectionStatus === 'connected' ? 'online' : 'offline'}`} />
          <span style={{ fontSize: 12 }}>{connectionStatus === 'connected' ? 'Live' : connectionStatus === 'connecting' ? 'Connecting...' : 'Offline'}</span>
        </div>
      </aside>

      {/* Main */}
      <div className="main">
        <header className="header">
          <span className="header-left">Jöppli x ERZ · Operator Console</span>
          <div className="header-user">
            {!token ? (
              <button className="btn btn-primary btn-sm" onClick={handleTakeControl}>Take Control</button>
            ) : (
              <span className="badge badge-success">ACTIVE — {operatorId}</span>
            )}
            <div className="avatar">{operatorId.slice(0, 2)}</div>
          </div>
        </header>

        {/* ── Alerts (always visible) ── */}
        <div style={{ padding: '16px 28px 0' }}>
          {isLatched && token && (
            <div className="alert alert-danger">
              <div><strong>Vehicle is in SAFE-STOP (latched)</strong><br /><span style={{ fontSize: 13 }}>Release the latch to resume operations.</span></div>
              <button className="btn btn-danger" onClick={() => cmdPost('clear-safe-stop')}>CLEAR SAFE-STOP</button>
            </div>
          )}
          {activeProposal && (
            <div className={`maneuver-card ${proposalTimeLeft < 5000 ? 'urgent' : ''}`} role="alert">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>Maneuver Proposal</div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{activeProposal.reasonCode} — {activeProposal.context.sceneSummary}</div>
                </div>
                <span className="maneuver-timer" style={{ color: proposalTimeLeft < 5000 ? 'var(--danger)' : 'var(--warning)' }}>{Math.ceil(proposalTimeLeft / 1000)}s</span>
              </div>
              {activeProposal.options.map(opt => (
                <button key={opt.optionId} className={`maneuver-option ${opt.optionId === activeProposal.defaultOnTimeout ? 'default' : ''}`}
                  disabled={!token} onClick={() => handleManeuverDecision('SELECT_ALTERNATIVE', opt.optionId)}>
                  <div style={{ fontWeight: 600 }}>{opt.description}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{opt.expectedResult}</div>
                  {opt.optionId === activeProposal.defaultOnTimeout && <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 2 }}>Safe default on timeout</div>}
                </button>
              ))}
              <button className="btn btn-ghost btn-sm" disabled={!token} onClick={() => handleManeuverDecision('REJECT')} style={{ marginTop: 4 }}>Reject Proposal</button>
            </div>
          )}
          {lastProposalResult && <div className="alert alert-info" style={{ fontSize: 13 }}>Last proposal: {lastProposalResult}</div>}
        </div>

        {/* ── PAGE: Dashboard ── */}
        {page === 'dashboard' && (
          <div className="page">
            <div className="page-title">Operations Dashboard</div>
            <div className="page-subtitle">Fleet monitoring & status</div>
            <div className="cards">
              <div className="card">
                <div className="card-header"><span className="card-title">Vehicle Status</span><span className={`badge ${isLatched ? 'badge-danger' : 'badge-success'}`}>{t?.vehicleState ?? 'N/A'}</span></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div><div className="card-value" style={{ color: 'var(--info)' }}>{t?.speedKmh.toFixed(1) ?? '—'}</div><div className="card-label">km/h</div></div>
                  <div><div className="card-value" style={{ color: 'var(--success)' }}>{t?.battery.percent.toFixed(0) ?? '—'}%</div><div className="card-label">Battery</div></div>
                </div>
              </div>
              <div className="card">
                <div className="card-header"><span className="card-title">Connection</span><span className={`badge ${connectionStatus === 'connected' ? 'badge-success' : 'badge-danger'}`}>{connectionStatus}</span></div>
                <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                  <p>Mode: <strong>{t?.mode ?? '—'}</strong></p>
                  <p>Zone: <strong>{t?.currentZone ?? '—'}</strong></p>
                  <p>Operator: <strong>{token ? operatorId : 'None'}</strong></p>
                </div>
              </div>
              <div className="card">
                <div className="card-header"><span className="card-title">Mission</span>{mission && <span className={`badge ${mission.status === 'ACTIVE' ? 'badge-success' : mission.status === 'COMPLETED' ? 'badge-info' : 'badge-warning'}`}>{mission.status}</span>}</div>
                {!mission ? (
                  <button className="btn btn-success" onClick={handleCreateMission}>New Mission</button>
                ) : (
                  <div style={{ fontSize: 13 }}>
                    <p>ID: {mission.missionId.slice(0, 8)}...</p>
                    <div className="btn-group" style={{ marginTop: 8 }}>
                      {mission.status === 'ACTIVE' && <><button className="btn btn-warning btn-sm" onClick={() => handleMissionAction('pause')}>Pause</button><button className="btn btn-primary btn-sm" onClick={() => handleMissionAction('complete')}>Complete</button></>}
                      {mission.status === 'PAUSED' && <button className="btn btn-success btn-sm" onClick={() => handleMissionAction('resume')}>Resume</button>}
                      {['PENDING', 'PRE_CHECK', 'ACTIVE', 'PAUSED'].includes(mission.status) && <button className="btn btn-danger btn-sm" onClick={() => handleMissionAction('abort')}>Abort</button>}
                      {['COMPLETED', 'ABORTED'].includes(mission.status) && <button className="btn btn-ghost btn-sm" onClick={() => { setMission(null); setCheckItems([]); }}>Dismiss</button>}
                    </div>
                  </div>
                )}
              </div>
            </div>
            {/* Pre-departure checklist */}
            {mission && ['PRE_CHECK', 'PENDING'].includes(mission.status) && checkItems.length > 0 && (
              <div className="card card-full">
                <div className="card-header"><span className="card-title">Pre-departure Check (OAD)</span><span className="badge badge-warning">REQUIRED</span></div>
                {checkItems.map(item => (
                  <div className="check-item" key={item.itemId}>
                    <span className={`badge ${item.status === 'PASS' ? 'badge-success' : item.status === 'FAIL' ? 'badge-danger' : 'badge-warning'}`} style={{ width: 60, textAlign: 'center' }}>{item.status}</span>
                    <span style={{ flex: 1 }}>{item.label}{item.safetyCritical && <span style={{ color: 'var(--danger)', marginLeft: 4 }}>*</span>}</span>
                    <span className="source">{item.source}</span>
                    {item.status === 'PENDING' && (
                      <div className="btn-group">
                        <button className="btn btn-success btn-sm" onClick={() => handleCheckItem(item.itemId, 'PASS')}>Pass</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleCheckItem(item.itemId, 'FAIL')}>Fail</button>
                      </div>
                    )}
                  </div>
                ))}
                <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>* Safety-critical — must pass</span>
                  {checkItems.every(i => i.status !== 'PENDING') && !checkItems.some(i => i.safetyCritical && i.status === 'FAIL') && (
                    <button className="btn btn-primary" onClick={handleConfirmAndStart}>Confirm & Start Mission</button>
                  )}
                  {checkItems.some(i => i.safetyCritical && i.status === 'FAIL') && (
                    <span style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 13 }}>Safety-critical item failed — cannot proceed</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PAGE: Map ── */}
        {page === 'map' && (
          <div className="map-layout">
            <div className="map-sidebar">
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary btn-sm">Fleet</button>
                  <button className="btn btn-ghost btn-sm">Tasks</button>
                </div>
              </div>
              <div className="vehicle-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <strong style={{ fontSize: 14 }}>JÖP-01</strong>
                  <span className={`badge ${isLatched ? 'badge-danger' : t?.vehicleState === 'IDLE' ? 'badge-neutral' : 'badge-success'}`}>{t?.vehicleState ?? 'N/A'}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span>Battery</span><strong>{t?.battery.percent.toFixed(1)}%</strong>
                  </div>
                  <div className="progress"><div className="progress-fill" style={{ width: `${t?.battery.percent ?? 0}%`, backgroundColor: (t?.battery.percent ?? 0) > 20 ? 'var(--success)' : 'var(--danger)' }} /></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                    <span>Speed</span><strong>{t?.speedKmh.toFixed(1)} km/h</strong>
                  </div>
                </div>
              </div>
            </div>
            <div className="map-content">
              {t ? <VehicleMap lat={t.location.lat} lng={t.location.lng} vehicleState={t.vehicleState} speedKmh={t.speedKmh} zone={t.currentZone ?? 'unknown'} /> : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>Waiting for telemetry...</div>}
            </div>
          </div>
        )}

        {/* ── PAGE: Vehicle ── */}
        {page === 'vehicle' && (
          <div className="page">
            <div className="page-title">Fleet Vehicles & Health</div>
            <div className="page-subtitle">Vehicle telemetry & diagnostics</div>
            <div className="card card-full">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 12px', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Vehicle Info</th>
                    <th style={{ padding: '8px 12px', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>AV State</th>
                    <th style={{ padding: '8px 12px', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Battery</th>
                    <th style={{ padding: '8px 12px', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Zone</th>
                    <th style={{ padding: '8px 12px', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Speed</th>
                    <th style={{ padding: '8px 12px', color: 'var(--text-secondary)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>Location</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px' }}><strong>JÖP-01</strong><br /><span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>ID: {vehicleId}</span></td>
                    <td style={{ padding: '12px' }}><span className={`badge ${isLatched ? 'badge-danger' : t?.vehicleState === 'IDLE' ? 'badge-neutral' : 'badge-success'}`}>{t?.vehicleState ?? '—'}</span></td>
                    <td style={{ padding: '12px' }}>{t?.battery.percent.toFixed(1)}%</td>
                    <td style={{ padding: '12px' }}>{t?.currentZone ?? '—'}</td>
                    <td style={{ padding: '12px' }}>{t?.speedKmh.toFixed(1)} km/h</td>
                    <td style={{ padding: '12px', fontSize: 11 }}>{t?.location.lat.toFixed(5)}, {t?.location.lng.toFixed(5)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {t && (
              <div className="cards" style={{ marginTop: 20 }}>
                <div className="card">
                  <div className="card-title" style={{ marginBottom: 12 }}>Sensors</div>
                  {t.sensors.map(s => (
                    <div className="row-item" key={s.id}>
                      <span className={`badge ${s.status === 'OK' ? 'badge-success' : s.status === 'DEGRADED' ? 'badge-warning' : 'badge-danger'}`} style={{ width: 70, textAlign: 'center' }}>{s.status}</span>
                      <span>{s.id}</span><span className="source">{s.type}</span>
                    </div>
                  ))}
                </div>
                <div className="card">
                  <div className="card-title" style={{ marginBottom: 12 }}>Compute</div>
                  <div style={{ fontSize: 13 }}>
                    <p>CPU: <strong>{t.computeHealth.cpuPercent.toFixed(0)}%</strong></p>
                    <div className="progress"><div className="progress-fill" style={{ width: `${t.computeHealth.cpuPercent}%`, backgroundColor: t.computeHealth.cpuPercent > 80 ? 'var(--danger)' : 'var(--info)' }} /></div>
                    <p style={{ marginTop: 10 }}>RAM: <strong>{t.computeHealth.ramPercent.toFixed(0)}%</strong></p>
                    <div className="progress"><div className="progress-fill" style={{ width: `${t.computeHealth.ramPercent}%`, backgroundColor: t.computeHealth.ramPercent > 80 ? 'var(--danger)' : 'var(--info)' }} /></div>
                    <p style={{ marginTop: 10 }}>Temp: <strong>{t.computeHealth.temperatureC.toFixed(0)}°C</strong></p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PAGE: Operations ── */}
        {page === 'operations' && (
          <div className="page">
            <div className="page-title">Remote Operations & Safety</div>
            <div className="page-subtitle">OAD Mode 1 Supervision · Vehicle Control · Session</div>
            <div className="cards">
              <div className="card">
                <div className="card-title" style={{ marginBottom: 16 }}>Emergency Controls</div>
                <div className="btn-group" style={{ flexDirection: 'column' }}>
                  <button className="btn-estop" disabled={!token} onClick={() => cmdPost('estop')} aria-label="Emergency Stop (Spacebar)">E-STOP</button>
                  <button className="btn btn-warning" disabled={!token} onClick={() => cmdPost('command', { payload: { action: 'SAFE_STOP' } })}>Safe Stop</button>
                  <button className="btn btn-ghost" disabled={!token} onClick={() => cmdPost('clear-safe-stop')}>Clear Safe-Stop Latch</button>
                </div>
                <p style={{ marginTop: 12, fontSize: 11, color: 'var(--text-secondary)' }}>Keyboard: Spacebar = E-STOP</p>
              </div>
              <div className="card">
                <div className="card-title" style={{ marginBottom: 16 }}>Mode 2 Commands</div>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>Direct driving (depot/private zone only)</p>
                <div className="btn-group" style={{ flexWrap: 'wrap' }}>
                  <button className="btn btn-primary btn-sm" disabled={!token} onClick={() => cmdPost('command', { payload: { action: 'STEER', angle: -5 } })}>Steer Left</button>
                  <button className="btn btn-primary btn-sm" disabled={!token} onClick={() => cmdPost('command', { payload: { action: 'STEER', angle: 5 } })}>Steer Right</button>
                  <button className="btn btn-primary btn-sm" disabled={!token} onClick={() => cmdPost('command', { payload: { action: 'DRIVE', throttle: 20, brake: 0 } })}>Throttle</button>
                  <button className="btn btn-primary btn-sm" disabled={!token} onClick={() => cmdPost('command', { payload: { action: 'DRIVE', throttle: 0, brake: 50 } })}>Brake</button>
                  <button className="btn btn-ghost btn-sm" disabled={!token} onClick={() => cmdPost('command', { payload: { action: 'HORN', durationMs: 500 } })}>Horn</button>
                  <button className="btn btn-ghost btn-sm" disabled={!token} onClick={() => cmdPost('command', { payload: { action: 'LIGHTS', state: 'HAZARD' } })}>Hazard</button>
                </div>
              </div>
              <div className="card">
                <div className="card-title" style={{ marginBottom: 16 }}>Session Info</div>
                <div style={{ fontSize: 13 }}>
                  <p>Operator: <strong>{operatorId}</strong></p>
                  <p>Control: <strong style={{ color: token ? 'var(--success)' : 'var(--danger)' }}>{token ? 'ACTIVE' : 'NONE'}</strong></p>
                  <p>Vehicle: <strong>{vehicleId}</strong></p>
                  <p>Mode: <strong>{t?.mode ?? '—'}</strong></p>
                  <p>Zone: <strong>{t?.currentZone ?? '—'}</strong></p>
                </div>
                {!token && <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={handleTakeControl}>Take Control</button>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
