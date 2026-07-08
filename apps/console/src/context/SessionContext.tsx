import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { TelemetryPayload, ManeuverProposal, ManeuverProposalStatusUpdate, CheckItem } from '@joppilot/contract';

const COMMAND_API = 'http://127.0.0.1:4000';
const FLEET_API = 'http://127.0.0.1:4002';
const TELEMETRY_WS = 'http://localhost:4001';
const COMMAND_WS = 'http://localhost:4000';

export type ConnState = 'connecting' | 'connected' | 'disconnected';

export interface MissionState {
  missionId: string;
  status: string;
  checklistId?: string;
}

interface SessionValue {
  vehicleId: string;
  operatorId: string;
  token: string | null;
  hasControl: boolean;
  connection: ConnState;
  telemetry: TelemetryPayload | null;
  isLatched: boolean;

  activeProposal: ManeuverProposal | null;
  proposalTimeLeft: number;
  lastProposalResult: string | null;

  mission: MissionState | null;
  checkItems: CheckItem[];

  // actions
  takeControl: () => Promise<void>;
  cmdPost: (path: string, body?: object) => Promise<any>;
  estop: () => void;
  decideManeuver: (decision: 'CONFIRM' | 'REJECT' | 'SELECT_ALTERNATIVE', optionId?: string) => Promise<void>;
  createMission: () => Promise<void>;
  setCheckItem: (itemId: string, status: 'PASS' | 'FAIL') => Promise<void>;
  confirmAndStart: () => Promise<void>;
  missionAction: (action: string) => Promise<void>;
  dismissMission: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within <SessionProvider>');
  return ctx;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const vehicleId = 'VEH-001';
  const [operatorId] = useState(`OP-${Math.floor(Math.random() * 1000)}`);
  const [token, setToken] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnState>('connecting');
  const [telemetry, setTelemetry] = useState<TelemetryPayload | null>(null);

  const [activeProposal, setActiveProposal] = useState<ManeuverProposal | null>(null);
  const [proposalTimeLeft, setProposalTimeLeft] = useState(0);
  const [lastProposalResult, setLastProposalResult] = useState<string | null>(null);

  const [mission, setMission] = useState<MissionState | null>(null);
  const [checkItems, setCheckItems] = useState<CheckItem[]>([]);

  const heartbeatRef = useRef<number | null>(null);
  const proposalTimerRef = useRef<number | null>(null);
  const proposalDeadlineRef = useRef(0);

  // ── Sockets ──
  useEffect(() => {
    const telSock: Socket = io(TELEMETRY_WS);
    const cmdSock: Socket = io(COMMAND_WS);
    telSock.on('connect', () => setConnection('connected'));
    telSock.on('disconnect', () => setConnection('disconnected'));
    telSock.on('connect_error', () => setConnection('disconnected'));
    telSock.on(`telemetry/${vehicleId}`, (p: TelemetryPayload) => setTelemetry(p));

    cmdSock.on(`maneuver/proposal/${vehicleId}`, (p: ManeuverProposal) => {
      setActiveProposal(p);
      setLastProposalResult(null);
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
        setLastProposalResult(
          u.status === 'TIMED_OUT'
            ? `Timed out → safe default (${u.selectedOptionId})`
            : `${u.status} (${u.selectedOptionId ?? 'rejected'})`,
        );
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
          const r = await fetch(`${COMMAND_API}/api/command/${vehicleId}/heartbeat`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operatorId, token }),
          });
          const d = await r.json();
          if (d.status === 'deadman_triggered') { setToken(null); clearInterval(heartbeatRef.current!); }
        } catch { /* ignore transient */ }
      }, 2000);
    } else if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
    }
    return () => { if (heartbeatRef.current) clearInterval(heartbeatRef.current); };
  }, [token, operatorId, vehicleId]);

  // ── API helpers ──
  const cmdPost = useCallback(async (path: string, body: object = {}) => {
    if (!token) return null;
    const r = await fetch(`${COMMAND_API}/api/command/${vehicleId}/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId, token, ...body }),
    });
    if (r.status === 401) { setToken(null); return null; }
    return r.json();
  }, [token, operatorId, vehicleId]);

  const fleetPost = useCallback(async (path: string, body?: object) => {
    try {
      const r = await fetch(`${FLEET_API}/api/fleet${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : '{}',
      });
      return r.ok ? r.json() : null;
    } catch { return null; }
  }, []);

  const fleetGet = useCallback(async (path: string) => {
    try { const r = await fetch(`${FLEET_API}/api/fleet${path}`); return r.ok ? r.json() : null; }
    catch { return null; }
  }, []);

  const takeControl = useCallback(async () => {
    const r = await fetch(`${COMMAND_API}/api/command/${vehicleId}/take-control`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId }),
    });
    if (r.ok) { const d = await r.json(); setToken(d.token); }
  }, [operatorId, vehicleId]);

  const estop = useCallback(() => { cmdPost('estop'); }, [cmdPost]);

  const decideManeuver = useCallback(async (decision: 'CONFIRM' | 'REJECT' | 'SELECT_ALTERNATIVE', optionId?: string) => {
    if (!activeProposal || !token) return;
    await fetch(`${COMMAND_API}/api/maneuver/${activeProposal.proposalId}/decide`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operatorId, token, decision, optionId }),
    });
  }, [activeProposal, token, operatorId]);

  // ── Mission ──
  const createMission = useCallback(async () => {
    const d = await fleetPost(`/${vehicleId}/mission`);
    if (!d?.mission) return;
    setMission({ missionId: d.mission.id, status: d.mission.status, checklistId: d.checklist?.checklistId });
    setCheckItems(d.checklist?.items || []);
  }, [fleetPost, vehicleId]);

  const setCheckItem = useCallback(async (itemId: string, status: 'PASS' | 'FAIL') => {
    if (!mission?.checklistId) return;
    const d = await fleetPost(`/pre-departure/${mission.checklistId}/item/${itemId}`, { status });
    if (d?.items) setCheckItems(d.items);
  }, [fleetPost, mission]);

  const confirmAndStart = useCallback(async () => {
    if (!mission?.checklistId) return;
    const hasPending = checkItems.some(i => i.status === 'PENDING');
    const hasCriticalFail = checkItems.some(i => i.safetyCritical && i.status === 'FAIL');
    if (hasPending || hasCriticalFail) return;
    const confirmed = await fleetPost(`/pre-departure/${mission.checklistId}/confirm`, { operatorId });
    if (!confirmed) return;
    const d = await fleetPost(`/mission/${mission.missionId}/start`);
    if (d?.status) setMission(prev => (prev ? { ...prev, status: d.status } : null));
  }, [fleetPost, mission, checkItems, operatorId]);

  const missionAction = useCallback(async (action: string) => {
    if (!mission) return;
    const d = await fleetPost(`/mission/${mission.missionId}/${action}`);
    if (d?.status) setMission(prev => (prev ? { ...prev, status: d.status } : null));
  }, [fleetPost, mission]);

  const dismissMission = useCallback(() => { setMission(null); setCheckItems([]); }, []);

  // Load active mission on mount
  useEffect(() => {
    fleetGet(`/${vehicleId}/mission`).then(d => {
      if (d?.id) {
        setMission({ missionId: d.id, status: d.status, checklistId: d.checklistId });
        if (d.checklist?.items) setCheckItems(d.checklist.items);
      }
    });
  }, [fleetGet, vehicleId]);

  // ── E-STOP keyboard (ACC-04) ──
  // Space is also the standard activation key for a focused control. The
  // global shortcut therefore fires only from NON-interactive context —
  // otherwise Space on e.g. a focused "Throttle" button would be swallowed
  // and fire E-STOP instead, breaking full keyboard operability (ACC-04)
  // and turning routine keyboard use into accidental emergency stops.
  useEffect(() => {
    const INTERACTIVE = ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'];
    const h = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !token) return;
      const el = e.target as HTMLElement | null;
      if (el && (INTERACTIVE.includes(el.tagName) || el.isContentEditable)) return;
      e.preventDefault();
      cmdPost('estop');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [token, cmdPost]);

  const value: SessionValue = {
    vehicleId, operatorId, token, hasControl: !!token, connection, telemetry,
    isLatched: telemetry?.vehicleState === 'SAFE_STOPPED',
    activeProposal, proposalTimeLeft, lastProposalResult,
    mission, checkItems,
    takeControl, cmdPost, estop, decideManeuver,
    createMission, setCheckItem, confirmAndStart, missionAction, dismissMission,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
