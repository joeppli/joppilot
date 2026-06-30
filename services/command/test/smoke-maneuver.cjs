// Maneuver Proposal end-to-end smoke test (ICD §6).
// Tests: edge generates proposal → cloud receives → decision dispatched → edge applies → status update
//
// Prereqs:  docker compose up, services running, edge/sim running
// Run:      node services/command/test/smoke-maneuver.cjs
const mqtt = require('mqtt');
const http = require('http');

const crypto = require('crypto');

const V = 'VEH-001';
const uuid = () => crypto.randomUUID();
const TOPICS = {
  proposal: `joppilot/v1/vehicles/${V}/maneuver/proposal`,
  status: `joppilot/v1/vehicles/${V}/maneuver/status`,
  ack: `joppilot/v1/vehicles/${V}/command/ack`,
  deadman: `joppilot/v1/vehicles/${V}/deadman`,
  cmd: `joppilot/v1/vehicles/${V}/command`,
  estop: `joppilot/v1/vehicles/${V}/estop`,
};

const client = mqtt.connect(process.env.MQTT_URL || 'mqtt://localhost:1883');
const proposals = [];
const statusUpdates = [];
const acks = new Map();

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

function httpPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port: 4000, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
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

function waitFor(arr, predicate, ms = 5000) {
  return new Promise((res) => {
    const t = setInterval(() => {
      const found = arr.find(predicate);
      if (found) { clearInterval(t); res(found); }
    }, 100);
    setTimeout(() => { clearInterval(t); res(null); }, ms);
  });
}

function waitAck(commandId, ms = 3000) {
  return new Promise((res) => {
    const t = setInterval(() => { if (acks.has(commandId)) { clearInterval(t); res(acks.get(commandId)); } }, 50);
    setTimeout(() => { clearInterval(t); res(null); }, ms);
  });
}

client.on('connect', () => {
  client.subscribe([TOPICS.proposal, TOPICS.status, TOPICS.ack], async () => {
    console.log('\n=== Maneuver Proposal Smoke Test ===\n');

    // Keep the edge watchdog happy with deadman pings (every 1s)
    const deadmanInterval = setInterval(() => {
      client.publish(TOPICS.deadman, JSON.stringify({ timestamp: Date.now() }));
    }, 1000);

    // Clear any existing safe-stop latch from prior tests
    const clearEnv = {
      commandId: uuid(), sessionId: 'sess-smoke', vehicleId: V, issuer: 'OP-SMOKE',
      mode: 'MODE1', token: { tokenId: uuid(), issuedAt: Date.now() },
      timestamp: Date.now(), ttlMs: 5000, payload: { action: 'CLEAR_SAFE_STOP' },
    };
    client.publish(TOPICS.cmd, JSON.stringify(clearEnv));
    await new Promise(r => setTimeout(r, 1000));

    // 1. Wait for the edge to produce a proposal
    console.log('Waiting for a maneuver proposal from edge sim...');
    const proposal = await waitFor(proposals, () => true, 40000);
    assert('proposal-received', !!proposal, 'No proposal received within 40s');
    if (!proposal) { finish(); return; }

    assert('proposal-has-options', proposal.options && proposal.options.length >= 1,
      `Expected >=1 options, got ${proposal.options?.length}`);
    assert('proposal-has-validity', proposal.validityWindowMs > 0,
      `Expected positive validity window, got ${proposal.validityWindowMs}`);
    assert('proposal-has-default', !!proposal.defaultOnTimeout,
      'Missing defaultOnTimeout');

    // Check PENDING status was received
    const pendingStatus = await waitFor(statusUpdates,
      (s) => s.proposalId === proposal.proposalId && s.status === 'PENDING', 3000);
    assert('status-pending', !!pendingStatus, 'No PENDING status update');

    // 2. Take control so we have a valid token
    const controlRes = await httpPost(`/api/command/${V}/take-control`, { operatorId: 'OP-SMOKE' });
    assert('take-control', controlRes.status === 200 || controlRes.status === 201,
      `Status ${controlRes.status}: ${JSON.stringify(controlRes.body)}`);
    const token = controlRes.body?.token;

    // 3. Send a maneuver decision (SELECT_ALTERNATIVE with the first option)
    const selectedOption = proposal.options[0].optionId;
    const decideRes = await httpPost(`/api/maneuver/${proposal.proposalId}/decide`, {
      operatorId: 'OP-SMOKE',
      token,
      decision: 'SELECT_ALTERNATIVE',
      optionId: selectedOption,
    });
    assert('decide-accepted', decideRes.status === 200 || decideRes.status === 201,
      `Status ${decideRes.status}: ${JSON.stringify(decideRes.body)}`);

    // 4. Wait for edge ACK (the decision is sent as a regular command)
    if (decideRes.body?.commandId) {
      const ack = await waitAck(decideRes.body.commandId, 3000);
      assert('edge-ack', ack && ack.status === 'ACK',
        `Expected ACK, got ${JSON.stringify(ack)}`);
    } else {
      assert('edge-ack', false, 'No commandId in decide response');
    }

    // 5. Wait for DECIDED status from edge
    const decidedStatus = await waitFor(statusUpdates,
      (s) => s.proposalId === proposal.proposalId && s.status === 'DECIDED', 5000);
    assert('status-decided', !!decidedStatus, 'No DECIDED status update');
    assert('status-decided-option', decidedStatus?.selectedOptionId === selectedOption,
      `Expected option ${selectedOption}, got ${decidedStatus?.selectedOptionId}`);

    // 6. Verify no stale proposal for a 404 (proposal already resolved)
    const staleRes = await httpPost(`/api/maneuver/${proposal.proposalId}/decide`, {
      operatorId: 'OP-SMOKE', token, decision: 'CONFIRM',
    });
    assert('stale-proposal-404', staleRes.status === 404,
      `Expected 404, got ${staleRes.status}`);

    clearInterval(deadmanInterval);
    finish();
  });
});

client.on('message', (topic, message) => {
  try {
    const msg = JSON.parse(message.toString());
    if (topic === TOPICS.proposal) proposals.push(msg);
    if (topic === TOPICS.status) statusUpdates.push(msg);
    if (topic === TOPICS.ack) acks.set(msg.commandId, msg);
  } catch {}
});

function finish() {
  console.log(`\n=== ${passed}/${passed + failed} passed ===\n`);
  client.end();
  process.exit(failed > 0 ? 1 : 0);
}

setTimeout(() => {
  console.log('\n⏰ Global timeout (60s) reached');
  finish();
}, 60000);
