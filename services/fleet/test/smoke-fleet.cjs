// Fleet & Mission + Pre-departure Check smoke test (ICD §7, LEG-03)
// Run: node services/fleet/test/smoke-fleet.cjs
const http = require('http');

const V = 'VEH-001';
let passed = 0, failed = 0;

function assert(label, cond, detail) {
  if (cond) { console.log(`✅ ${label}`); passed++; }
  else { console.log(`❌ ${label} — ${detail || 'FAIL'}`); failed++; }
}

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request({
      hostname: '127.0.0.1', port: 4002, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
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

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: 4002, path }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve({ s: res.statusCode, b: JSON.parse(buf) }); } catch { resolve({ s: res.statusCode, b: buf }); } });
    }).on('error', reject);
  });
}

(async () => {
  console.log('\n=== Fleet & Mission Smoke Test ===\n');

  // 1. Create mission (auto-creates pre-departure checklist)
  const m = await post(`/api/fleet/${V}/mission`, { routeId: 'route-glarus-01' });
  assert('create-mission', m.s === 201, `${m.s}: ${JSON.stringify(m.b)}`);
  const missionId = m.b?.mission?.id;
  const checklistId = m.b?.checklist?.checklistId;
  assert('mission-has-id', !!missionId);
  assert('mission-pre-check', m.b?.mission?.status === 'PRE_CHECK');
  assert('checklist-created', !!checklistId);

  // 2. Try starting without confirmed checklist
  const earlyStart = await post(`/api/fleet/mission/${missionId}/start`);
  assert('start-blocked-before-confirm', earlyStart.s === 400, `${earlyStart.s}`);

  // 3. Get checklist and check items
  const cl = await get(`/api/fleet/pre-departure/${checklistId}`);
  assert('checklist-fetch', cl.s === 200);
  const items = cl.b?.items || [];
  const pendingItems = items.filter(i => i.status === 'PENDING');
  const autoPassItems = items.filter(i => i.status === 'PASS');
  assert('self-diag-auto-pass', autoPassItems.length === 7, `auto-pass: ${autoPassItems.length}`);
  assert('operator-items-pending', pendingItems.length === 3, `pending: ${pendingItems.length}`);

  // 4. Operator marks items
  for (const item of pendingItems) {
    const r = await post(`/api/fleet/pre-departure/${checklistId}/item/${item.itemId}`, { status: 'PASS' });
    assert(`mark-${item.itemId}`, r.s === 200 || r.s === 201, `${r.s}`);
  }

  // 5. Try confirm before fail scenario — confirm should work now
  const confirm = await post(`/api/fleet/pre-departure/${checklistId}/confirm`, { operatorId: 'OP-SMOKE' });
  assert('confirm-checklist', confirm.s === 200 || confirm.s === 201, `${confirm.s}: ${JSON.stringify(confirm.b)}`);

  // 6. Start mission after confirmed checklist
  const start = await post(`/api/fleet/mission/${missionId}/start`);
  assert('start-mission', start.s === 200 || start.s === 201, `${start.s}: ${JSON.stringify(start.b)}`);
  assert('mission-active', start.b?.status === 'ACTIVE');

  // 7. Pause
  const pause = await post(`/api/fleet/mission/${missionId}/pause`);
  assert('pause-mission', pause.b?.status === 'PAUSED');

  // 8. Resume
  const resume = await post(`/api/fleet/mission/${missionId}/resume`);
  assert('resume-mission', resume.b?.status === 'ACTIVE');

  // 9. Complete
  const complete = await post(`/api/fleet/mission/${missionId}/complete`);
  assert('complete-mission', complete.b?.status === 'COMPLETED');

  // 10. Cannot start new op on completed mission
  const reStart = await post(`/api/fleet/mission/${missionId}/start`);
  assert('restart-blocked', reStart.s === 400);

  // 11. New mission works after completion
  const m2 = await post(`/api/fleet/${V}/mission`);
  assert('new-mission-after-complete', m2.s === 201 && !!m2.b?.mission?.id);

  // Cleanup: abort the second mission
  await post(`/api/fleet/mission/${m2.b.mission.id}/abort`);

  // 12. Safety-critical fail blocks confirm
  const m3 = await post(`/api/fleet/${V}/mission`);
  const cl3 = m3.b?.checklist?.checklistId;
  // Mark tires as FAIL
  await post(`/api/fleet/pre-departure/${cl3}/item/tires`, { status: 'FAIL', detail: 'Low pressure rear left' });
  await post(`/api/fleet/pre-departure/${cl3}/item/lights-head`, { status: 'PASS' });
  await post(`/api/fleet/pre-departure/${cl3}/item/lights-turn`, { status: 'PASS' });
  const failConfirm = await post(`/api/fleet/pre-departure/${cl3}/confirm`, { operatorId: 'OP-SMOKE' });
  assert('critical-fail-blocks-confirm', failConfirm.s === 400, `${failConfirm.s}`);

  // Cleanup
  await post(`/api/fleet/mission/${m3.b.mission.id}/abort`);

  console.log(`\n=== ${passed}/${passed + failed} passed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
})();
