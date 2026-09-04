import { useCallback, useEffect, useRef, useState } from 'react';
import { ManeuverProposal, ManeuverProposalStatusUpdate, TelemetryPayload } from '@joppilot/contract';

/**
 * In-browser vehicle simulator — the entire data source for demo mode.
 *
 * There is no server, no broker and no AWS behind this: the "vehicle" is a
 * position advancing along a fixed loop inside this tab. That is the point.
 * A demo visitor is someone we have granted nothing to, so the demo must be
 * incapable of reaching real infrastructure rather than merely declining to.
 *
 * It emits the SAME `TelemetryPayload` the real vehicle publishes, so every
 * panel, badge and the map render from the identical shape — no demo-only
 * branches scattered through the UI.
 *
 * The simulated vehicle sits in a DEPOT zone. That is deliberate: the zone↔mode
 * matrix (ICD §1) permits Mode 2 direct driving in a depot, so the demo can
 * show driving controls without contradicting the rule that public routes are
 * supervision-only. The matrix does the deciding here exactly as it does in the
 * real console.
 */

/** A short closed loop through a depot yard (Zürich). Lng/lat pairs. */
const ROUTE: Array<[number, number]> = [
  [8.5510, 47.4102],
  [8.5527, 47.4104],
  [8.5535, 47.4113],
  [8.5528, 47.4122],
  [8.5511, 47.4124],
  [8.5500, 47.4117],
  [8.5501, 47.4107],
];

const TICK_MS = 250;
/** Fraction of a leg covered per tick at full speed — tuned to look like a yard manoeuvre, not a chase. */
const STEP_AT_FULL_SPEED = 0.012;
const CRUISE_KMH = 12;

/**
 * ICD §6 maneuver proposals — the same three scenarios the edge simulator
 * cycles through (edge/sim/src/main.rs). Kept identical on purpose: the demo's
 * job is to show what the real system does, so a viewer who later watches a
 * live vehicle sees the cards they were shown here.
 */
const SCENARIOS = [
  { reasonCode: 'OBSTACLE', summary: 'Stationary obstacle detected on planned path', sensor: 'CAM_FRONT' },
  { reasonCode: 'PEDESTRIAN_CONFLICT', summary: 'Pedestrian group near collection point', sensor: 'LIDAR_FRONT' },
  { reasonCode: 'ROAD_BLOCKED', summary: 'Parked vehicle blocking the route', sensor: 'CAM_FRONT' },
] as const;

/** Decision window — the edge sim's value, unchanged (ICD §6). */
const PROPOSAL_WINDOW_MS = 30_000;
/** Let the session settle before the first card appears. */
const FIRST_PROPOSAL_MS = 12_000;
/**
 * Quiet time after a proposal resolves. The edge sim waits 2 minutes so a real
 * operator is not spammed; a demo visitor would read that as "nothing happens
 * here", so the demo uses the shortest gap that still feels like an event
 * rather than a stream.
 */
const PROPOSAL_GAP_MS = 20_000;
const PROPOSAL_TICK_MS = 1_000;

export type ProposalDecision = 'CONFIRM' | 'REJECT' | 'SELECT_ALTERNATIVE';

/** The proposal the simulated vehicle is currently waiting on. */
interface PendingProposal {
  proposal: ManeuverProposal;
  deadline: number;
  /** The option whose expected result is "stop and hold" — also the safe default. */
  stopOptionId: string;
}

/** Where the simulator publishes ICD §6 traffic — same shape useCloudTelemetry uses. */
export interface DemoHandlers {
  onProposal: (p: ManeuverProposal) => void;
  onStatus: (u: ManeuverProposalStatusUpdate) => void;
}

/** crypto.randomUUID needs a secure context; keep a v4 fallback for the rest. */
function uuid(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export interface DemoVehicle {
  telemetry: TelemetryPayload;
  /** Handles the same (path, body) pairs the real cmdPost would send. */
  command: (path: string, body?: any) => void;
  /** Resolves the open ICD §6 proposal, with the edge's own validation rules. */
  decideProposal: (decision: ProposalDecision, optionId?: string) => void;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/**
 * @param enabled false in every non-demo session. React forbids conditional
 *   hooks, so this hook is CALLED in all modes — but with `enabled` false it
 *   starts no interval and sets no state, so an operator or local session pays
 *   nothing for it. Without this flag the 4 Hz tick re-rendered the whole
 *   SessionProvider subtree in modes that never read a single simulated value.
 */
export function useDemoVehicle(vehicleId: string, enabled: boolean, handlers: DemoHandlers): DemoVehicle {
  // The handlers come from the provider as a fresh object each render; holding
  // them in a ref keeps the generator's interval from being torn down and
  // restarted (which would reset every decision window) on an unrelated render.
  const handlersRef = useRef(handlers);
  useEffect(() => { handlersRef.current = handlers; });

  // Motion state lives in a ref: it updates 4× a second and must not re-render
  // anything by itself — only the telemetry snapshot published each tick does.
  const leg = useRef(0);
  const along = useRef(0);
  const driving = useRef(false);
  const reversing = useRef(false);
  const latched = useRef(false);
  const battery = useRef(87.4);

  // ── ICD §6 proposal state ──
  const pending = useRef<PendingProposal | null>(null);
  const nextProposalAt = useRef(0);
  const scenarioIdx = useRef(0);

  const build = useCallback((): TelemetryPayload => {
    const from = ROUTE[leg.current];
    const to = ROUTE[(leg.current + 1) % ROUTE.length];
    const lng = lerp(from[0], to[0], along.current);
    const lat = lerp(from[1], to[1], along.current);

    const moving = driving.current && !latched.current;
    const speedKmh = moving ? CRUISE_KMH : 0;

    return {
      vehicleId,
      timestamp: Date.now(),
      location: { lat, lng },
      speedKmh,
      vehicleState: latched.current ? 'SAFE_STOPPED' : moving ? 'REMOTE_DRIVE' : 'IDLE',
      // The operating mode reports what the vehicle is DOING, not a constant:
      // direct remote driving is Mode 2, standing still (idle or latched) is
      // supervision — Mode 1. A hard-coded MODE2 would have told an observer
      // the vehicle was under direct control while it sat latched.
      mode: moving ? 'MODE2' : 'MODE1',
      battery: {
        percent: battery.current,
        voltageV: 51.2 - (100 - battery.current) * 0.02,
        currentA: moving ? 18.5 : 1.2,
        temperatureC: 24 + (moving ? 3 : 0),
      },
      motor: { rpm: moving ? 1450 : 0, temperatureC: moving ? 41 : 27 },
      sensors: [
        { id: 'cam-front', type: 'CAMERA', status: 'OK' },
        { id: 'cam-rear', type: 'CAMERA', status: 'OK' },
        { id: 'lidar-top', type: 'LIDAR', status: 'OK' },
        { id: 'us-left', type: 'ULTRASONIC', status: 'OK' },
      ],
      computeHealth: { cpuPercent: moving ? 46 : 22, ramPercent: 38, temperatureC: 52 },
      connection: { rttMs: 38, packetLossPercent: 0, carrier: 'Demo', band: 'n/a' },
      currentZone: 'depot',
      // ICD §5: `dtc` is the DIAGNOSTIC TROUBLE CODE list. A healthy simulated
      // vehicle has none, and lamp state is not a fault — an earlier version
      // pushed a fake "hazards on" code in here, which would have shown up as a
      // vehicle fault anywhere a real DTC list is read.
      dtc: [],
    };
  }, [vehicleId]);

  const [telemetry, setTelemetry] = useState<TelemetryPayload>(() => build());

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      if (driving.current && !latched.current) {
        const step = STEP_AT_FULL_SPEED * (reversing.current ? -1 : 1);
        along.current += step;
        while (along.current >= 1) {
          along.current -= 1;
          leg.current = (leg.current + 1) % ROUTE.length;
        }
        while (along.current < 0) {
          along.current += 1;
          leg.current = (leg.current - 1 + ROUTE.length) % ROUTE.length;
        }
        battery.current = Math.max(0, battery.current - 0.004);
      }
      setTelemetry(build());
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [build, enabled]);

  const emitStatus = useCallback(
    (proposal: ManeuverProposal, status: ManeuverProposalStatusUpdate['status'], selectedOptionId?: string) => {
      handlersRef.current.onStatus({
        proposalId: proposal.proposalId,
        vehicleId: proposal.vehicleId,
        status,
        ...(selectedOptionId ? { selectedOptionId } : {}),
        timestamp: Date.now(),
      });
    },
    [],
  );

  /**
   * Apply an outcome to the vehicle.
   *
   * A maneuver decision is a Mode 1 SUPERVISION decision, not a drive command:
   * it may bring the vehicle to a stop, but it must never set it moving. So
   * "wait and retry" (also the safe default) and a rejection stop it, while
   * "reroute around the obstacle" leaves the motion state exactly as it was —
   * approving a reroute on a parked vehicle does not drive it away.
   */
  const applyOutcome = useCallback((stopOptionId: string, resolvedOptionId?: string) => {
    if (resolvedOptionId === undefined || resolvedOptionId === stopOptionId) driving.current = false;
  }, []);

  // ── Proposal generator (ICD §6) ──
  // Mirrors the edge simulator: no proposal while latched, one open proposal at
  // a time, and the edge — not the console — owns the deadline. When the window
  // closes the vehicle does NOT wait for an operator: the safe default is
  // applied and a TIMED_OUT status goes out.
  useEffect(() => {
    if (!enabled) return;
    nextProposalAt.current = Date.now() + FIRST_PROPOSAL_MS;
    const id = window.setInterval(() => {
      if (latched.current) return; // a latched vehicle is not manoeuvring
      const now = Date.now();

      const open = pending.current;
      if (open) {
        if (now < open.deadline) return;
        pending.current = null;
        nextProposalAt.current = now + PROPOSAL_GAP_MS;
        applyOutcome(open.stopOptionId, open.proposal.defaultOnTimeout);
        emitStatus(open.proposal, 'TIMED_OUT', open.proposal.defaultOnTimeout);
        return;
      }

      if (now < nextProposalAt.current) return;

      const sc = SCENARIOS[scenarioIdx.current % SCENARIOS.length];
      scenarioIdx.current += 1;

      const from = ROUTE[leg.current];
      const to = ROUTE[(leg.current + 1) % ROUTE.length];
      const lat = lerp(from[1], to[1], along.current);
      const lng = lerp(from[0], to[0], along.current);

      const proposalId = uuid();
      const rerouteId = `opt-${proposalId.slice(0, 8)}-a`;
      const waitId = `opt-${proposalId.slice(0, 8)}-b`;

      const proposal: ManeuverProposal = {
        proposalId,
        vehicleId,
        reasonCode: sc.reasonCode,
        context: {
          sceneSummary: `${sc.summary} at (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
          sensorRefs: [sc.sensor],
        },
        options: [
          // ICD §6 / B-boundary convention: the FIRST option is the autonomy's
          // own proposed maneuver, which is why the console treats clicking it
          // as an approval rather than as picking an alternative.
          { optionId: rerouteId, description: 'Reroute around obstacle', expectedResult: 'Continue mission with +2min delay' },
          { optionId: waitId, description: 'Wait and retry after 60s', expectedResult: 'Pause at current position, retry approach' },
        ],
        validityWindowMs: PROPOSAL_WINDOW_MS,
        // The safe default is the conservative option, never the one that keeps
        // the vehicle moving: silence must not be read as approval to proceed.
        defaultOnTimeout: waitId,
        timestamp: now,
      };

      pending.current = { proposal, deadline: now + PROPOSAL_WINDOW_MS, stopOptionId: waitId };
      handlersRef.current.onProposal(proposal);
      emitStatus(proposal, 'PENDING');
    }, PROPOSAL_TICK_MS);
    return () => window.clearInterval(id);
  }, [enabled, vehicleId, applyOutcome, emitStatus]);

  /**
   * Resolve the open proposal — with the edge's validation, not a shortcut.
   *
   * The real vehicle refuses a decision that names an option it never offered,
   * and refuses one that arrives after the window closed (the safe default has
   * already won by then; letting a late click override it would invert ICD §6).
   * The demo refuses both the same way, silently, exactly as the edge does —
   * the console simply never sees a DECIDED status for a refused decision.
   */
  const decideProposal = useCallback((decision: ProposalDecision, optionId?: string) => {
    const open = pending.current;
    if (!open || Date.now() >= open.deadline) return;

    const offered = open.proposal.options.map((o) => o.optionId);
    let resolved: string | undefined;
    if (decision === 'SELECT_ALTERNATIVE') {
      if (!optionId || !offered.includes(optionId)) return;
      resolved = optionId;
    } else if (decision === 'CONFIRM') {
      // CONFIRM may omit the option (approving the autonomy's own proposal =
      // the first one), but must not name a foreign one.
      if (optionId && !offered.includes(optionId)) return;
      resolved = optionId ?? offered[0];
    }
    // REJECT carries no option — `resolved` stays undefined.

    pending.current = null;
    nextProposalAt.current = Date.now() + PROPOSAL_GAP_MS;
    applyOutcome(open.stopOptionId, resolved);
    emitStatus(open.proposal, 'DECIDED', resolved);
  }, [applyOutcome, emitStatus]);

  /**
   * Latching withdraws an open proposal.
   *
   * A safe-stopped vehicle is not manoeuvring, so the question the card asks no
   * longer has an answer — and the generator does not run the deadline while
   * latched, so without this the card would sit on screen at 0 s waiting for a
   * timeout that never comes. CANCELLED is the ICD §6 status for exactly this.
   */
  const cancelOpenProposal = useCallback(() => {
    const open = pending.current;
    if (!open) return;
    pending.current = null;
    nextProposalAt.current = Date.now() + PROPOSAL_GAP_MS;
    emitStatus(open.proposal, 'CANCELLED');
  }, [emitStatus]);

  /**
   * The demo's second gate. The real vehicle refuses a command that its own
   * state forbids; so does this one — once latched, nothing but an explicit
   * clear releases it (ICD §9: the latch is NOT cleared by a new command, and
   * certainly not by driving again).
   */
  const command = useCallback((path: string, body?: any) => {
    if (path === 'estop') {
      driving.current = false;
      latched.current = true;
      cancelOpenProposal();
      return;
    }
    if (path === 'clear-safe-stop') {
      latched.current = false;
      return;
    }
    if (path !== 'command') return;

    const p = body?.payload ?? {};
    if (latched.current) return; // latched: every other command is ignored

    switch (p.action) {
      case 'SAFE_STOP':
        driving.current = false;
        latched.current = true;
        cancelOpenProposal();
        break;
      case 'DRIVE':
        // The DRIVE frame is the WHOLE pedal state, not an increment: the
        // teleop loop sends {throttle, brake} continuously and sends
        // {throttle: 0, brake: 0} the moment the operator releases the stick.
        // So this must STOP on a zero frame — treating "no throttle" as "keep
        // going" would leave the demo vehicle rolling after the input was let
        // go, which is exactly the failure the real vehicle must never have.
        driving.current =
          (typeof p.throttle === 'number' ? p.throttle : 0) > 0 &&
          (typeof p.brake === 'number' ? p.brake : 0) <= 0;
        break;
      case 'SELECT_DIRECTION':
        // Selecting a gear does NOT move the vehicle — it only chooses which
        // way throttle will take it (ICD §4). NEUTRAL is the exception: it
        // disengages the drivetrain, so it stops a vehicle that was moving.
        reversing.current = p.direction === 'REVERSE';
        if (p.direction === 'NEUTRAL') driving.current = false;
        break;
      default:
        // HAZARD_LIGHTS / LIGHTS / TURN / STEER / HORN are accepted and have no
        // visible effect: the ICD §5 telemetry payload carries no lamp, wheel
        // or horn state, and a point moving along a route cannot show one.
        break;
    }
  }, [cancelOpenProposal]);

  return { telemetry, command, decideProposal };
}
