// M3-2 end-to-end DRIVING smoke test (ICD §4, timeline M3-2).
// Proves the full cloud → edge → CARLA-bridge command path: a Gate-2-verified
// Mode 2 driving command (forward/backward/left/right/throttle/brake) emerges
// on the edge's ACTUATION IPC — the exact socket the CARLA bridge consumes and
// turns into vehicle control — and an E-STOP surfaces there as a fail-safe
// latch `state` event (the bridge brakes on it without understanding commands).
//
// This test plays BOTH ends the real system has: the cloud (signed envelopes
// over MQTT, like Gate 1) AND the CARLA bridge (a TCP client on the actuation
// IPC that feeds ground-truth pose and reads verified commands). It therefore
// asserts the M3-1 actuation channel that smoke-edge.cjs does not touch.
//
// Prereqs:  docker compose -f infra/docker-compose.yml up -d mosquitto
//           cd edge/sim && EDGE_CLOUD_PUBKEY=<dev pubkey> cargo run   # leave running
//             (dev pubkey matches the committed DEV signing key — see README)
// Run:      node services/command/test/smoke-drive.cjs
const mqtt = require('mqtt'); // resolves from services/command/node_modules
const net = require('net');
const crypto = require('crypto');
const { signDoc } = require('./sign-helper.cjs');

const V = 'VEH-001';
const [IPC_HOST, IPC_PORT] = (process.env.EDGE_ACTUATION_ADDR || '127.0.0.1:7077').split(':');
// Ground-truth pose the "bridge" feeds — INSIDE the kernel's approved
// rectangle (47.37–47.38, 8.53–8.55) so the vehicle is not out_of_tod.
const POSE = { lat: 47.375, lng: 8.54, speedKmh: 0 };

const T = {
  cmd: `joppilot/v1/vehicles/${V}/command`,
  estop: `joppilot/v1/vehicles/${V}/estop`,
  ack: `joppilot/v1/vehicles/${V}/command/ack`,
  deadman: `joppilot/v1/vehicles/${V}/deadman`,
  zoneConfig: `joppilot/v1/vehicles/${V}/zone-config`,
};
const uuid = () => crypto.randomUUID();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const acks = new Map();
const client = mqtt.connect(process.env.MQTT_URL || 'mqtt://localhost:1883');

// One monotonic session token for the whole run (ICD §8). Date.now() beats any
// token a previous run left as the edge's "newest", so it is never stale.
const tok = { tokenId: uuid(), issuedAt: Date.now() };
const envelope = (payload, mode = 'MODE2', over = {}) => signDoc({
  commandId: uuid(), correlationId: uuid(), sessionId: 'sess-drive', vehicleId: V,
  issuer: 'OP-1', mode, token: tok, timestamp: Date.now(), ttlMs: 5000, payload, ...over,
});
const pub = (topic, env) => client.publish(topic, JSON.stringify(env), { qos: 1 });

function waitAck(commandId, ms = 1500) {
  return new Promise((res) => {
    const t = setInterval(() => { if (acks.has(commandId)) { clearInterval(t); res(acks.get(commandId)); } }, 30);
    setTimeout(() => { clearInterval(t); res(acks.get(commandId)); }, ms);
  });
}

// -------------------- Actuation IPC "bridge" --------------------
// A stand-in for the CARLA bridge: connects to the kernel's actuation socket,
// feeds pose, and records every NDJSON event the kernel emits.
const ipcEvents = [];
let ipcBuf = '';
const sock = net.createConnection({ host: IPC_HOST, port: Number(IPC_PORT) });
sock.setEncoding('utf8');
sock.on('data', (chunk) => {
  ipcBuf += chunk;
  let nl;
  while ((nl = ipcBuf.indexOf('\n')) >= 0) {
    const line = ipcBuf.slice(0, nl); ipcBuf = ipcBuf.slice(nl + 1);
    if (!line.trim()) continue;
    try { ipcEvents.push(JSON.parse(line)); } catch { /* ignore */ }
  }
});
sock.on('error', (e) => {
  console.error(`❌ Could not reach the actuation IPC at ${IPC_HOST}:${IPC_PORT} — is the edge running? (${e.message})`);
  process.exit(1);
});
const feedPose = () => { if (!sock.destroyed) sock.write(JSON.stringify({ type: 'pose', ...POSE }) + '\n'); };

/** Wait for a `command` actuation event carrying this commandId. */
function waitCmdEvent(commandId, ms = 1500) {
  return new Promise((res) => {
    const t = setInterval(() => {
      const ev = ipcEvents.find((e) => e.type === 'command' && e.commandId === commandId);
      if (ev) { clearInterval(t); res(ev); }
    }, 30);
    setTimeout(() => { clearInterval(t); res(undefined); }, ms);
  });
}
/** Wait for a latched `state` event appearing at/after `fromIdx`. */
function waitLatched(fromIdx, ms = 1800) {
  return new Promise((res) => {
    const t = setInterval(() => {
      const ev = ipcEvents.slice(fromIdx).find((e) => e.type === 'state' && e.latched === true);
      if (ev) { clearInterval(t); res(ev); }
    }, 30);
    setTimeout(() => { clearInterval(t); res(undefined); }, ms);
  });
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` → ${detail}` : ''}`);
}

/** Send a driving command, assert it BOTH ACKs (MQTT) and reaches actuation (IPC). */
async function drive(name, payload, mode = 'MODE2') {
  const env = envelope(payload, mode);
  pub(T.cmd, env);
  const ack = await waitAck(env.commandId);
  const ev = await waitCmdEvent(env.commandId);
  check(`${name}: ACK`, !!ack && ack.status === 'ACK', JSON.stringify(ack ?? { status: 'NO_ACK' }));
  check(`${name}: reached actuation IPC (bridge would actuate)`,
    !!ev && ev.action === payload.action, ev ? `action=${ev.action}` : 'no command event');
}

client.on('connect', async () => {
  client.subscribe(T.ack);
  // Keep the edge watchdog happy — SIGNED deadman pings only (audit-9): the
  // edge ignores unauthenticated liveness input and keeps counting.
  const ping = setInterval(() => client.publish(T.deadman, JSON.stringify(signDoc({ vehicleId: V, timestamp: Date.now() }))), 800);
  // Keep the pose watchdog happy (silence > 3 s latches fail-closed).
  const pose = setInterval(feedPose, 500);
  feedPose();
  await sleep(700);

  // 0. Release any latch a prior run / watchdog left engaged.
  const clr = envelope({ action: 'CLEAR_SAFE_STOP' }, 'MODE1');
  pub(T.cmd, clr); await waitAck(clr.commandId);

  // 1. Put the vehicle in a Mode-2 zone (depot) via a signed zone-config —
  //    on a public_approved_route the vehicle rejects Mode 2 (ICD §1). The
  //    revision beats any prior run's (anti-replay monotonic).
  const zoneDoc = signDoc({ vehicleId: V, zone: 'depot', issuedAt: Date.now(), revision: Date.now(), issuer: 'SMOKE-TEST' });
  client.publish(T.zoneConfig, JSON.stringify(zoneDoc), { qos: 1 });
  await sleep(500);

  console.log('\n— M3-2: Mode 2 direct driving reaches the CARLA bridge —');
  await drive('forward  (SELECT_DIRECTION FORWARD)', { action: 'SELECT_DIRECTION', direction: 'FORWARD' });
  await drive('backward (SELECT_DIRECTION REVERSE)', { action: 'SELECT_DIRECTION', direction: 'REVERSE' });
  await drive('left     (STEER -20°)', { action: 'STEER', angle: -20 });
  await drive('right    (STEER +20°)', { action: 'STEER', angle: 20 });
  await drive('turn     (TURN LEFT)', { action: 'TURN', direction: 'LEFT' });
  await drive('throttle (DRIVE 30/0)', { action: 'DRIVE', throttle: 30, brake: 0 });
  await drive('brake    (DRIVE 0/60)', { action: 'DRIVE', throttle: 0, brake: 60 });

  console.log('\n— M3-3 preview: E-STOP surfaces as a fail-safe latch on the bridge channel —');
  const before = ipcEvents.length;
  const es = envelope({ action: 'E_STOP' }, 'MODE1');
  pub(T.estop, es);
  const ack = await waitAck(es.commandId);
  const latch = await waitLatched(before);
  check('E-STOP: ACK', !!ack && ack.status === 'ACK', JSON.stringify(ack ?? { status: 'NO_ACK' }));
  check('E-STOP: latch state pushed to bridge (fail-safe brake)', !!latch);

  clearInterval(ping); clearInterval(pose);
  sock.end(); client.end();

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
});

client.on('message', (_t, msg) => {
  try { const a = JSON.parse(msg.toString()); if (a.commandId) acks.set(a.commandId, a); } catch { /* ignore */ }
});
