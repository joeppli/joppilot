// Test-side envelope/zone-config signing (ICD §4, M2-5).
// Mirrors @joppilot/contract canonicalStringify + the command service's
// SigningService so smoke tests can craft signed documents. Uses the
// committed DEV key (same one as services/command/.env.example) unless
// COMMAND_SIGNING_KEY overrides it.
const { createPrivateKey, sign } = require('crypto');

const DEV_KEY = 'MC4CAQAwBQYDK2VwBCIEIIkknctKnl92UpU9whWskvY5k9m6qmpsNodXj8mlidWH';
const key = createPrivateKey({
  key: Buffer.from(process.env.COMMAND_SIGNING_KEY || DEV_KEY, 'base64'),
  format: 'der',
  type: 'pkcs8',
});

function canonicalStringify(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Returns doc with `signature` = base64 Ed25519 over its canonical JSON. */
function signDoc(doc) {
  const unsigned = { ...doc };
  delete unsigned.signature;
  const signature = sign(null, Buffer.from(canonicalStringify(unsigned), 'utf8'), key).toString('base64');
  return { ...doc, signature };
}

module.exports = { signDoc, canonicalStringify };
