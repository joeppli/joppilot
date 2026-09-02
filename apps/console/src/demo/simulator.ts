import { useCallback, useEffect, useRef, useState } from 'react';
import { TelemetryPayload } from '@joppilot/contract';

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

export interface DemoVehicle {
  telemetry: TelemetryPayload;
  /** Handles the same (path, body) pairs the real cmdPost would send. */
  command: (path: string, body?: any) => void;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

export function useDemoVehicle(vehicleId: string): DemoVehicle {
  // Motion state lives in a ref: it updates 4× a second and must not re-render
  // anything by itself — only the telemetry snapshot published each tick does.
  const leg = useRef(0);
  const along = useRef(0);
  const driving = useRef(false);
  const reversing = useRef(false);
  const latched = useRef(false);
  const battery = useRef(87.4);
  const hazards = useRef(false);

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
      mode: 'MODE2',
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
      dtc: hazards.current ? ['DEMO-HAZARD-ON'] : [],
    };
  }, [vehicleId]);

  const [telemetry, setTelemetry] = useState<TelemetryPayload>(() => build());

  useEffect(() => {
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
  }, [build]);

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
        break;
      case 'DRIVE':
        // Throttle moves it, brake stops it — the two buttons the demo needs.
        if (typeof p.throttle === 'number' && p.throttle > 0) driving.current = true;
        if (typeof p.brake === 'number' && p.brake > 0) driving.current = false;
        break;
      case 'SELECT_DIRECTION':
        reversing.current = p.direction === 'REVERSE';
        driving.current = p.direction !== 'NEUTRAL';
        break;
      case 'HAZARD_LIGHTS':
        hazards.current = !!p.on;
        break;
      default:
        break; // TURN / STEER / HORN: no visible effect on a point on a route
    }
  }, []);

  return { telemetry, command };
}
