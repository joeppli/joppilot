/**
 * Live gamepad input monitor — shows which buttons/axes are pressed right now.
 *
 * Purely a visual proof/diagnostic: reads navigator.getGamepads() at ~30 Hz and
 * lights up pressed buttons, trigger levels, and stick position. Pair it with
 * the driving readout for a single screenshot that shows physical input →
 * command values → (in CARLA) the vehicle moving.
 */
import { useEffect, useRef, useState } from 'react';

interface PadState {
  id: string;
  mapping: string;
  pressed: boolean[];
  values: number[];
  axes: number[];
}

const BUTTONS: { i: number; label: string }[] = [
  { i: 3, label: 'Y' }, { i: 0, label: 'A' }, { i: 2, label: 'X' }, { i: 1, label: 'B' },
  { i: 4, label: 'LB' }, { i: 5, label: 'RB' },
  { i: 12, label: 'D↑' }, { i: 13, label: 'D↓' }, { i: 14, label: 'D←' }, { i: 15, label: 'D→' },
  { i: 9, label: 'Start' }, { i: 8, label: 'Back' }, { i: 10, label: 'L3' }, { i: 11, label: 'R3' },
];

function firstGamepad(): Gamepad | null {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) if (p) return p;
  return null;
}

export function GamepadViz() {
  const [pad, setPad] = useState<PadState | null>(null);
  const raf = useRef(0);
  const last = useRef(0);

  useEffect(() => {
    const loop = (t: number) => {
      raf.current = requestAnimationFrame(loop);
      if (t - last.current < 33) return; // ~30 Hz is plenty for the eye
      last.current = t;
      const gp = firstGamepad();
      if (!gp) { setPad(null); return; }
      setPad({
        id: gp.id,
        mapping: gp.mapping || 'non-standard',
        pressed: gp.buttons.map((b) => b.pressed),
        values: gp.buttons.map((b) => b.value),
        axes: [...gp.axes],
      });
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  if (!pad) {
    return <p className="text-xs muted">Gamepad input monitor — press a button on the pad (tab focused)…</p>;
  }

  const chip = (pressed: boolean): React.CSSProperties => ({
    padding: '3px 9px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
    fontSize: 12, fontWeight: 700, minWidth: 34, textAlign: 'center',
    background: pressed ? 'var(--color-success)' : 'var(--bg-inset)',
    color: pressed ? '#fff' : 'var(--color-neutral, inherit)',
    transition: 'background 40ms',
  });

  const Trigger = ({ i, label }: { i: number; label: string }) => {
    const v = Math.round((pad.values[i] ?? 0) * 100);
    return (
      <div style={{ minWidth: 120 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="text-xs muted">{label}</span><span className="text-xs muted">{v}%</span>
        </div>
        <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-inset)', overflow: 'hidden' }}>
          <div style={{ width: `${v}%`, height: '100%', background: 'var(--color-primary)' }} />
        </div>
      </div>
    );
  };

  const lx = pad.axes[0] ?? 0;
  const ly = pad.axes[1] ?? 0;
  const S = 64;
  const dot = 10;

  return (
    <div className="col gap-2">
      <div className="row" style={{ alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-success)', boxShadow: '0 0 0 3px var(--color-success-soft)' }} />
        <span className="text-xs muted">LIVE · {pad.id} · {pad.mapping}</span>
      </div>

      <div className="row wrap gap-2">
        {BUTTONS.map(({ i, label }) => (
          <span key={i} style={chip(pad.pressed[i] ?? false)}>{label}</span>
        ))}
      </div>

      <div className="row gap-2 wrap" style={{ alignItems: 'flex-end' }}>
        <Trigger i={6} label="LT (brake)" />
        <Trigger i={7} label="RT (throttle)" />
        <div>
          <span className="text-xs muted">Left stick</span>
          <div style={{ position: 'relative', width: S, height: S, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-inset)' }}>
            <span style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--border)' }} />
            <span style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'var(--border)' }} />
            <span style={{
              position: 'absolute',
              left: (S / 2) + lx * (S / 2 - dot / 2) - dot / 2,
              top: (S / 2) + ly * (S / 2 - dot / 2) - dot / 2,
              width: dot, height: dot, borderRadius: '50%', background: 'var(--color-success)',
            }} />
          </div>
        </div>
      </div>
    </div>
  );
}
