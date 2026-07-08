import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';

/**
 * Operator ↔ vehicle assignment (SEC-04) + revocation (SEC-09).
 *
 * SEC-04: remote control/supervision authority is valid only for ASSIGNED
 * vehicles — take-control consults this before granting a fencing token.
 * Enforcement is env-gated like the RolesGuard's role source:
 *   - Cloud (ASSIGNMENT_ENFORCEMENT=true, set by the ECS task definition):
 *     an operator without an active assignment cannot take control.
 *   - Local dev (flag unset): check disabled — the local sim has no admin
 *     bootstrap, and the console generates a random operator id per load.
 *
 * SEC-09: revoking an assignment immediately severs an active control
 * session: the Redis fencing lock is deleted, so every subsequent command
 * and heartbeat of the revoked operator fails validation. The console drops
 * the session on the next failed heartbeat (≤2 s), the cloud deadman stops
 * relaying liveness pings, and the vehicle's own watchdog latches a safe
 * stop within ~3 s of silence — the fail-safe chain does the "disconnect".
 */
@Injectable()
export class AssignmentService {
  private readonly logger = new Logger(AssignmentService.name);
  private devWarned = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  get enforcementEnabled(): boolean {
    return process.env.ASSIGNMENT_ENFORCEMENT === 'true';
  }

  /** SEC-04 gate used by take-control. */
  async canControl(vehicleId: string, operatorId: string): Promise<boolean> {
    if (!this.enforcementEnabled) {
      if (!this.devWarned) {
        this.devWarned = true;
        this.logger.warn('Assignment check DISABLED (dev). Cloud tasks set ASSIGNMENT_ENFORCEMENT=true (SEC-04).');
      }
      return true;
    }
    const assignment = await this.prisma.vehicleAssignment.findFirst({
      where: { vehicleId, operatorId, active: true },
    });
    return assignment !== null;
  }

  async assign(vehicleId: string, operatorId: string, assignedBy: string) {
    const existing = await this.prisma.vehicleAssignment.findFirst({
      where: { vehicleId, operatorId, active: true },
    });
    if (existing) return { assignmentId: existing.id, alreadyAssigned: true };

    const row = await this.prisma.vehicleAssignment.create({
      data: { vehicleId, operatorId, assignedBy },
    });
    this.logger.log(`ASSIGN ${operatorId} → ${vehicleId} by ${assignedBy}`);
    return { assignmentId: row.id, alreadyAssigned: false };
  }

  /**
   * Revoke every active assignment of the operator on the vehicle and, if
   * that operator currently holds the fencing lock, delete it (SEC-09).
   * Returns what happened so the caller can EDR-log it faithfully.
   */
  async revoke(vehicleId: string, operatorId: string, revokedBy: string) {
    const updated = await this.prisma.vehicleAssignment.updateMany({
      where: { vehicleId, operatorId, active: true },
      data: { active: false, revokedAt: new Date(), revokedBy },
    });

    // SEC-09: sever an active session held by the revoked operator. The lock
    // value is JSON ({op, token, issuedAt}) — only delete when it is theirs,
    // never a successor's.
    let sessionSevered = false;
    const lockKey = `lock:vehicle:${vehicleId}`;
    const raw = await this.redis.getClient().get(lockKey);
    if (raw) {
      try {
        if (JSON.parse(raw)?.op === operatorId) {
          await this.redis.getClient().del(lockKey);
          sessionSevered = true;
          this.logger.warn(`REVOKE severed active session of ${operatorId} on ${vehicleId} (SEC-09)`);
        }
      } catch { /* unparseable lock: leave it to its 6 s TTL */ }
    }

    this.logger.log(`REVOKE ${operatorId} on ${vehicleId} by ${revokedBy} (${updated.count} assignment(s), severed=${sessionSevered})`);
    return { revokedCount: updated.count, sessionSevered };
  }

  async listForVehicle(vehicleId: string) {
    return this.prisma.vehicleAssignment.findMany({
      where: { vehicleId, active: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}
