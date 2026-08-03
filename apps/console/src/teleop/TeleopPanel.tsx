/**
 * Manual teleop input panel (keyboard + Logitech F710 gamepad).
 *
 * Isolated component so its ~12 Hz live-readout re-renders don't re-render the
 * whole Operations page. Self-gating: enable is offered only when the operator
 * holds control AND the vehicle is in a Mode-2 zone (depot/permitted), mirroring
 * the ICD §1 first gate the on-screen driving buttons already honour.
 */
import { useCallback, useState } from 'react';
import { ZONE_MODE_MATRIX } from '@joppilot/contract';
import { Card, CardHeader, Button, Badge, Progress } from '../components/ui';
import { useSession } from '../context/SessionContext';
import { useTeleopInput } from './useTeleopInput';
import { GamepadViz } from './GamepadViz';
import { PROFILES } from './profiles';

type DeviceId = 'keyboard' | 'f710';

export function TeleopPanel() {
  const { cmdPost, estop, hasControl, telemetry } = useSession();
  const zone = telemetry?.currentZone;
  const mode2Allowed = !!(zone && ZONE_MODE_MATRIX[zone]?.mode2);

  const [enabled, setEnabled] = useState(false);
  const [deviceId, setDeviceId] = useState<DeviceId>('keyboard');
  const profile = PROFILES[deviceId];

  const sendCommand = useCallback((payload: object) => { cmdPost('command', { payload }); }, [cmdPost]);
  const live = useTeleopInput({ enabled, hasControl, mode2Allowed, profile, sendCommand, sendEstop: estop });

  const canEnable = hasControl && mode2Allowed;
  const gamepadMissing = enabled && profile.kind === 'gamepad' && !live.deviceReady;
  const tone = live.active && !gamepadMissing ? 'success' : enabled ? 'warning' : 'neutral';
  const status = gamepadMissing ? 'No pad — press a button'
    : live.active ? 'Driving'
      : enabled ? 'Armed (no control/zone)'
        : 'Idle';

  return (
    <Card>
      <CardHeader title="Manual input (teleop)" action={<Badge tone={tone}>{status}</Badge>} />
      <div className="card-pad col gap-2">
        {!mode2Allowed ? (
          <p className="text-sm muted">
            Available in Mode 2 zones (depot / permitted test) only — same first gate as the driving buttons (ICD §1).
          </p>
        ) : (
          <>
            <div className="row gap-2" style={{ alignItems: 'center' }}>
              <label className="text-sm">Device</label>
              <select
                value={deviceId}
                disabled={enabled}
                onChange={(e) => setDeviceId(e.target.value as DeviceId)}
                aria-label="Input device"
                style={{ padding: '4px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-inset)', color: 'inherit' }}
              >
                <option value="keyboard">Keyboard</option>
                <option value="f710">Gamepad (Logitech F710)</option>
                <option value="ps4" disabled>PS4 controller — soon</option>
                <option value="g29" disabled>G29 wheel — soon</option>
              </select>
              <Button
                size="sm"
                variant={enabled ? 'warning' : 'primary'}
                disabled={!canEnable}
                onClick={(e) => { setEnabled((v) => !v); e.currentTarget.blur(); }}
              >
                {enabled ? 'Disable' : 'Enable driving'}
              </Button>
            </div>

            <p className="text-xs muted">{profile.hint}</p>
            {profile.kind === 'gamepad' && (
              <p className="text-xs muted">Set the F710 switch to <strong>X</strong> (XInput) and press any button once so the browser sees it.</p>
            )}
            {gamepadMissing && (
              <p className="text-xs" style={{ color: 'var(--color-warning)' }}>Gamepad not detected — press a button on the F710 while this tab is focused.</p>
            )}
            {live.warning && (
              <p className="text-xs" style={{ color: 'var(--color-warning)' }}>{live.warning}</p>
            )}

            {/* Live readout — reflects the eased control the loop is sending. */}
            <div className="kv"><span>Gear</span><strong>{live.direction}</strong></div>
            <div className="kv"><span>Steering</span><strong>{live.steerDeg.toFixed(1)}°</strong></div>
            <div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="text-xs muted">Throttle</span><span className="text-xs muted">{live.throttlePct}%</span>
              </div>
              <Progress value={live.throttlePct} tone="var(--color-success)" />
            </div>
            <div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="text-xs muted">Brake</span><span className="text-xs muted">{live.brakePct}%</span>
              </div>
              <Progress value={live.brakePct} tone="var(--color-danger)" />
            </div>

            {profile.kind === 'gamepad' && (
              <div style={{ marginTop: 6, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <p className="text-xs muted" style={{ marginBottom: 6 }}>Gamepad input (live)</p>
                <GamepadViz />
              </div>
            )}

            {!canEnable && enabled && (
              <p className="text-xs muted">Waiting for control + a Mode 2 zone before input is sent.</p>
            )}
            {profile.kind === 'keyboard' && (
              <p className="text-xs muted">Keep focus off buttons so Spacebar still fires E-STOP.</p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
