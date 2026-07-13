// M3-3 E-STOP path smoke test (ICD §3/§4).
// Proves the dual-MESSAGE E-STOP through the cloud Gate 1:
//   POST /estop → the SAME signed envelope (one command_id) is published
//   SIMULTANEOUSLY on the dedicated estop topic AND the command topic; the
//   edge applies whichever arrives first, latches, and DEDUPLICATES the
//   second copy by command_id — replaying the IDENTICAL ACK (no double stop).
// True dual-PATH (independent transports/carriers, AD-3) is the August
// channel-reliability work; this test covers the M3-3 dual-message half.
//
// Prereqs:  docker compose -f infra/docker-compose.yml up -d   (mosquitto+valkey+postgres)
//           services/command running on :4000
//           cd edge/sim && EDGE_CLOUD_PUBKEY=<dev pubkey> cargo run
// Run:      node services/command/test/smoke-estop.cjs
const mqtt = require('mqtt');
const http = require('http');
const { signDoc } = require('./sign-helper.cjs'); // signed deadman pings (audit-9)

const V = 'VEH-001';
const T = {
  estop: `joppilot/v1/vehicles/${V}/estop`,
  cmd: `joppilot/v1/vehicles/${V}/command`,
  ack: `joppilot/v1/vehicles/${V}/command/ack`,
  deadman: `joppilot/v1/vehicles/${V}/deadman`,
  heartbeat: `joppilot/v1/vehicles/${V}/heartbeat`,
};

const client = mqtt.connect(process.env.MQTT_URL || 'mqtt://localhost:1883');
const estopMsgs = [];   // envelopes seen on the estop topic
const cmdMsgs = [];     // envelopes seen on the command topic
const ackMsgs = [];     // EVERY ack publish (array, not map — duplicates count)
const heartbeats = [];

let passed = 0, failed = 0;
function assert(label, cond, detail) {
  if (cond) { console.log(`✅ ${label}`); passed++; }
  else { console.log(`❌ ${label} — ${detail || 'FAIL'}`); failed++; }
}

function httpPost(path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port: 4000, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...extraHeaders },
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

function waitFor(fn, ms = 4000) {
  return new Promise((res) => {
    const t = setInterval(() => { const v = fn(); if (v) { clearInterval(t); res(v); } }, 50);
    setTimeout(() => { clearInterval(t); res(fn() || null); }, ms);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

client.on('message', (topic, message) => {
  try {
    const msg = JSON.parse(message.toString());
    if (topic === T.estop) estopMsgs.push({ raw: message.toString(), msg });
    if (topic === T.cmd) cmdMsgs.push({ raw: message.toString(), msg });
    if (topic === T.ack) ackMsgs.push({ raw: message.toString(), msg });
    if (topic === T.heartbeat) heartbeats.push(msg);
  } catch { /* ignore */ }
});

client.on('connect', () => {
  client.subscribe([T.estop, T.cmd, T.ack, T.heartbeat], async () => {
    console.log('\n=== M3-3 E-STOP dual-message smoke test (ICD §3) ===\n');
    const ping = setInterval(() => client.publish(T.deadman, JSON.stringify(signDoc({ vehicleId: V, timestamp: Date.now() }))), 800);

    // ONE session for the whole run. The fencing lock lives 6 s (SEC-05) and
    // take-control is SET NX — re-taking while the lock is alive fails by
    // design. So do what the console does: take control once, then keep the
    // session alive with the cloud /heartbeat (also resets the cloud deadman —
    // otherwise it fires at ~7 s and injects its own SAFE_STOP mid-test).
    const ctl = await httpPost(`/api/command/${V}/take-control`, { operatorId: 'OP-SMOKE' });
    assert('take-control', (ctl.status === 200 || ctl.status === 201) && !!ctl.body?.token,
      `Status ${ctl.status}: ${JSON.stringify(ctl.body)}`);
    const token = ctl.body?.token;
    const hbLoop = setInterval(() => httpPost(`/api/command/${V}/heartbeat`, { operatorId: 'OP-SMOKE', token }).catch(() => {}), 2000);

    // Clean latch (a prior run/watchdog may have latched).
    await httpPost(`/api/command/${V}/clear-safe-stop`, { operatorId: 'OP-SMOKE', token });
    await sleep(1200);

    // 1. Trigger the E-STOP through the cloud.
    const before = { estop: estopMsgs.length, cmd: cmdMsgs.length, ack: ackMsgs.length };
    const res = await httpPost(`/api/command/${V}/estop`, { operatorId: 'OP-SMOKE', token });
    assert('estop-accepted', (res.status === 200 || res.status === 201) && !!res.body?.commandId,
      `Status ${res.status}: ${JSON.stringify(res.body)}`);
    const commandId = res.body?.commandId;

    // 2. Gate 1 reports BOTH message paths delivered (ICD §3).
    assert('dual-channels-reported', res.body?.channels?.estop === true && res.body?.channels?.command === true,
      `channels=${JSON.stringify(res.body?.channels)}`);

    // 3. The SAME envelope lands on BOTH topics (one command_id, one signature).
    const onEstop = await waitFor(() => estopMsgs.slice(before.estop).find((m) => m.msg.commandId === commandId));
    const onCmd = await waitFor(() => cmdMsgs.slice(before.cmd).find((m) => m.msg.commandId === commandId));
    assert('copy-on-estop-topic', !!onEstop, 'No E-STOP envelope on the estop topic');
    assert('copy-on-command-topic', !!onCmd, 'No E-STOP envelope on the command topic');
    assert('copies-identical', !!onEstop && !!onCmd && onEstop.raw === onCmd.raw,
      'The two copies differ — dedup by command_id requires the SAME envelope');

    // 4. Both copies are answered, IDENTICALLY: first applied, second deduped
    //    ("applied once, same response" — ICD §4). Two ack publishes, equal.
    await waitFor(() => ackMsgs.slice(before.ack).filter((a) => a.msg.commandId === commandId).length >= 2, 5000);
    const acks = ackMsgs.slice(before.ack).filter((a) => a.msg.commandId === commandId);
    assert('acked-both-copies', acks.length >= 2, `Expected ≥2 ACK publishes, got ${acks.length}`);
    assert('acks-identical-ACK', acks.length >= 2 && acks.every((a) => a.raw === acks[0].raw && a.msg.status === 'ACK'),
      `ACKs differ or not ACK: ${acks.map((a) => a.raw).join(' | ')}`);

    // 5. The vehicle is latched (heartbeat carries the latch flag, RES-04).
    const hbBefore = heartbeats.length;
    const latched = await waitFor(() => heartbeats.slice(hbBefore).find((h) => h.latched === true), 4000);
    assert('vehicle-latched', !!latched, 'No latched=true heartbeat after E-STOP');

    // 6. Only an authorized CLEAR releases it (ICD §9) — cleanup doubles as check.
    const clr = await httpPost(`/api/command/${V}/clear-safe-stop`, { operatorId: 'OP-SMOKE', token });
    assert('clear-accepted', clr.status === 200 || clr.status === 201, `Status ${clr.status}: ${JSON.stringify(clr.body)}`);
    const hbAfterClear = heartbeats.length;
    const released = await waitFor(() => heartbeats.slice(hbAfterClear).find((h) => h.latched === false), 4000);
    assert('latch-released', !!released, 'No latched=false heartbeat after CLEAR_SAFE_STOP');

    clearInterval(ping);
    clearInterval(hbLoop);
    console.log(`\n=== ${passed}/${passed + failed} passed ===\n`);
    client.end();
    process.exit(failed > 0 ? 1 : 0);
  });
});

setTimeout(() => { console.log('\n⏰ Global timeout (45s)'); client.end(); process.exit(1); }, 45000);
