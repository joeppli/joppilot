// =============================================================================
// iot-policy-attach — C3 / closes DEV-23
// =============================================================================
// AWS requires an IoT *policy attached to the Cognito identity* on top of the
// IAM role before an authenticated identity may open an MQTT/WSS connection.
// Nothing used to perform that attach: it was one manual CloudShell command per
// operator (DEV-23). This function does it on the operator's first sign-in.
//
// WHY NOT A COGNITO POST-AUTH TRIGGER: at post-auth time the identity-pool
// identity does not exist yet — it is minted when the SPA calls GetId. There is
// nothing to attach a policy to. So the console asks for the attach itself,
// right before it opens the socket.
//
// TRUST MODEL: the client sends NO identity. It could otherwise name someone
// else's identityId and have a policy attached to it. The only input we accept
// is the bearer token in the Authorization header, which API Gateway's Cognito
// JWT authorizer has already validated; we then derive the identity ourselves
// via GetId with that same token. GetId is idempotent for a given login, so it
// returns the caller's existing identity rather than minting a second one.
//
// The IAM role carries iot:AttachPolicy for exactly one policy name, so a bug
// here cannot attach anything broader.
import { CognitoIdentityClient, GetIdCommand } from '@aws-sdk/client-cognito-identity';
import { IoTClient, AttachPolicyCommand } from '@aws-sdk/client-iot';

const REGION = process.env.AWS_REGION;
const IDENTITY_POOL_ID = process.env.IDENTITY_POOL_ID;
const USER_POOL_ID = process.env.USER_POOL_ID;
const POLICY_NAME = process.env.IOT_POLICY_NAME;

const cognito = new CognitoIdentityClient({ region: REGION });
const iot = new IoTClient({ region: REGION });

const LOGIN_PROVIDER = `cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`;

const reply = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  // PREFLIGHT. A browser POST with an Authorization header is not simple, so it
  // is preceded by OPTIONS — and that request needs its own route here: the
  // API's catch-all "OPTIONS /{proxy+}" forwards to the ALB, which has no
  // backend for this path and answers 503, failing the preflight before the
  // real call is ever sent. The API's cors_configuration supplies the actual
  // CORS headers; this only has to be a 2xx.
  if (event?.requestContext?.http?.method === 'OPTIONS') {
    return { statusCode: 204, body: '' };
  }

  // API Gateway lower-cases header names on the v2 payload, but be tolerant.
  const headers = event?.headers ?? {};
  const raw = headers.authorization ?? headers.Authorization ?? '';
  const token = raw.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    // Unreachable through the authorizer, but never assume the front door.
    return reply(401, { error: 'missing_token' });
  }

  let identityId;
  try {
    // GetId validates the token against the user pool a second time — the
    // authorizer already did, but this call is what BINDS token → identity,
    // and it is the only place the identity may come from.
    const res = await cognito.send(
      new GetIdCommand({
        IdentityPoolId: IDENTITY_POOL_ID,
        Logins: { [LOGIN_PROVIDER]: token },
      }),
    );
    identityId = res.IdentityId;
  } catch (err) {
    // The overwhelmingly likely cause is an access token where an ID token is
    // required: GetId accepts ONLY an ID token in the Logins map. Say so, so a
    // console-side mistake does not read as a server fault.
    console.error('GetId failed', { name: err?.name, message: err?.message });
    return reply(401, { error: 'identity_lookup_failed', detail: err?.name ?? 'unknown' });
  }

  if (!identityId) return reply(502, { error: 'no_identity_returned' });

  try {
    // Idempotent by design: attaching an already-attached policy succeeds, so a
    // repeat sign-in is a no-op and needs no "is it attached?" pre-check.
    await iot.send(new AttachPolicyCommand({ policyName: POLICY_NAME, target: identityId }));
  } catch (err) {
    console.error('AttachPolicy failed', { name: err?.name, message: err?.message, identityId });
    return reply(500, { error: 'attach_failed', detail: err?.name ?? 'unknown' });
  }

  console.log('policy attached', { identityId, policy: POLICY_NAME });
  return reply(200, { identityId, policy: POLICY_NAME, attached: true });
};
