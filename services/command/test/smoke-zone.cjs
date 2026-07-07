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

  console.log(`\n=== ${passed}/${passed + failed} passed ===`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('Smoke test failed to run (is the command service up on :4000?)', e.message);
  process.exit(1);
});
