// Edge 2nd-gate smoke test (ICD §4/§8/§9).
// Drives the Rust edge over MQTT and asserts the authoritative-gate behaviours.
//
// Prereqs:  docker compose -f infra/docker-compose.yml up -d mosquitto
//           (cd edge/sim && cargo run)        # leave it running
// Run:      node services/command/test/smoke-edge.cjs
const mqtt = require('mqtt'); // resolves from services/command/node_modules
const crypto = require('crypto');
const { signDoc } = require('./sign-helper.cjs');

const V = 'VEH-001';
const T = {
  cmd: `joppilot/v1/vehicles/${V}/command`,
  estop: `joppilot/v1/vehicles/${V}/estop`,
  ack: `joppilot/v1/vehicles/${V}/command/ack`,
  deadman: `joppilot/v1/vehicles/${V}/deadman`,
  zoneConfig: `joppilot/v1/vehicles/${V}/zone-config`,
};
const uuid = () => crypto.randomUUID();
const acks = new Map();
const client = mqtt.connect(process.env.MQTT_URL || 'mqtt://localhost:1883');

// Every envelope is SIGNED since M2-5 (ICD §4) — the edge NACKs anything else.
const base = (over = {}) => signDoc({
  commandId: uuid(), correlationId: uuid(), sessionId: 'sess-1', vehicleId: V, issuer: 'OP-1', mode: 'MODE1',
  token: { tokenId: uuid(), issuedAt: Date.now() },
  timestamp: Date.now(), ttlMs: 5000, payload: { action: 'START_MISSION' }, ...over,
});

function waitAck(commandId, ms = 1500) {
  return new Promise((res) => {
    const t = setInterval(() => { if (acks.has(commandId)) { clearInterval(t); res(acks.get(commandId)); } }, 30);
    setTimeout(() => { clearInterval(t); res(acks.get(commandId)); }, ms);
  });
}
const pub = (topic, env) => client.publish(topic, JSON.stringify(env), { qos: 1 });
const results = [];
function check(name, got, wantStatus, wantReason) {
  got = got ?? { status: 'NO_ACK' };
  const ok = got.status === wantStatus && (wantReason === undefined || got.reason === wantReason);
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name} → ${JSON.stringify(got)}`);
}

client.on('connect', async () => {
  client.subscribe(T.ack);
  const sendPing = () => client.publish(T.deadman, JSON.stringify(signDoc({ vehicleId: V, timestamp: Date.now() })));
  sendPing();
  const ping = setInterval(sendPing, 800); // keep the edge watchdog happy
  await new Promise((r) => setTimeout(r, 500));

  // Clear any prior safe-stop latch (e.g. from watchdog or prior test runs)
  const pre = base({ payload: { action: 'CLEAR_SAFE_STOP' }, token: { tokenId: uuid(), issuedAt: Date.now() } });
  pub(T.cmd, pre); await waitAck(pre.commandId);

  const c = base(); delete c.ttlMs;
  pub(T.cmd, c); check('schema-invalid', await waitAck(c.commandId), 'REJECTED', 'SCHEMA_INVALID');

  // SEC-06: correlationId is REQUIRED since M2-4 — the audit chain must be
  // able to correlate every record; the vehicle refuses an envelope without it.
  const c2 = base(); delete c2.correlationId;
  pub(T.cmd, c2); check('missing-correlation-id', await waitAck(c2.commandId), 'REJECTED', 'SCHEMA_INVALID');

  const d = base({ timestamp: Date.now() - 10000, ttlMs: 2000 });
  pub(T.cmd, d); check('ttl-expired', await waitAck(d.commandId), 'REJECTED', 'TTL_EXPIRED');

  // ICD §4: the envelope names its TARGET vehicle. Gate 2 refuses a command
  // addressed to another vehicle regardless of the topic it arrived on —
  // cloud routing can be wrong or spoofed (audit-7 finding 5).
  const w = base({ vehicleId: 'VEH-999' });
  pub(T.cmd, w); check('wrong-target-vehicle', await waitAck(w.commandId), 'REJECTED', 'UNAUTHORIZED');

  const b = base({ mode: 'MODE2', payload: { action: 'STEER', angle: -1.5 }, token: { tokenId: uuid(), issuedAt: Date.now() - 1 } });
  pub(T.cmd, b); check('mode2-on-public', await waitAck(b.commandId), 'REJECTED', 'MODE_MISMATCH');

  // ICD §1: a Mode 2 driving command MISLABELLED as MODE1 must not ride the
  // Mode 1 allowance through the zone matrix — the edge derives the mode from
  // the action itself (mode-action consistency, audit-5 finding 1).
  const b2 = base({ mode: 'MODE1', payload: { action: 'DRIVE', throttle: 20, brake: 0 }, token: { tokenId: uuid(), issuedAt: Date.now() - 1 } });
  pub(T.cmd, b2); check('mode-spoof-drive-as-mode1', await waitAck(b2.commandId), 'REJECTED', 'MODE_MISMATCH');

  const aTok = Date.now() + 100;
  const a = base({ token: { tokenId: uuid(), issuedAt: aTok } });
  pub(T.cmd, a); check('valid-mode1', await waitAck(a.commandId), 'ACK');

  pub(T.cmd, a); await new Promise((r) => setTimeout(r, 300));
  check('duplicate-replay', acks.get(a.commandId), 'ACK');

  const j = base({ token: { tokenId: uuid(), issuedAt: aTok - 5000 } });
  pub(T.cmd, j); check('stale-token', await waitAck(j.commandId), 'REJECTED', 'INVALID_TOKEN');

  const f = base({ payload: { action: 'E_STOP' }, token: { tokenId: uuid(), issuedAt: Date.now() + 200 } });
  pub(T.estop, f); check('estop-latch', await waitAck(f.commandId), 'ACK');

  const g = base({ token: { tokenId: uuid(), issuedAt: Date.now() + 300 } });
  pub(T.cmd, g); check('latched-rejects', await waitAck(g.commandId), 'REJECTED', 'SAFE_STOP_LATCHED');

  const h = base({ payload: { action: 'CLEAR_SAFE_STOP' }, token: { tokenId: uuid(), issuedAt: Date.now() + 400 } });
  pub(T.cmd, h); check('clear-latch', await waitAck(h.commandId), 'ACK');

  const i = base({ token: { tokenId: uuid(), issuedAt: Date.now() + 500 } });
  pub(T.cmd, i); check('resume-after-clear', await waitAck(i.commandId), 'ACK');

  // --- M2-5: mandatory cloud signature (ICD §4) ---
  // Unsigned envelope → the schema itself requires `signature` now.
  const un = { ...base({ token: { tokenId: uuid(), issuedAt: Date.now() + 600 } }) };
  delete un.signature;
  pub(T.cmd, un); check('unsigned-rejected', await waitAck(un.commandId), 'REJECTED', 'SCHEMA_INVALID');

  // Valid signature over a THEN-tampered payload → verification must fail.
  const tp = base({ token: { tokenId: uuid(), issuedAt: Date.now() + 700 } });
  tp.payload = { action: 'HORN', durationMs: 100 }; // mutated AFTER signing
  pub(T.cmd, tp); check('tampered-rejected', await waitAck(tp.commandId), 'REJECTED', 'SCHEMA_INVALID');

  // --- M2-5: signed zone-config delivery (ICD §1, closes DEV-8) ---
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const rev = Date.now();
  const zoneCfg = (over = {}) => signDoc({ vehicleId: V, zone: 'depot', issuedAt: Date.now(), revision: rev, issuer: 'SMOKE-ADMIN', ...over });

  // A verified depot config opens Mode 2 on the vehicle.
  client.publish(T.zoneConfig, JSON.stringify(zoneCfg()), { qos: 1 });
  await wait(300);
  const creep1 = base({ mode: 'MODE2', payload: { action: 'CREEP', speedKmh: 2 }, token: { tokenId: uuid(), issuedAt: Date.now() + 800 } });
  pub(T.cmd, creep1); check('zone-config-applied-mode2-ack', await waitAck(creep1.commandId), 'ACK');

  // A REPLAYED older config (valid signature, lower revision) must be ignored.
  client.publish(T.zoneConfig, JSON.stringify(zoneCfg({ zone: 'public_approved_route', revision: rev - 10000 })), { qos: 1 });
  await wait(300);
  const creep2 = base({ mode: 'MODE2', payload: { action: 'CREEP', speedKmh: 2 }, token: { tokenId: uuid(), issuedAt: Date.now() + 900 } });
  pub(T.cmd, creep2); check('zone-config-replay-ignored', await waitAck(creep2.commandId), 'ACK');

  // A tampered config (signed, then zone flipped) must be ignored.
  const tampered = zoneCfg({ zone: 'public_approved_route', revision: rev + 1 });
  tampered.zone = 'depot';
  client.publish(T.zoneConfig, JSON.stringify(tampered), { qos: 1 });
  await wait(300);
  const creep3 = base({ mode: 'MODE2', payload: { action: 'CREEP', speedKmh: 2 }, token: { tokenId: uuid(), issuedAt: Date.now() + 1000 } });
  pub(T.cmd, creep3); check('zone-config-tamper-ignored', await waitAck(creep3.commandId), 'ACK');

  // Restore the public route (retained, so the edge re-learns it on restart);
  // Mode 2 must be refused again.
  client.publish(T.zoneConfig, JSON.stringify(zoneCfg({ zone: 'public_approved_route', revision: rev + 2 })), { qos: 1, retain: true });
  await wait(300);
  const creep4 = base({ mode: 'MODE2', payload: { action: 'CREEP', speedKmh: 2 }, token: { tokenId: uuid(), issuedAt: Date.now() + 1100 } });
  pub(T.cmd, creep4); check('zone-config-restore-mode2-rejected', await waitAck(creep4.commandId), 'REJECTED', 'MODE_MISMATCH');

  clearInterval(ping);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n=== ${passed}/${results.length} passed ===`);
  client.end();
  process.exit(passed === results.length ? 0 : 1);
});

client.on('message', (topic, msg) => {
  if (topic === T.ack) { try { const a = JSON.parse(msg.toString()); acks.set(a.commandId, a); } catch {} }
});
