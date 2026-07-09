import { ForbiddenException } from '@nestjs/common';

/**
 * Operator identity binding (LEG-05 chain of evidence, audit-7 finding 3).
 *
 * Every endpoint takes the acting `operatorId` from the request body — but the
 * body is client-supplied. In the cloud the caller ALREADY carries a verified
 * identity: the Cognito JWT that the API Gateway authorizer validated at the
 * edge (same trust model as the RolesGuard — DEV-15: signature verified at the
 * edge, decoded here without re-verification). These helpers bind the claimed
 * `operatorId` to that identity so an authenticated operator A cannot act (and
 * be EDR-attributed) as operator B.
 *
 * Env-gated like the RolesGuard role source:
 *   - Cloud (AUTH_TRUST_APIGW_JWT=true): operatorId MUST equal the token's
 *     `cognito:username` (ID token) / `username` (access token) / `sub`.
 *   - Local dev (flag unset): no identity provider exists — binding is skipped.
 */

type ReqLike = { headers: Record<string, string | string[] | undefined> };

/** Decode the Bearer JWT payload (NOT signature-verified — DEV-15 trust note). */
function jwtPayload(req: ReqLike): Record<string, unknown> | null {
  const raw = req.headers['authorization'];
  const auth = Array.isArray(raw) ? raw[0] : raw;
  if (!auth) return null;
  const parts = auth.replace(/^Bearer\s+/i, '').split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/** The caller's verified identity, or null when no/unparseable token. */
export function identityFrom(req: ReqLike): string | null {
  const p = jwtPayload(req);
  if (!p) return null;
  const id = p['cognito:username'] ?? p['username'] ?? p['sub'];
  return typeof id === 'string' ? id : null;
}

export function identityBindingEnabled(): boolean {
  return process.env.AUTH_TRUST_APIGW_JWT === 'true';
}

/**
 * Throw 403 IDENTITY_MISMATCH unless the claimed operatorId is the caller's
 * verified identity. No-op in local dev (no identity provider).
 */
export function requireOperatorIdentity(req: ReqLike, operatorId: string): void {
  if (!identityBindingEnabled()) return;
  const identity = identityFrom(req);
  if (!identity || identity !== operatorId) {
    throw new ForbiddenException({
      reason: 'IDENTITY_MISMATCH',
      details: `operatorId '${operatorId}' does not match the authenticated identity (LEG-05).`,
    });
  }
}

/**
 * The actor recorded for admin operations (assign/unassign/handover/zone).
 * In the cloud the verified JWT identity WINS over the body-supplied name —
 * the audit row must attribute the action to who actually performed it.
 * Local dev falls back to the body value / 'ADMIN'.
 */
export function actorFrom(req: ReqLike, bodyValue?: string): string {
  if (identityBindingEnabled()) {
    const identity = identityFrom(req);
    if (identity) return identity;
  }
  return bodyValue || 'ADMIN';
}
