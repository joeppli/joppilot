// Assignment + revocation smoke test (SEC-04 / SEC-09, M2-4).
//
// Prereqs:  docker compose -f infra/docker-compose.yml up -d   (postgres + valkey)
//           command service running WITH enforcement on:
//             cd services/command && ASSIGNMENT_ENFORCEMENT=true node dist/main
//           (admin routes use the local x-operator-role header — dev only)
// Run:      node services/command/test/smoke-assignment.cjs
const BASE = process.env.COMMAND_API || 'http://localhost:4000';
const V = 'VEH-ASSIGN-SMOKE';
const OP = `OP-SMOKE-${Date.now()}`;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` → ${detail}` : ''}`);
}

async function req(method, path, body, headers = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch { /* empty body */ }
  return { s: r.status, b: json };
}
const admin = { 'x-operator-role': 'admin' };

(async () => {
  // 0. Guard: this test only means something with enforcement ON.
  const probe = await req('POST', `/api/command/${V}/take-control`, { operatorId: `${OP}-probe` });
  if (probe.s !== 403) {
    console.error('⚠️  take-control succeeded without an assignment — start the command service with ASSIGNMENT_ENFORCEMENT=true');
    process.exit(1);
  }

  // 1. SEC-04: unassigned operator cannot take control.
  check('unassigned-take-control-403', probe.s === 403 && probe.b?.reason === 'NO_ASSIGNMENT', JSON.stringify(probe.b));

  // 2. Non-admin cannot assign (RBAC).
  const nonAdmin = await req('POST', `/api/command/${V}/assign`, { operatorId: OP });
  check('non-admin-assign-403', nonAdmin.s === 403);

  // 3. Admin assigns the operator.
  const assign = await req('POST', `/api/command/${V}/assign`, { operatorId: OP, assignedBy: 'ADMIN-SMOKE' }, admin);
  check('admin-assign-ok', assign.s === 201 || assign.s === 200, JSON.stringify(assign.b));

  // 4. Assigned operator takes control.
  const tc = await req('POST', `/api/command/${V}/take-control`, { operatorId: OP });
  const token = tc.b?.token;
  check('assigned-take-control-ok', tc.s === 201 && !!token);

  // 5. Command with the live token reaches Gate 1 (published to MQTT).
  const cmd = await req('POST', `/api/command/${V}/command`, { operatorId: OP, token, payload: { action: 'START_MISSION' } });
  check('command-with-token-pending', cmd.s === 201 && cmd.b?.status === 'pending', JSON.stringify(cmd.b));

  // 6. SEC-09: admin revokes → the active session is severed immediately.
  const rev = await req('POST', `/api/command/${V}/unassign`, { operatorId: OP, revokedBy: 'ADMIN-SMOKE' }, admin);
  check('revoke-severs-session', rev.s === 201 && rev.b?.sessionSevered === true, JSON.stringify(rev.b));

  // 7. The old token is dead: commands are rejected...
  const dead = await req('POST', `/api/command/${V}/command`, { operatorId: OP, token, payload: { action: 'START_MISSION' } });
  check('old-token-rejected-401', dead.s === 401);

  // 8. ...heartbeats fail (console drops the session on this signal)...
  const hb = await req('POST', `/api/command/${V}/heartbeat`, { operatorId: OP, token });
  check('heartbeat-deadman', hb.b?.status === 'deadman_triggered', JSON.stringify(hb.b));

  // 9. ...and re-taking control is blocked (assignment gone).
  const again = await req('POST', `/api/command/${V}/take-control`, { operatorId: OP });
  check('revoked-take-control-403', again.s === 403 && again.b?.reason === 'NO_ASSIGNMENT');

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n=== ${passed}/${results.length} passed ===`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
