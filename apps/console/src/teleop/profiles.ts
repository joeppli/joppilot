/**
 * Teleop input profiles (physical-device → normalized control target).
 *
 * A profile turns whatever a device produces into a normalized ControlTarget
 * (+ discrete intents). The control loop (useTeleopInput) then eases + throttles
 * that target and maps it onto the existing ICD §4 command payloads (STEER /
 * DRIVE / SELECT_DIRECTION), so a physical device rides the exact same
 * console → AWS → edge → CARLA path the on-screen buttons use.
 *
 * Ships: `keyboard` (phase 1) and `f710` (phase 2, Logitech F710 gamepad via
 * the W3C Gamepad API standard mapping — the same mapping a PS4/Xbox pad uses,
 * so a PS4 profile is a thin follow-up).
 */

/** Normalized driving intent, device-agnostic. */
export interface ControlTarget {
  /** -1 = full left … +1 = full right */
  steer: number;
  /** 0 … 1 */
  throttle: number;
  /** 0 … 1 */
  brake: number;
}

export type Direction = 'FORWARD' | 'REVERSE' | 'NEUTRAL';

/** Discrete intents a device expresses each frame; the loop edge-detects them. */
export interface DiscreteState {
  /** Gear button currently held (null = none held this frame). */
  gear: Direction | null;
  /** Panic button currently held. */
  estop: boolean;
}

export interface GamepadRead {
  target: ControlTarget;
  discrete: DiscreteState;
}

interface BaseProfile {
  id: string;
  label: string;
  /** One-line control legend shown in the panel. */
  hint: string;
}

export interface KeyboardProfile extends BaseProfile {
  kind: 'keyboard';
  /** Discrete keys fired once on keydown → a gear change (SELECT_DIRECTION). */
  directionKeys: Record<string, Direction>;
  /** Continuous key codes the loop tracks as "held" (and preventDefault). */
  driveKeys: string[];
  readKeyboard(held: Set<string>): ControlTarget;
}

export interface GamepadProfile extends BaseProfile {
  kind: 'gamepad';
  read(gp: Gamepad): GamepadRead;
}

export type TeleopProfile = KeyboardProfile | GamepadProfile;

// ── Phase 1 — keyboard (any keyboard) ──
const LEFT = ['ArrowLeft', 'KeyA'];
const RIGHT = ['ArrowRight', 'KeyD'];
const UP = ['ArrowUp', 'KeyW'];
const DOWN = ['ArrowDown', 'KeyS'];

export const keyboardProfile: KeyboardProfile = {
  id: 'keyboard',
  kind: 'keyboard',
  label: 'Keyboard',
  hint: 'W/↑ throttle · S/↓ brake · A/← left · D/→ right · F/R/N gear · Space = E-STOP',
  directionKeys: { KeyF: 'FORWARD', KeyR: 'REVERSE', KeyN: 'NEUTRAL' },
  driveKeys: [...LEFT, ...RIGHT, ...UP, ...DOWN],
  readKeyboard(held) {
    const any = (codes: string[]) => codes.some((c) => held.has(c));
    const steer = (any(LEFT) ? -1 : 0) + (any(RIGHT) ? 1 : 0);
    return { steer, throttle: any(UP) ? 1 : 0, brake: any(DOWN) ? 1 : 0 };
  },
};

// ── Phase 2 — Logitech F710 (W3C "standard" gamepad mapping; switch on X) ──
const STICK_DEADZONE = 0.15;
const TRIGGER_DEADZONE = 0.04;
const deadzone = (v: number, d: number) => (Math.abs(v) < d ? 0 : v);

export const f710Profile: GamepadProfile = {
  id: 'f710',
  kind: 'gamepad',
  label: 'Gamepad (Logitech F710)',
  hint: 'Left stick = steer · RT = throttle · LT = brake · Y/A/X = fwd/rev/neutral · B = E-STOP',
  read(gp) {
    const axis = (i: number) => gp.axes[i] ?? 0;
    const value = (i: number) => gp.buttons[i]?.value ?? 0;
    const pressed = (i: number) => gp.buttons[i]?.pressed ?? false;
    // Standard mapping: axes[0]=left stick X, buttons[7]=RT, [6]=LT,
    // [0]=A [1]=B [2]=X [3]=Y.
    const target: ControlTarget = {
      steer: deadzone(axis(0), STICK_DEADZONE),
      throttle: deadzone(value(7), TRIGGER_DEADZONE),
      brake: deadzone(value(6), TRIGGER_DEADZONE),
    };
    const gear: Direction | null = pressed(3)
      ? 'FORWARD'
      : pressed(0)
        ? 'REVERSE'
        : pressed(2)
          ? 'NEUTRAL'
          : null;
    return { target, discrete: { gear, estop: pressed(1) } };
  },
};

export const PROFILES: Record<string, TeleopProfile> = {
  keyboard: keyboardProfile,
  f710: f710Profile,
};
