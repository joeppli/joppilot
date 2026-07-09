// Zone-change / test-permit smoke test (ICD §1).
// Asserts the permit gate on the cloud zone endpoint: opening Mode 2 on a
// public route must be permit-based, TIME-LIMITED, and admin-only.
//
// Prereqs:  docker compose -f infra/docker-compose.yml up -d
//           command service running on :4000
// Run:      node services/command/test/smoke-zone.cjs
const http = require('http');

const V = 'VEH-ZONE-SMOKE';
let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
  if (condition) {
    console.log(`✅ ${label}`);
    passed++;
  } else {
    console.log(`❌ ${label} — ${detail || 'FAIL'}`);
    failed++;
  }
}

function httpPost(path, body, role = 'admin') {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port: 4000, path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'x-operator-role': role,
      },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  const zonePath = `/api/command/${V}/zone`;

  // 1. Zone change is an admin operation (RBAC guard).
  const asOperator = await httpPost(zonePath, { zone: 'depot' }, 'operator');
  assert('non-admin rejected (UNAUTHORIZED)',
    asOperator.status === 403 && asOperator.body?.reason === 'UNAUTHORIZED',
    JSON.stringify(asOperator));

  // 2. public_test_permit without a permit id → rejected.
  const noPermit = await httpPost(zonePath, { zone: 'public_test_permit', validUntil: Date.now() + 3600_000 });
  assert('permit id required (PERMIT_REQUIRED)',
    noPermit.status === 403 && noPermit.body?.reason === 'PERMIT_REQUIRED',
    JSON.stringify(noPermit));

  // 3. public_test_permit without validUntil → rejected (a permit without a
  //    validity window would open Mode 2 on a public road indefinitely).
  const noWindow = await httpPost(zonePath, { zone: 'public_test_permit', permitId: 'GL-2026-042' });
  assert('validity window required (PERMIT_REQUIRED)',
    noWindow.status === 403 && noWindow.body?.reason === 'PERMIT_REQUIRED',
    JSON.stringify(noWindow));

  // 4. public_test_permit with a validUntil in the past → rejected.
  const expired = await httpPost(zonePath, { zone: 'public_test_permit', permitId: 'GL-2026-042', validUntil: Date.now() - 1000 });
  assert('past validity window rejected (PERMIT_EXPIRED)',
    expired.status === 403 && expired.body?.reason === 'PERMIT_EXPIRED',
    JSON.stringify(expired));

  // 5. Complete permit (id + future window) → accepted.
  const ok = await httpPost(zonePath, {
    zone: 'public_test_permit', permitId: 'GL-2026-042',
    reason: 'canton GL trial segment', validUntil: Date.now() + 3600_000,
  });
  assert('valid permit accepted',
    ok.status === 201 && ok.body?.status === 'success' && ok.body?.zone === 'public_test_permit',
    JSON.stringify(ok));

  // 6. Revert to the safe default (no permit needed for a restrictive zone).
  const revert = await httpPost(zonePath, { zone: 'public_approved_route' });
  assert('revert to safe default',
    revert.status === 201 && revert.body?.status === 'success',
    JSON.stringify(revert));

  // ---- M2-5: DELIVERY to the vehicle (ICD §1 — closes DEV-8) ----
  // The cloud zone change must actually REACH the edge: set VEH-001 (the
  // vehicle the sim edge runs as) to depot via the API, then prove Mode 2 is
  // accepted ON THE VEHICLE; revert and prove it is refused again.
  // Needs the edge + mosquitto running (same prereqs as smoke-edge).
  const EV = 'VEH-001';
  const mqtt = require('mqtt');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const acks = new Map();
  const mq = mqtt.connect(process.env.MQTT_URL || 'mqtt://localhost:1883');
  await new Promise((res) => mq.on('connect', res));
  mq.subscribe(`joppilot/v1/vehicles/${EV}/command/ack`);
  mq.on('message', (t, m) => { try { const a = JSON.parse(m.toString()); acks.set(a.commandId, a); } catch {} });
  const waitAck = (id, ms = 2000) => new Promise((res) => {
    const t = setInterval(() => { if (acks.has(id)) { clearInterval(t); res(acks.get(id)); } }, 30);
    setTimeout(() => { clearInterval(t); res(acks.get(id)); }, ms);
  });

  // Session bootstrap (assignment enforcement may be on).
  const OP = `OP-ZONE-SMOKE-${Date.now()}`;
  let tc = await httpPost(`/api/command/${EV}/take-control`, { operatorId: OP }, 'operator');
  if (tc.status === 403) {
    await httpPost(`/api/command/${EV}/assign`, { operatorId: OP, assignedBy: 'ADMIN-SMOKE' });
    tc = await httpPost(`/api/command/${EV}/take-control`, { operatorId: OP }, 'operator');
  }
  const token = tc.body?.token;
  const hb = setInterval(() => httpPost(`/api/command/${EV}/heartbeat`, { operatorId: OP, token }, 'operator').catch(() => {}), 2000);
  await httpPost(`/api/command/${EV}/heartbeat`, { operatorId: OP, token }, 'operator');

  // The edge latches a safe-stop whenever the previous test's deadman pings
  // stop (correct RES-01 behaviour) — release it with the authorized action
  // before driving (ICD §9).
  const clear = await httpPost(`/api/command/${EV}/clear-safe-stop`, { operatorId: OP, token }, 'operator');
  if (clear.body?.commandId) await waitAck(clear.body.commandId);

  // 7a. Since M2-5 EVERY Mode-2-capable zone needs an authorization artifact
  // + validity window — a free-form depot label must be refused (DEV-14).
  const bareDepot = await httpPost(`/api/command/${EV}/zone`, { zone: 'depot' });
  assert('free-form depot rejected (PERMIT_REQUIRED)',
    bareDepot.status === 403 && bareDepot.body?.reason === 'PERMIT_REQUIRED', JSON.stringify(bareDepot.body));

  // 7b. Depot with a site authorization → delivered to the edge → Mode 2
  // ACCEPTED on the vehicle.
  const toDepot = await httpPost(`/api/command/${EV}/zone`, { zone: 'depot', permitId: 'SITE-DEPOT-GL-01', validUntil: Date.now() + 3600_000 });
  assert('depot change delivered to vehicle', toDepot.status === 201 && toDepot.body?.delivered === true, JSON.stringify(toDepot.body));
  await wait(400);
  const creep = await httpPost(`/api/command/${EV}/command`, { operatorId: OP, token, payload: { action: 'CREEP', speedKmh: 2 } }, 'operator');
  const creepAck = creep.body?.commandId ? await waitAck(creep.body.commandId) : undefined;
  assert('mode2 ACCEPTED on vehicle after depot config (DEV-8)', creepAck?.status === 'ACK', JSON.stringify({ creep: creep.body, ack: creepAck }));

  // 8. Revert via API → Mode 2 REFUSED on the vehicle again.
  const back = await httpPost(`/api/command/${EV}/zone`, { zone: 'public_approved_route' });
  assert('revert delivered to vehicle', back.status === 201 && back.body?.delivered === true, JSON.stringify(back.body));
  await wait(400);
  // Gate 1 already refuses MODE2 in this zone (cloud + edge agree post-delivery).
  const creep2 = await httpPost(`/api/command/${EV}/command`, { operatorId: OP, token, payload: { action: 'CREEP', speedKmh: 2 } }, 'operator');
  assert('mode2 refused after revert', creep2.status === 403 && creep2.body?.reason === 'MODE_MISMATCH', JSON.stringify(creep2.body));

  clearInterval(hb);
  mq.end();

  console.log(`\n=== ${passed}/${passed + failed} passed ===`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('Smoke test failed to run (are the command service on :4000, mosquitto and the edge up?)', e.message);
  process.exit(1);
});
