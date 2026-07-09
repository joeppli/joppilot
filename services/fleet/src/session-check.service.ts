import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * Fencing-token check for the fleet workflows (audit-7 finding 1).
 *
 * ICD §7/§4: the pre-departure verification & confirmation and the mission
 * lifecycle are OPERATOR actions on a vehicle — they carry the same authority
 * model as commands: the caller must hold the vehicle's active fencing lock
 * (SEC-05), which take-control only grants to an ASSIGNED operator (SEC-04).
 *
 * Fleet READS the lock that the command service owns in Valkey
 * (`lock:vehicle:{id}`, JSON {op, token, issuedAt}) — read-only, the lock
 * lifecycle (grant/refresh/sever) stays in the command service (AD-9).
 * FAIL-CLOSED: an unreachable Valkey rejects the operation; a legally
 * mandatory record (LEG-03) must never be writable without authority.
 */
@Injectable()
export class SessionCheckService {
  private readonly logger = new Logger(SessionCheckService.name);

  constructor(private readonly redis: RedisService) {}

  async validateToken(vehicleId: string, operatorId: string, token: string): Promise<boolean> {
    if (!operatorId || !token) return false;
    try {
      const raw = await this.redis.getClient().get(`lock:vehicle:${vehicleId}`);
      if (!raw) return false;
      const lock = JSON.parse(raw);
      return lock?.op === operatorId && lock?.token === token;
    } catch (e) {
      this.logger.error(`Lock check failed for ${vehicleId} (fail-closed)`, e as Error);
      return false;
    }
  }

  /** Throw 401 unless the operator holds the vehicle's active fencing lock. */
  async requireControl(vehicleId: string, operatorId: string, token: string): Promise<void> {
    if (!(await this.validateToken(vehicleId, operatorId, token))) {
      throw new UnauthorizedException({
        reason: 'INVALID_TOKEN',
        details: `Operator '${operatorId ?? 'unknown'}' does not hold control of ${vehicleId} (SEC-05); take control first.`,
      });
    }
  }
}
