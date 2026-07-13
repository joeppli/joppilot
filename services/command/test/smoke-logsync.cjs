// M3-6 connection-loss + lossless log sync smoke test (RES-01/02, ICD §9).
// REAL zero-connectivity: this test STOPS the mosquitto container, lets the
// vehicle latch its safe-stop offline (the event is recorded ON THE VEHICLE,
// nowhere else), restarts the broker and proves:
//   1. the edge RECONNECTS and re-subscribes (it still answers commands —
//      without the M3-6 resubscribe fix the vehicle stayed deaf after the
//      first link drop);
//   2. the offline-recorded LATCH_ENGAGED(WATCHDOG) event arrives in the EDR
//      via logsync with the VEHICLE's own event-time timestamp (RES-02);
//   3. the authorized CLEAR after reconnect is also logged + synced.
//
// Prereqs:  docker compose infra up, command service on :4000, edge running
//           (local mosquitto). ⚠️ Briefly stops joppilot_mosquitto.
// Run:      node services/command/test/smoke-logsync.cjs
const mqtt = require('mqtt');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { signDoc } = require('./sign-helper.cjs');

const V = 'VEH-001';
const T = {
  cmd: `joppilot/v1/vehicles/${V}/command`,
  ack: `joppilot/v1/vehicles/${V}/command/ack`,
  deadman: `joppilot/v1/vehicles/${V}/deadman`,
  heartbeat: `joppilot/v1/vehicles/${V}/heartbeat`,
};
const uuid = () => crypto.randomUUID();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
function assert(label, cond, detail) {
  if (cond) { console.log(`✅ ${label}`); passed++; }
  else { console.log(`❌ ${label} — ${detail || 'FAIL'}`); failed++; }
}

function psql(sql) {
  return execSync(
    `docker exec joppilot_postgres psql -U joppilot -d joppilot_db -t -A -c "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8' },
  ).trim();
}

const vlogCount = (type) =>
  Number(psql(`SELECT count(*) FROM command."EventDataRecord" WHERE issuer='VEHICLE-LOG' AND action='${type}'`));

(async () => {
  console.log('\n=== M3-6 connection loss + lossless log sync (RES-01/02) ===\n');

  const acks = new Map();
  const heartbeats = [];
  // mqtt.js reconnects on its own after the broker restart (default 1 s).
  const mq = mqtt.connect(process.env.MQTT_URL || 'mqtt://localhost:1883');
  await new Promise((res) => mq.on('connect', res));
  mq.on('connect', () => mq.subscribe([T.ack, T.heartbeat])); // re-subs on OUR reconnect too
  mq.subscribe([T.ack, T.heartbeat]);
  mq.on('message', (t, m) => {
    try {
      const msg = JSON.parse(m.toString());
      if (t === T.ack) acks.set(msg.commandId, msg);
      if (t === T.heartbeat) heartbeats.push(msg);
    } catch { /* ignore */ }
  });
  const waitAck = (id, ms = 3000) => new Promise((res) => {
    const t = setInterval(() => { if (acks.has(id)) { clearInterval(t); res(acks.get(id)); } }, 50);
    setTimeout(() => { clearInterval(t); res(acks.get(id)); }, ms);
  });
  const envelope = (payload, mode = 'MODE1') => signDoc({
    commandId: uuid(), correlationId: uuid(), sessionId: 'sess-logsync', vehicleId: V,
    issuer: 'OP-LOGSYNC', mode, token: { tokenId: uuid(), issuedAt: Date.now() },
    timestamp: Date.now(), ttlMs: 5000, payload,
  });

  // 0. Healthy baseline: deadman pings + clean latch, note the EDR counts.
  let ping = setInterval(() => mq.publish(T.deadman, JSON.stringify({ timestamp: Date.now() })), 800);
  await sleep(700);
  const clr0 = envelope({ action: 'CLEAR_SAFE_STOP' });
  mq.publish(T.cmd, JSON.stringify(clr0), { qos: 1 });
  await waitAck(clr0.commandId);
  await sleep(2500); // let the (clear-latch) log entries sync out of the way
  const baseEngaged = vlogCount('LATCH_ENGAGED');
  const baseReleased = vlogCount('LATCH_RELEASED');
  console.log(`   (baseline synced rows: engaged=${baseEngaged} released=${baseReleased})`);

  // 1. ZERO CONNECTIVITY: kill the broker itself. The edge's watchdog latches
  //    ~3 s later — an event that happens entirely offline (RES-01) and can
  //    only reach the cloud via the on-vehicle buffer (RES-02).
  clearInterval(ping);
  const offlineStart = Date.now();
  console.log('   stopping mosquitto (real zero-connectivity)…');
  execSync('docker stop joppilot_mosquitto', { stdio: 'ignore' });
  await sleep(6000); // > 3 s watchdog threshold, with margin

  // 2. Link restored.
  console.log('   restarting mosquitto…');
  execSync('docker start joppilot_mosquitto', { stdio: 'ignore' });
  const offlineEnd = Date.now();
  // Give every client (edge / command svc / this test) time to reconnect,
  // then resume operator liveness so the sync drain gate opens.
  await sleep(4000);
  ping = setInterval(() => mq.publish(T.deadman, JSON.stringify({ timestamp: Date.now() })), 800);
  await sleep(4000); // ≥1 sync tick after the drain gate opens

  // 3. The vehicle is latched (offline watchdog) — visible in heartbeats again.
  const latchedHb = heartbeats.slice(-5).find((h) => h.latched === true);
  assert('vehicle latched during the outage (RES-01, heartbeat after reconnect)', !!latchedHb,
    JSON.stringify(heartbeats.slice(-2)));

  // 4. RES-02: the offline LATCH_ENGAGED(WATCHDOG) event synced into the EDR
  //    with the VEHICLE's event-time timestamp inside the outage window.
  const engagedNow = vlogCount('LATCH_ENGAGED');
  assert('offline latch event synced to EDR (VEHICLE-LOG row appended)', engagedNow > baseEngaged,
    `engaged rows before=${baseEngaged} after=${engagedNow}`);
  const lastRow = psql(
    `SELECT details->>'trigger' || '|' || (details->>'vehicleTimestamp') FROM command."EventDataRecord"` +
    ` WHERE issuer='VEHICLE-LOG' AND action='LATCH_ENGAGED' ORDER BY "createdAt" DESC LIMIT 1`,
  );
  const [trigger, vts] = lastRow.split('|');
  assert('synced event carries trigger=WATCHDOG', trigger === 'WATCHDOG', lastRow);
  assert('vehicle event-time falls INSIDE the outage window (lossless, not resynthesized)',
    Number(vts) >= offlineStart - 2000 && Number(vts) <= offlineEnd,
    `vehicleTimestamp=${vts} window=[${offlineStart - 2000}..${offlineEnd}]`);

  // 5. Reconnect correctness: the edge must still ANSWER commands — without
  //    the M3-6 resubscribe-on-ConnAck fix it was deaf after the first drop.
  const clr = envelope({ action: 'CLEAR_SAFE_STOP' });
  mq.publish(T.cmd, JSON.stringify(clr), { qos: 1 });
  const clrAck = await waitAck(clr.commandId);
  assert('edge answers commands after reconnect (resubscribed — not deaf)',
    clrAck?.status === 'ACK', JSON.stringify(clrAck ?? { status: 'NO_ACK' }));

  // 6. …and the release is logged + synced too (ICD §9 evidence chain).
  await sleep(3000);
  const releasedNow = vlogCount('LATCH_RELEASED');
  assert('latch RELEASE synced to EDR after reconnect', releasedNow > baseReleased,
    `released rows before=${baseReleased} after=${releasedNow}`);

  clearInterval(ping);
  mq.end();
  console.log(`\n=== ${passed}/${passed + failed} passed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
  // Never leave the broker down on a crashed run.
  try { execSync('docker start joppilot_mosquitto', { stdio: 'ignore' }); } catch { /* already up */ }
  console.error('smoke-logsync failed to run:', e.message);
  process.exit(1);
});
