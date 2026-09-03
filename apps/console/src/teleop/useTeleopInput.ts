/**
 * Teleop control loop (Phase 0 core — shared by keyboard and gamepad profiles).
 *
 * Polls the active input at ~60 Hz, eases the current control toward the
 * device's target (so driving feels analog, not binary), and emits STEER /
 * DRIVE commands at a throttled ~12 Hz — only when the value moved past a
 * threshold. This keeps a continuous device from flooding the sign + EDR + IoT
 * command path (see test/teleop-input-plan.md §2/§7).
 *
 * Discrete intents (gear, panic) are edge-detected: keyboard fires them from
 * keydown; a gamepad fires them on a button's rising edge inside the loop.
 *
 * Safety: armed ONLY while `enabled && hasControl && mode2Allowed`. On disarm
 * (toggle off, control lost, zone leaves Mode 2, window blur) it releases
 * throttle/brake and re-centres the wheel and clears held keys. A gamepad's
 * panic button routes straight to E-STOP (there is no Spacebar on a pad).
 */
import { useEffect, useRef, useState } from 'react';
import { ControlTarget, Direction, TeleopProfile } from './profiles';

const POLL_MS = 1000 / 60;
const SEND_MS = 1000 / 12;
const MAX_STEER_DEG = 35;

const RAMP = {
  throttleUp: 2.0,
  throttleDown: 4.0,
  brakeUp: 5.0,
  brakeDown: 6.0,
  steer: 3.0,
  steerCentre: 4.0,
};

const STEER_EPS_DEG = 1.5;
const PEDAL_EPS_PCT = 3;

export interface TeleopLive {
  active: boolean;
  steerDeg: number;
  throttlePct: number;
  brakePct: number;
  direction: Direction;
  /** Gamepad only: whether a pad is currently seen by the browser. */
  deviceReady: boolean;
  /** Non-fatal hint (e.g. F710 not in XInput mode). */
  warning: string | null;
}

interface Args {
  enabled: boolean;
  hasControl: boolean;
  mode2Allowed: boolean;
  profile: TeleopProfile;
  /** Maps to cmdPost('command', { payload }). */
  sendCommand: (payload: object) => void;
  /** Instant E-STOP path (used by a gamepad panic button). */
  sendEstop: () => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

function ease(from: number, to: number, step: number): number {
  if (from < to) return Math.min(to, from + step);
  if (from > to) return Math.max(to, from - step);
  return to;
}

/** First connected gamepad (browsers expose one only after a button press). */
function firstGamepad(): Gamepad | null {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) if (p) return p;
  return null;
}

export function useTeleopInput({ enabled, hasControl, mode2Allowed, profile, sendCommand, sendEstop }: Args): TeleopLive {
  const active = enabled && hasControl && mode2Allowed;

  const held = useRef(new Set<string>());
  const cur = useRef<ControlTarget>({ steer: 0, throttle: 0, brake: 0 });
  const dir = useRef<Direction>('FORWARD');
  const lastSent = useRef({ steerDeg: 0, throttlePct: 0, brakePct: 0 });
  const lastSendAt = useRef(0);
  const lastTick = useRef(0);
  // Gamepad discrete edge-detection state.
  const prevGear = useRef<Direction | null>(null);
  const prevEstop = useRef(false);

  const [live, setLive] = useState<TeleopLive>({
    active: false, steerDeg: 0, throttlePct: 0, brakePct: 0, direction: 'FORWARD',
    deviceReady: false, warning: null,
  });

  // ── Keyboard listeners (only for a keyboard profile, only while active) ──
  useEffect(() => {
    if (!active || profile.kind !== 'keyboard') return;
    const kb = profile;
    const down = (e: KeyboardEvent) => {
      const gear = kb.directionKeys[e.code];
      if (gear) {
        dir.current = gear;
        sendCommand({ action: 'SELECT_DIRECTION', direction: gear });
        e.preventDefault();
        return;
      }
      if (kb.driveKeys.includes(e.code)) {
        held.current.add(e.code);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => { held.current.delete(e.code); };
    const clearHeld = () => held.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clearHeld);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clearHeld);
      held.current.clear();
    };
  }, [active, profile, sendCommand]);

  // ── Release the pedals when the panel goes away ──
  // Disarming covers the toggle, lost control, a zone leaving Mode 2 and window
  // blur — but NOT unmount, and the panel unmounts the moment the operator
  // navigates off the Operations page. Until this ran, leaving the page mid-
  // drive left the last DRIVE frame standing and the vehicle rolling (found by
  // driving the demo over CDP: hold throttle, switch to the map, keep going).
  //
  // Bound to UNMOUNT ONLY, deliberately: a cleanup that also ran on every
  // dependency change would inject a zero-throttle frame into a drive in
  // progress, i.e. blip the vehicle. The refs keep the unmount handler from
  // capturing a stale sender or a stale armed state.
  const sendRef = useRef(sendCommand);
  const armedRef = useRef(false);
  useEffect(() => { sendRef.current = sendCommand; }, [sendCommand]);
  useEffect(() => { armedRef.current = active; }, [active]);
  useEffect(() => () => {
    if (armedRef.current) sendRef.current({ action: 'DRIVE', throttle: 0, brake: 0 });
  }, []);

  // ── Control loop ──
  useEffect(() => {
    if (!active) {
      sendCommand({ action: 'DRIVE', throttle: 0, brake: 0 });
      sendCommand({ action: 'STEER', angle: 0 });
      cur.current = { steer: 0, throttle: 0, brake: 0 };
      lastSent.current = { steerDeg: 0, throttlePct: 0, brakePct: 0 };
      held.current.clear();
      prevGear.current = null;
      prevEstop.current = false;
      setLive((l) => ({ ...l, active: false, steerDeg: 0, throttlePct: 0, brakePct: 0, deviceReady: false }));
      return;
    }

    lastTick.current = performance.now();
    lastSendAt.current = 0;
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min((now - lastTick.current) / 1000, 0.1);
      lastTick.current = now;

      // 1) Resolve this frame's target + device status.
      let target: ControlTarget;
      let deviceReady = true;
      let warning: string | null = null;

      if (profile.kind === 'gamepad') {
        const gp = firstGamepad();
        if (!gp) {
          deviceReady = false;
          target = { steer: 0, throttle: 0, brake: 0 };
        } else {
          if (gp.mapping !== 'standard') warning = 'Set the F710 switch to X (XInput) for correct mapping.';
          const read = profile.read(gp);
          target = read.target;
          // Discrete: gear on rising edge, estop on rising edge.
          const g = read.discrete.gear;
          if (g && g !== prevGear.current) {
            dir.current = g;
            sendCommand({ action: 'SELECT_DIRECTION', direction: g });
          }
          prevGear.current = g;
          if (read.discrete.estop && !prevEstop.current) sendEstop();
          prevEstop.current = read.discrete.estop;
        }
      } else {
        target = profile.readKeyboard(held.current);
      }

      // 2) Ease current toward target.
      const c = cur.current;
      c.throttle = ease(c.throttle, target.throttle, dt * (target.throttle > c.throttle ? RAMP.throttleUp : RAMP.throttleDown));
      c.brake = ease(c.brake, target.brake, dt * (target.brake > c.brake ? RAMP.brakeUp : RAMP.brakeDown));
      c.steer = ease(c.steer, target.steer, dt * (Math.abs(target.steer) < 0.001 ? RAMP.steerCentre : RAMP.steer));

      const steerDeg = clamp(c.steer * MAX_STEER_DEG, -45, 45);
      const throttlePct = Math.round(c.throttle * 100);
      const brakePct = Math.round(c.brake * 100);

      // 3) Throttled, delta-gated send.
      if (now - lastSendAt.current >= SEND_MS) {
        const s = lastSent.current;
        if (Math.abs(steerDeg - s.steerDeg) >= STEER_EPS_DEG) {
          sendCommand({ action: 'STEER', angle: round1(steerDeg) });
          s.steerDeg = steerDeg;
        }
        if (Math.abs(throttlePct - s.throttlePct) >= PEDAL_EPS_PCT || Math.abs(brakePct - s.brakePct) >= PEDAL_EPS_PCT) {
          sendCommand({ action: 'DRIVE', throttle: throttlePct, brake: brakePct });
          s.throttlePct = throttlePct;
          s.brakePct = brakePct;
        }
        lastSendAt.current = now;
        setLive({ active: true, steerDeg: round1(steerDeg), throttlePct, brakePct, direction: dir.current, deviceReady, warning });
      }
    }, POLL_MS);
    return () => clearInterval(id);
  }, [active, profile, sendCommand, sendEstop]);

  return live;
}
