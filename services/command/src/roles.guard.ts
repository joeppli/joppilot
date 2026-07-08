import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const ROLES_KEY = 'roles';

/** Restrict a route to the given roles (RBAC — SEC-03/04). */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/** Known roles, most privileged first. Mirrors the Cognito groups (modules/cognito). */
const KNOWN_ROLES = ['admin', 'operator'] as const;

/**
 * Extract `cognito:groups` from a Bearer JWT WITHOUT signature re-verification.
 *
 * Trust model (M2-4-3, DEV-15 in the architecture register): the ONLY network
 * path to this service is API Gateway → VPC Link → internal ALB, and the API
 * Gateway JWT authorizer has ALREADY verified signature, issuer, audience and
 * expiry before the request could reach us — an unverified token never gets
 * this far. Re-verifying in-process would need JWKS egress, which the private
 * subnets don't have (no NAT; Cognito PrivateLink is incompatible with a
 * domain-assigned user pool). A VPC-internal actor forging a header is the
 * same threat class as the in-VPC plain-HTTP hop (DEV-2) with the same
 * compensating controls (SG-pinned path) and the same closure trigger.
 */
function groupsFromBearerJwt(authorization: string | undefined): string[] {
  if (!authorization) return [];
  const token = authorization.replace(/^Bearer\s+/i, '');
  const parts = token.split('.');
  if (parts.length !== 3) return [];
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const groups = payload['cognito:groups'];
    return Array.isArray(groups) ? groups.filter((g) => typeof g === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * RBAC guard — the enforcement seam for role-restricted routes.
 *
 * The route annotations are the production rules (ICD §8: handover is an
 * administrator intervention; ICD §1: a zone change is a controlled admin
 * operation) and stay unchanged across environments. What varies is WHERE the
 * caller's role comes from:
 *
 *   - Cloud (AUTH_TRUST_APIGW_JWT=true, set by the ECS task definition): the
 *     `cognito:groups` claim of the Bearer JWT that the API Gateway Cognito
 *     authorizer verified at the edge (M2-4-3 — closes DEV-7; see the trust
 *     note on groupsFromBearerJwt / DEV-15).
 *   - Local dev (flag unset): the `x-operator-role` header. A dev convenience
 *     only — there is no identity provider on localhost; it exists so the
 *     admin-only surface stays explicit and testable.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const role = this.resolveRole(req);

    if (role && required.includes(role)) return true;
    throw new ForbiddenException({
      reason: 'UNAUTHORIZED',
      details: `Requires role ${required.join(' | ')} (caller role: '${role ?? 'none'}').`,
    });
  }

  private resolveRole(req: { headers: Record<string, string | string[] | undefined> }): string | null {
    if (process.env.AUTH_TRUST_APIGW_JWT === 'true') {
      const auth = req.headers['authorization'];
      const groups = groupsFromBearerJwt(Array.isArray(auth) ? auth[0] : auth);
      // Most privileged group wins; an unknown-groups-only token gets no role.
      return KNOWN_ROLES.find((r) => groups.includes(r)) ?? null;
    }
    // Local dev fallback, defaulting to the least-privileged persona.
    const header = req.headers['x-operator-role'];
    return (Array.isArray(header) ? header[0] : header) ?? 'operator';
  }
}
