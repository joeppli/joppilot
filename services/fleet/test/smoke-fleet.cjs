// Fleet & Mission + Pre-departure Check smoke test (ICD §7, LEG-03).
//
// Since audit-7 the fleet workflows are OPERATOR actions: every mutating call
// must carry the vehicle's active fencing token (SEC-05), so this test needs
// the COMMAND service (port 4000) + Valkey running too — take-control first,
// then drive the fleet API with the token.
// Run: node services/fleet/test/smoke-fleet.cjs
const http = require('http');

const V = 'VEH-001';
const OP = `OP-FLEET-SMOKE-${Date.now()}`;
let passed = 0, failed = 0;
let token = null;

function assert(label, cond, detail) {
  if (cond) { console.log(`✅ ${label}`); passed++; }
  else { console.log(`❌ ${label} — ${detail || 'FAIL'}`); failed++; }
}

function request(port, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: '127.0.0.1', port, path, method,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve({ s: res.statusCode, b: JSON.parse(buf) }); } catch { resolve({ s: res.statusCode, b: buf }); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Fleet API (4002): mutating calls carry the fencing token.
const post = (path, body) => request(4002, 'POST', `/api/fleet${path}`, { operatorId: OP, token, ...(body ?? {}) });
const postNoAuth = (path, body) => request(4002, 'POST', `/api/fleet${path}`, body);
const get = (path) => request(4002, 'GET', `/api/fleet${path}`);
// Command API (4000): session bootstrap.
const cmd = (path, body, headers) => request(4000, 'POST', `/api/command/${V}${path}`, body, headers);

(async () => {
  console.log('\n=== Fleet & Mission Smoke Test ===\n');

  // 0. Session bootstrap: take control (assign first if enforcement is on).
  let tc = await cmd('/take-control', { operatorId: OP });
  if (tc.s === 403 && tc.b?.reason === 'NO_ASSIGNMENT') {
    await cmd('/assign', { operatorId: OP, assignedBy: 'ADMIN-SMOKE' }, { 'x-operator-role': 'admin' });
    tc = await cmd('/take-control', { operatorId: OP });
  }
  token = tc.b?.token;
  assert('take-control', !!token, `${tc.s}: ${JSON.stringify(tc.b)}`);
  if (!token) { console.error('Cannot continue without control (is the command service on 4000 up?)'); process.exit(1); }
  // Keep the 6 s fencing lock alive for the whole run.
  const hb = setInterval(() => cmd('/heartbeat', { operatorId: OP, token }).catch(() => {}), 2000);

  // 0b. SEC-05: a mutating fleet call WITHOUT the token is refused.
  const noAuth = await postNoAuth(`/${V}/mission`, { routeId: 'route-x' });
  assert('mutating-call-without-token-401', noAuth.s === 401, `${noAuth.s}`);

  // 1. Create mission (auto-creates pre-departure checklist)
  const m = await post(`/${V}/mission`, { routeId: 'route-glarus-01' });
  assert('create-mission', m.s === 201, `${m.s}: ${JSON.stringify(m.b)}`);
  const missionId = m.b?.mission?.id;
  const checklistId = m.b?.checklist?.checklistId;
  assert('mission-has-id', !!missionId);
  assert('mission-pre-check', m.b?.mission?.status === 'PRE_CHECK');
  assert('checklist-created', !!checklistId);

  // 2. Try starting without confirmed checklist
  const earlyStart = await post(`/mission/${missionId}/start`);
  assert('start-blocked-before-confirm', earlyStart.s === 400, `${earlyStart.s}`);

  // 3. Get checklist and check items
  const cl = await get(`/pre-departure/${checklistId}`);
  assert('checklist-fetch', cl.s === 200);
  const items = cl.b?.items || [];
  const pendingItems = items.filter(i => i.status === 'PENDING');
  const autoPassItems = items.filter(i => i.status === 'PASS');
  assert('self-diag-auto-pass', autoPassItems.length === 7, `auto-pass: ${autoPassItems.length}`);
  assert('operator-items-pending', pendingItems.length === 3, `pending: ${pendingItems.length}`);

  // 4. Operator marks items
  for (const item of pendingItems) {
    const r = await post(`/pre-departure/${checklistId}/item/${item.itemId}`, { status: 'PASS' });
    assert(`mark-${item.itemId}`, r.s === 200 || r.s === 201, `${r.s}`);
  }

  // 5. Try confirm before fail scenario — confirm should work now
  const confirm = await post(`/pre-departure/${checklistId}/confirm`);
  assert('confirm-checklist', confirm.s === 200 || confirm.s === 201, `${confirm.s}: ${JSON.stringify(confirm.b)}`);

  // 6. Start mission after confirmed checklist
  const start = await post(`/mission/${missionId}/start`);
  assert('start-mission', start.s === 200 || start.s === 201, `${start.s}: ${JSON.stringify(start.b)}`);
  assert('mission-active', start.b?.status === 'ACTIVE');

  // 7. Pause
  const pause = await post(`/mission/${missionId}/pause`);
  assert('pause-mission', pause.b?.status === 'PAUSED');

  // 8. Resume
  const resume = await post(`/mission/${missionId}/resume`);
  assert('resume-mission', resume.b?.status === 'ACTIVE');

  // 9. Complete
  const complete = await post(`/mission/${missionId}/complete`);
  assert('complete-mission', complete.b?.status === 'COMPLETED');

  // 10. Cannot start new op on completed mission
  const reStart = await post(`/mission/${missionId}/start`);
  assert('restart-blocked', reStart.s === 400);

  // 11. New mission works after completion
  const m2 = await post(`/${V}/mission`);
  assert('new-mission-after-complete', m2.s === 201 && !!m2.b?.mission?.id);

  // Cleanup: abort the second mission
  await post(`/mission/${m2.b.mission.id}/abort`);

  // 12. Safety-critical fail blocks confirm
  const m3 = await post(`/${V}/mission`);
  const cl3 = m3.b?.checklist?.checklistId;
  // Mark tires as FAIL
  await post(`/pre-departure/${cl3}/item/tires`, { status: 'FAIL', detail: 'Low pressure rear left' });
  await post(`/pre-departure/${cl3}/item/lights-head`, { status: 'PASS' });
  await post(`/pre-departure/${cl3}/item/lights-turn`, { status: 'PASS' });
  const failConfirm = await post(`/pre-departure/${cl3}/confirm`);
  assert('critical-fail-blocks-confirm', failConfirm.s === 400, `${failConfirm.s}`);

  // 13. LEG-04 (ICD §7 step 4): the confirmation + item checks + mission
  // transitions and the REJECTED confirm attempt are all audit rows.
  const { Client } = tryRequirePg();
  if (Client) {
    const c = new Client({ connectionString: 'postgresql://joppilot:joppilot_secret@localhost:5432/joppilot_db' });
    await c.connect();
    const audit = await c.query('SELECT action, status FROM fleet."FleetEventRecord" WHERE "correlationId" = $1', [checklistId]);
    const actions = audit.rows.map(r => `${r.action}:${r.status}`);
    assert('audit-confirm-recorded', actions.includes('CHECKLIST_CONFIRM:ACK'), JSON.stringify(actions));
    assert('audit-items-recorded', audit.rows.filter(r => r.action === 'CHECK_ITEM_SET').length === 3, JSON.stringify(actions));
    const rejected = await c.query('SELECT 1 FROM fleet."FleetEventRecord" WHERE "correlationId" = $1 AND action = $2 AND status = $3', [cl3, 'CHECKLIST_CONFIRM', 'REJECTED']);
    assert('audit-rejected-confirm-recorded', rejected.rowCount === 1);
    await c.end();
  } else {
    console.log('ℹ️  pg module not found — skipping direct audit-row asserts');
  }

  // Cleanup
  await post(`/mission/${m3.b.mission.id}/abort`);

  clearInterval(hb);
  console.log(`\n=== ${passed}/${passed + failed} passed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

function tryRequirePg() {
  // telemetry service ships node-postgres; resolve it from there so this test
  // adds no dependency of its own.
  try { return require(require.resolve('pg', { paths: [__dirname + '/../../telemetry/node_modules'] })); }
  catch { try { return require('pg'); } catch { return {}; } }
}
