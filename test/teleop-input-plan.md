# Physical Teleop Input Plan (keyboard → PS4 pad → G29 wheel)

**Goal:** drive the CARLA vehicle with physical input devices instead of the
console buttons, while keeping the exact same command path
(browser console → AWS → edge → CARLA). Rollout order: **Logitech (phase 1) →
PlayStation 4 controller (phase 2) → Logitech G29 wheel (phase 3)**.

Status: PLAN (not yet implemented). Owner: —. Last updated: 2026-08-03.

---

## 1. Core architectural decision — read the device in the browser console

Physical devices are read **in the console** (where the operator sits) and mapped
onto the existing command payloads, then sent through the unchanged pipeline:

```
Device (keyboard / PS4 / G29)
   │  Web Gamepad API + keyboard events (in the browser)
   ▼
Input Mapper  →  existing cmdPost(STEER / DRIVE / SELECT_DIRECTION / …)
   ▼
API Gateway → Command Service (sign, Gate-1) → AWS IoT Core
   ▼
Edge kernel (Gate-2: zone == depot? Mode 2? not latched?) → CARLA bridge → CARLA
```

Why this design:

- **"Same system" is preserved.** Input rides the existing cloud→edge→CARLA path,
  so every safety layer still applies: the two gates, Ed25519 signing, zone/mode
  enforcement, EDR logging, the on-vehicle watchdog and safe-stop latch.
- **No backend change for phases 1–2.** The contract already carries analog
  driving values — no new command type is needed:
  - `SteerCommandSchema` — `angle ∈ [-45, 45]` (`packages/contract/src/index.ts`)
  - `DriveCommandSchema` — `throttle ∈ [0, 100]`, `brake ∈ [0, 100]`
  - `SelectDirectionCommandSchema` — `FORWARD | REVERSE | NEUTRAL`
  - `TurnCommandSchema` — `LEFT | RIGHT | STRAIGHT`
- Teleop is **Mode 2 (direct driving)** → only active in a `depot` / permitted
  zone (already set up). The buttons and the physical devices share this gate.

A native local agent (reading the wheel via SDL/evdev and injecting locally) is
**deliberately not** used for input: the requirement is to prove remote teleop
*through the cloud*. The only place a native helper is considered is G29 force
feedback (phase 3, return path).

---

## 2. Core challenge — continuous (analog) input vs. discrete buttons

Buttons are single clicks. A wheel/gamepad produces a ~60 Hz analog stream.
Signing + EDR-logging + IoT-publishing 60 commands/s/vehicle would overload the
system. The fix is a browser-side **control loop**:

1. Poll the device at ~60 Hz (`requestAnimationFrame`).
2. Apply a **deadzone** + **change threshold** (kill jitter around centre/rest).
3. **Throttle** the outbound rate to ~10–15 Hz.
4. Emit `STEER` / `DRIVE` only on a **meaningful delta** (value moved past a
   threshold), not every frame.
5. **E-STOP is a separate, instant path** on every device — any "panic" button
   fires `/estop` immediately, never queued behind the throttled stream.
6. The loop only runs while `hasControl && mode2Allowed`; on window blur or device
   disconnect it sends a **neutral + safe** state (throttle 0, brake, centre).

---

## 3. Phase 0 — shared input layer (write once, all devices reuse it)

Device-agnostic core added to the console:

- `useTeleopInput` hook + **profile-based mapping** (one profile per device:
  `keyboard`, `ps4`, `g29`).
- The control loop from section 2 (poll → deadzone → throttle → delta → cmdPost).
- Device selection UI + an "active input" indicator (which device is driving,
  live axis values).
- Safety interlock: active only when `hasControl && mode2Allowed`; auto-neutral on
  blur/disconnect.

Once this exists, each later phase is just **a new mapping profile**.

---

## 4. Phase 1 — Logitech (simplest device, keyboard-class)

> The "Logitech Wireless L710" is most likely a keyboard/mouse combo. If it is a
> keyboard, use `keydown`/`keyup`; if the OS exposes it as a gamepad, it flows
> through the same Gamepad API path — the input layer handles both.

- Profile: `↑/↓` or `W/S` → `DRIVE` (stepped throttle/brake); `←/→` → `STEER`
  (stepped angle); `R` → `REVERSE`; `Space` → `E-STOP`.
- Discrete and low-rate → works through the existing path immediately (a keyboard
  listener already partly exists in `SessionContext.tsx`).
- **Deliverable:** drive the CARLA vehicle with the keyboard.

## 5. Phase 2 — PlayStation 4 controller (DualShock 4, Gamepad API)

- Chrome exposes the DualShock 4 as a standard gamepad (`navigator.getGamepads()`).
- Profile: left stick X → `STEER` angle; `R2`/`L2` triggers → analog throttle/brake;
  face buttons → gear / horn / E-STOP.
- The continuous loop (deadzone + throttle + delta) really matters here.
- **Measure glass-to-glass latency** (press → movement in CARLA). The
  HTTP + sign + IoT path is ~100–300 ms — fine for low-speed depot driving, not
  for a racing feel. This measurement drives the phase-3 channel decision.

## 6. Phase 3 — Logitech G29 wheel (+ pedals, + FFB)

- The G29 enumerates as a gamepad in the browser: a **steering axis**, separate
  **throttle/brake/clutch** axes, and the H-shifter as buttons.
- Mapping: 900° wheel → steering ratio → `STEER [-45, 45]`; throttle pedal →
  `throttle`; brake pedal → `brake`; shifter → `SELECT_DIRECTION`.
- **Two decisions land in this phase:**
  1. **Low-latency teleop channel.** If the HTTP + sign + EDR path feels laggy for
     natural wheel driving, open the fast control lane the ICD already anticipates
     (**AD-3: WebRTC data channel / WebSocket**): a high-rate control stream that
     skips per-message signing/EDR but keeps session auth, with the edge Gate-2
     still authoritative and EDR **downsampled** (see section 7). Larger change;
     decide based on the phase-2 latency measurement.
  2. **Force feedback (return path).** Road/collision force from CARLA → back to the
     wheel. The browser Gamepad API's force feedback is weak for wheels, so this
     likely needs a **native local helper** (a small SDL/evdev agent). Not required
     to drive; a stretch goal.

---

## 7. Cross-cutting: compliance note (LEG-04)

Do **not** write every frame to the EDR — the legal intent is to record the
session plus meaningful control inputs. For continuous input, add a teleop
"fast-path" flag and **sample the EDR at ~1 Hz** (session start/end + a
downsampled control trace). Otherwise a 15 Hz stream bloats the audit log. This
ties back to the LEG-04 (tamper-evident event recording) item.

---

## 8. Shared prerequisites / constraints

- Zone **depot** + a valid permit (Mode 2) — already set up; teleop is active only
  in Mode 2.
- **No rate limiting** exists in the command service today — client-side throttling
  is mandatory before phase 2 (a raw 60 Hz stream would overload it); for
  production, add a server-side ceiling as well.
- HTTPS/localhost + page focus (Gamepad API requirement).

---

## 9. Rollout order (summary)

Phase 0 (shared input layer) → Phase 1 (keyboard, no backend change) →
Phase 2 (PS4, continuous loop + latency measurement) →
Phase 3 (G29, add the fast teleop channel if needed + FFB).
