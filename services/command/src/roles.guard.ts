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

/**
 * RBAC guard — the enforcement seam for role-restricted routes.
 *
 * The route annotations are the production rules (ICD §8: handover is an
 * administrator intervention; ICD §1: a zone change is a controlled admin
 * operation) and stay unchanged across environments. What varies is WHERE the
 * caller's role comes from:
 *
 *   - Local M1 (now): the `x-operator-role` header. This is a dev convenience,
 *     NOT security — there is no identity provider on localhost. It exists so
 *     the admin-only surface is explicit and testable before the cloud move.
 *   - M2-4 (cloud): the services sit behind API Gateway's Cognito JWT
 *     authorizer; this guard then reads the verified `cognito:groups` claim
 *     from the forwarded token instead of trusting a header.
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
    // M1: header-sourced role, defaulting to the least-privileged persona.
    // M2-4: replace with the Cognito `cognito:groups` JWT claim.
    const role = (req.headers['x-operator-role'] as string | undefined) ?? 'operator';

    if (required.includes(role)) return true;
    throw new ForbiddenException({
      reason: 'UNAUTHORIZED',
      details: `Requires role ${required.join(' | ')} (caller role: '${role}').`,
    });
  }
}
