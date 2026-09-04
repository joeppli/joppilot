import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { TelemetryPayload, ManeuverProposal, ManeuverProposalStatusUpdate, CheckItem } from '@joppilot/contract';
import { awsConfig } from '../aws/config';
import { getTokens, getUsername } from '../aws/auth';
import { useCloudTelemetry, CloudState } from '../aws/useCloudTelemetry';
import { useMode } from '../mode/ModeContext';
import { entryStrings as strings, fmt } from '../mode/strings';
import { useDemoVehicle } from '../demo/simulator';

const TELEMETRY_WS = 'http://localhost:4001';
const COMMAND_WS = 'http://localhost:4000';

// M3-4c: where the command / maneuver / fleet REST calls go.
//
// An OPERATOR session sends everything through the ONE API Gateway (it
// path-routes /api/command, /api/maneuver and /api/fleet). A LOCAL developer
// session talks to the services running on this machine. A DEMO session sends
// nothing anywhere.
//
// The localhost addresses below are NOT a fallback for an operator session.
// They used to be — `cloudApi ?? 'http://127.0.0.1:4000'` — and on the
// deployed page that meant an operator whose build carried no
// VITE_AWS_API_ENDPOINT silently aimed every command at 127.0.0.1, i.e. at
// whatever is listening on the OPERATOR'S OWN machine (plus a browser
// local-network permission prompt). The endpoint is therefore chosen by MODE:
// an operator session without a cloud API has no command endpoint at all, its
// command calls are no-ops, and the UI says so rather than failing silently.
const cloudApi = awsConfig?.apiEndpoint;
const LOCAL_COMMAND_API = 'http://127.0.0.1:4000';
const LOCAL_FLEET_API = 'http://127.0.0.1:4002';

/**
 * JSON headers + the Cognito Bearer token when driving the cloud (M3-4c).
 *
 * `toCloud` gates the Authorization header rather than a module-level flag: a
 * local dev service has no JWT authorizer, and attaching an operator's ID
 * token to a 127.0.0.1 request would hand a real credential to whatever is
 * listening there.
 */
function apiHeaders(toCloud: boolean): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (toCloud) {
    const t = getTokens();
    // Send the ID token: the API Gateway JWT authorizer checks `aud` (= client
    // id), which access tokens lack, and the services read cognito:groups /
    // cognito:username from it (RBAC + identity binding).
    if (t) h['Authorization'] = `Bearer ${t.idToken}`;
  }
  return h;
}

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

  /**
   * True when this session can display the console but cannot SEND anything:
   * an operator session on a deployment whose build has no API Gateway URL.
   * The UI must say so — silently dead buttons are worse than absent ones.
   */
  commandsDisabled: boolean;

  // M3-4b cloud mode (live WSS from IoT Core; 'off' when not configured)
  cloudState: CloudState;
  cloudSignIn: () => void;
  cloudSignOut: () => void;

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
  // The mode was chosen at the entry gate and decides which data source (if
  // any) this session is allowed to open. 'demo' opens NOTHING: no socket, no
  // fetch, no AWS credential — the simulator is entirely in the browser.
  const { mode } = useMode();
  const isDemo = mode === 'demo';
  const isOperator = mode === 'operator';
  const isLocal = mode === 'local';

  // Endpoints resolved per MODE, not per config presence (see the note above
  // the constants). `undefined` means "this session has nowhere to send a
  // command" and every helper below treats it as a hard stop.
  const commandApi = isOperator ? cloudApi : isLocal ? LOCAL_COMMAND_API : undefined;
  const fleetApi = isOperator ? cloudApi : isLocal ? LOCAL_FLEET_API : undefined;
  const toCloud = isOperator && !!cloudApi;
  const commandsDisabled = isOperator && !cloudApi;

  const vehicleId = 'VEH-001';
  // In cloud-command mode the operatorId MUST equal the signed-in Cognito
  // username (identity binding, LEG-05) — else take-control 403s. Local dev
  // has no identity provider, so a random id is fine there.
  const [operatorId, setOperatorId] = useState(() => (cloudApi && getUsername()) || `OP-${Math.floor(Math.random() * 1000)}`);
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
  // The proposal a status update is about. The status handler is stable (it is
  // wired into three data sources at mount), so it cannot read `activeProposal`
  // from state — but it needs the proposal's OPTIONS to turn the id in the
  // update into a sentence a human can read.
  const activeProposalRef = useRef<ManeuverProposal | null>(null);

  // Shared by BOTH telemetry sources (local Socket.IO / cloud IoT WSS).
  const handleProposal = useCallback((p: ManeuverProposal) => {
    activeProposalRef.current = p;
    setActiveProposal(p);
    setLastProposalResult(null);
    proposalDeadlineRef.current = Date.now() + p.validityWindowMs;
    // Seed the countdown from the proposal itself instead of letting the first
    // interval tick do it 200 ms later: the leftover 0 from the previous
    // proposal made every new card paint once as "0s" — and the card styles
    // itself URGENT below 5 s, so each proposal opened with a red flash.
    setProposalTimeLeft(p.validityWindowMs);
    if (proposalTimerRef.current) clearInterval(proposalTimerRef.current);
    proposalTimerRef.current = window.setInterval(() => {
      const r = Math.max(0, proposalDeadlineRef.current - Date.now());
      setProposalTimeLeft(r);
      if (r <= 0 && proposalTimerRef.current) clearInterval(proposalTimerRef.current);
    }, 200);
  }, []);

  const handleProposalStatus = useCallback((u: ManeuverProposalStatusUpdate) => {
    if (!['DECIDED', 'TIMED_OUT', 'CANCELLED'].includes(u.status)) return;
    const p = activeProposalRef.current;
    activeProposalRef.current = null;
    setActiveProposal(null);
    if (proposalTimerRef.current) clearInterval(proposalTimerRef.current);

    // Report the option by DESCRIPTION. The id is meaningless to the operator
    // and to whoever reads the audit trail later; "opt-3f2a91c4-b" tells them
    // nothing about what the vehicle actually did.
    const option = p?.options.find(o => o.optionId === u.selectedOptionId)?.description ?? u.selectedOptionId;
    setLastProposalResult(
      u.status === 'TIMED_OUT' ? fmt(strings.proposalTimedOut, { option: option ?? '—' })
        : u.status === 'CANCELLED' ? strings.proposalCancelled
          : option ? fmt(strings.proposalDecided, { option })
            : strings.proposalRejected,
    );
    setTimeout(() => setLastProposalResult(null), 8000);
  }, []);

  // The 200 ms countdown outlives the provider otherwise (leaving a session
  // unmounts it), leaving an interval writing into a dead component.
  useEffect(() => () => { if (proposalTimerRef.current) clearInterval(proposalTimerRef.current); }, []);

  // ── Cloud mode (M3-4b): live WSS straight from IoT Core ──
  // Active only when apps/console/.env.local carries the VITE_AWS_* values;
  // read-only by policy — commands still require the local/API command path.
  // Passing null keeps the hook fully inert — no Cognito exchange, no identity
  // credentials, no WSS dial. Demo and local sessions never reach AWS.
  const cloud = useCloudTelemetry(isOperator ? awsConfig : null, vehicleId, {
    // debug-level tap of every received sample (visible via the DevTools
    // "Verbose" filter): stream anomalies — like the M3-4b duplicate-publisher
    // hunt — are diagnosed by READING what actually arrives, not guessing.
    onTelemetry: (p) => {
      const t = p as TelemetryPayload;
      console.debug('[cloud-telemetry]', t.location.lat.toFixed(6), t.location.lng.toFixed(6), t.vehicleState, 'ts=' + t.timestamp);
      setTelemetry(t);
    },
    onHeartbeat: () => {}, // latch state arrives via telemetry.vehicleState
    onProposal: (p) => handleProposal(p as ManeuverProposal),
    onStatus: (u) => handleProposalStatus(u as ManeuverProposalStatusUpdate),
  });

  useEffect(() => {
    if (!isOperator || !awsConfig) return;
    setConnection(cloud.state === 'live' ? 'connected' : cloud.state === 'connecting' ? 'connecting' : 'disconnected');
  }, [cloud.state, isOperator]);

  // ── Demo mode: the vehicle is simulated in this tab ──
  // The hook always runs (hooks cannot be conditional) but `isDemo` switches
  // its 4 Hz tick off entirely in every other mode — otherwise it re-rendered
  // this provider, and with it the whole console, four times a second in
  // sessions that never read a simulated value.
  // The simulator is a third data source with the SAME interface as the cloud
  // one: it publishes ICD §6 proposals and status updates into the very
  // handlers the live WSS and the local socket feed, so the proposal card,
  // countdown and safe-default reporting are one code path, not a demo copy.
  const demo = useDemoVehicle(vehicleId, isDemo, { onProposal: handleProposal, onStatus: handleProposalStatus });

  useEffect(() => {
    if (!isDemo) return;
    // A demo session has no link to lose, so it is "connected" from the first
    // frame — and telemetry is available immediately, which is what stops the
    // map from sitting on "Waiting for telemetry…".
    setConnection('connected');
    setTelemetry(demo.telemetry);
  }, [isDemo, demo.telemetry]);

  // Correct operatorId once the Hosted-UI sign-in completes. The username is
  // only readable AFTER completeLoginIfRedirected has stored the tokens (async,
  // in useCloudTelemetry) — which is strictly after this provider's first
  // render, where operatorId was seeded with a random fallback. cloud.state
  // moving off 'signed-out' is the signal the token (hence username) is now
  // available; without this a FRESH sign-in would drive with the random id and
  // the cloud would reject it (403 IDENTITY_MISMATCH, LEG-05 identity binding).
  useEffect(() => {
    if (!isOperator || !cloudApi) return;
    const u = getUsername();
    if (u && u !== operatorId) setOperatorId(u);
  }, [cloud.state, operatorId, isOperator]);

  // ── Local sockets (developer mode ONLY) ──
  // Gated on the MODE, not on the absence of cloud config: these sockets point
  // at 127.0.0.1, so on a publicly served page they would be a public site
  // reaching into the visitor's own machine — a browser local-network
  // permission prompt and nothing working. The entry gate only offers local
  // mode from a localhost origin (see mode.ts), so this can never fire there.
  useEffect(() => {
    if (!isLocal) return;
    const telSock: Socket = io(TELEMETRY_WS);
    const cmdSock: Socket = io(COMMAND_WS);
    telSock.on('connect', () => setConnection('connected'));
    telSock.on('disconnect', () => setConnection('disconnected'));
    telSock.on('connect_error', () => setConnection('disconnected'));
    telSock.on(`telemetry/${vehicleId}`, (p: TelemetryPayload) => setTelemetry(p));

    cmdSock.on(`maneuver/proposal/${vehicleId}`, handleProposal);
    cmdSock.on(`maneuver/status/${vehicleId}`, handleProposalStatus);
    return () => { telSock.disconnect(); cmdSock.disconnect(); };
  }, [vehicleId, handleProposal, handleProposalStatus, isLocal]);

  // ── Heartbeat (deadman) ──
  useEffect(() => {
    if (isDemo) return; // no server to keep alive; the simulator owns the latch
    if (token && commandApi) {
      heartbeatRef.current = window.setInterval(async () => {
        try {
          const r = await fetch(`${commandApi}/api/command/${vehicleId}/heartbeat`, {
            method: 'POST', headers: apiHeaders(toCloud),
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
  }, [token, operatorId, vehicleId, isDemo, commandApi, toCloud]);

  // ── API helpers ──
  // Every network helper below carries the same demo guard. Guarding here
  // rather than at the call sites is deliberate: it makes "a demo session
  // performs no network I/O" a property of this file that a reader can verify
  // in one place, instead of an invariant spread across every button.
  const cmdPost = useCallback(async (path: string, body: object = {}) => {
    // Demo: the command is applied by the in-tab simulator instead of being
    // sent anywhere. Holding control is still required, so the demo shows the
    // real gating (a session without the token cannot command a vehicle).
    if (isDemo) { if (token) demo.command(path, body); return null; }
    // No endpoint for this session (see commandsDisabled): send nothing. The
    // UI surfaces the reason; this is not the place to guess an address.
    if (!token || !commandApi) return null;
    const r = await fetch(`${commandApi}/api/command/${vehicleId}/${path}`, {
      method: 'POST', headers: apiHeaders(toCloud),
      body: JSON.stringify({ operatorId, token, ...body }),
    });
    if (r.status === 401) { setToken(null); return null; }
    return r.json();
  }, [token, operatorId, vehicleId, isDemo, demo.command, commandApi, toCloud]);

  // Fleet workflows are operator actions on the vehicle: every mutating call
  // carries the fencing token (SEC-05) — the fleet service rejects it otherwise.
  const fleetPost = useCallback(async (path: string, body?: object) => {
    if (isDemo || !token || !fleetApi) return null;
    try {
      const r = await fetch(`${fleetApi}/api/fleet${path}`, {
        method: 'POST', headers: apiHeaders(toCloud),
        body: JSON.stringify({ operatorId, token, ...(body ?? {}) }),
      });
      return r.ok ? r.json() : null;
    } catch { return null; }
  }, [token, operatorId, isDemo, fleetApi, toCloud]);

  const fleetGet = useCallback(async (path: string) => {
    if (isDemo || !fleetApi) return null;
    try { const r = await fetch(`${fleetApi}/api/fleet${path}`, { headers: apiHeaders(toCloud) }); return r.ok ? r.json() : null; }
    catch { return null; }
  }, [isDemo, fleetApi, toCloud]);

  const takeControl = useCallback(async () => {
    // A demo session holds a LOCAL token: it exists only so the UI can show the
    // controlled state, and no cloud ever issues or validates it. The real
    // fencing token (SEC-05) is never minted outside an authenticated session.
    if (isDemo) { setToken('demo-local-session'); return; }
    if (!commandApi) return;
    const r = await fetch(`${commandApi}/api/command/${vehicleId}/take-control`, {
      method: 'POST', headers: apiHeaders(toCloud),
      body: JSON.stringify({ operatorId }),
    });
    if (r.ok) { const d = await r.json(); setToken(d.token); }
  }, [operatorId, vehicleId, isDemo, commandApi, toCloud]);

  const estop = useCallback(() => { cmdPost('estop'); }, [cmdPost]);

  const decideManeuver = useCallback(async (decision: 'CONFIRM' | 'REJECT' | 'SELECT_ALTERNATIVE', optionId?: string) => {
    // Demo: the in-tab vehicle resolves its own proposal, applying the edge's
    // rules — including refusing a decision that arrives after the window
    // closed, where the safe default has already been applied.
    if (isDemo) { if (token) demo.decideProposal(decision, optionId); return; }
    if (!commandApi || !activeProposal || !token) return;
    await fetch(`${commandApi}/api/maneuver/${activeProposal.proposalId}/decide`, {
      method: 'POST', headers: apiHeaders(toCloud),
      body: JSON.stringify({ operatorId, token, decision, optionId }),
    });
  }, [activeProposal, token, operatorId, isDemo, commandApi, toCloud, demo.decideProposal]);

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
    const confirmed = await fleetPost(`/pre-departure/${mission.checklistId}/confirm`);
    if (!confirmed) return;
    const d = await fleetPost(`/mission/${mission.missionId}/start`);
    if (d?.status) setMission(prev => (prev ? { ...prev, status: d.status } : null));
  }, [fleetPost, mission, checkItems]);

  const missionAction = useCallback(async (action: string) => {
    if (!mission) return;
    const d = await fleetPost(`/mission/${mission.missionId}/${action}`);
    if (d?.status) setMission(prev => (prev ? { ...prev, status: d.status } : null));
  }, [fleetPost, mission]);

  const dismissMission = useCallback(() => { setMission(null); setCheckItems([]); }, []);

  // Load active mission on mount (skipped in demo — fleetGet is inert there,
  // but returning early keeps the intent obvious: a demo session asks the
  // network for nothing at all, not even on first paint).
  useEffect(() => {
    if (isDemo) return;
    fleetGet(`/${vehicleId}/mission`).then(d => {
      if (d?.id) {
        setMission({ missionId: d.id, status: d.status, checklistId: d.checklistId });
        if (d.checklist?.items) setCheckItems(d.checklist.items);
      }
    });
  }, [fleetGet, vehicleId, isDemo]);

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
    mission, checkItems, commandsDisabled,
    cloudState: cloud.state, cloudSignIn: cloud.signIn, cloudSignOut: cloud.signOut,
    takeControl, cmdPost, estop, decideManeuver,
    createMission, setCheckItem, confirmAndStart, missionAction, dismissMission,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
