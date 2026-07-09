import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service';
import { MqttService } from './mqtt.service';
import { PrismaService } from './prisma.service';
import { SigningService } from './signing.service';
import { v4 as uuidv4 } from 'uuid';
import { CommandEnvelope } from '@joppilot/contract';

// Redis lock value. Stored as JSON — a delimiter format would break on an
// operatorId containing the delimiter (client-supplied input).
interface VehicleLock {
  op: string;
  token: string;
  issuedAt: number;
}

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private deadmanTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private readonly redis: RedisService,
    private readonly mqttService: MqttService,
    private readonly signing: SigningService,
    private readonly prisma: PrismaService
  ) {}

  private parseLock(raw: string | null): VehicleLock | null {
    if (!raw) return null;
    try {
      const o = JSON.parse(raw);
      if (typeof o?.op === 'string' && typeof o?.token === 'string' && typeof o?.issuedAt === 'number') return o;
    } catch { /* fall through */ }
    return null;
  }

  async takeControl(vehicleId: string, operatorId: string): Promise<{ token: string; issuedAt: number } | null> {
    const lockKey = `lock:vehicle:${vehicleId}`;
    const token = uuidv4();
    const issuedAt = Date.now();
    const lock: VehicleLock = { op: operatorId, token, issuedAt };

    const acquired = await this.redis.getClient().set(lockKey, JSON.stringify(lock), 'EX', 6, 'NX');

    if (acquired) {
      this.logger.log(`Operator ${operatorId} took control of ${vehicleId} with token ${token}`);
      this.resetDeadmanTimer(vehicleId, operatorId, token);
      return { token, issuedAt };
    }

    this.logger.warn(`Operator ${operatorId} failed to take control. Vehicle locked.`);
    return null;
  }

  async heartbeat(vehicleId: string, operatorId: string, token: string): Promise<boolean> {
    const lockKey = `lock:vehicle:${vehicleId}`;
    const lock = this.parseLock(await this.redis.getClient().get(lockKey));
    if (!lock) return false;

    if (lock.op === operatorId && lock.token === token) {
      await this.redis.getClient().expire(lockKey, 6);
      this.resetDeadmanTimer(vehicleId, operatorId, token);
      return true;
    }

    return false;
  }

  // Cloud-side deadman — BEST-EFFORT second layer, decided in the M2-4 design
  // review. The authoritative failsafe is the vehicle's own watchdog (RES-01:
  // cloud-independent, ~3 s), and the Redis lock TTL (6 s) is the source of
  // truth for lock expiry — both hold even if this process dies. This timer
  // only adds an explicit SAFE_STOP command + EDR record when an operator
  // vanishes. Multi-instance safety (ECS, M2-4): behind a load balancer the
  // operator's heartbeats may refresh the Redis lock through ANOTHER instance
  // and never reset this instance's timer — so when the timer fires it
  // re-checks Redis and acts ONLY if the lock is really gone. Firing at 7 s
  // (> 6 s TTL) guarantees a truly dead operator's lock has already expired.
  private resetDeadmanTimer(vehicleId: string, operatorId: string, token: string) {
    if (this.deadmanTimers.has(vehicleId)) {
      clearTimeout(this.deadmanTimers.get(vehicleId)!);
    }

    const timer = setTimeout(async () => {
      this.deadmanTimers.delete(vehicleId);
      const lockKey = `lock:vehicle:${vehicleId}`;
      const currentLock = await this.redis.getClient().get(lockKey);
      if (currentLock) {
        // Lock is alive: heartbeats are landing on another instance, or a new
        // operator has taken over. Not a deadman — whichever instance received
        // the latest heartbeat holds the live timer now.
        return;
      }
      this.logger.error(`HEARTBEAT TIMEOUT for ${vehicleId}! Operator disconnected. Triggering DEADMAN SAFE STOP!`);
      await this.triggerSafeStop(vehicleId);
    }, 7000);

    this.deadmanTimers.set(vehicleId, timer);
  }

  async handover(vehicleId: string, newOperatorId: string): Promise<{ token: string; issuedAt: number } | null> {
    const lockKey = `lock:vehicle:${vehicleId}`;
    const previousOperator = this.parseLock(await this.redis.getClient().get(lockKey))?.op ?? 'none';

    const token = uuidv4();
    const issuedAt = Date.now();
    const lock: VehicleLock = { op: newOperatorId, token, issuedAt };

    await this.redis.getClient().set(lockKey, JSON.stringify(lock), 'EX', 6);

    this.logger.log(`HANDOVER: ${previousOperator} → ${newOperatorId} on ${vehicleId} (token elevated)`);
    this.resetDeadmanTimer(vehicleId, newOperatorId, token);
    return { token, issuedAt };
  }

  async triggerSafeStop(vehicleId: string) {
    const commandId = uuidv4();
    const correlationId = uuidv4();
    // Signed like every command (ICD §4, M2-5) — the vehicle would NACK an
    // unsigned system envelope just like an operator one.
    const envelope: CommandEnvelope = this.signing.signDocument({
      commandId,
      correlationId,
      sessionId: 'DEADMAN-SYSTEM',
      vehicleId,
      issuer: 'SYSTEM',
      mode: 'MODE1',
      token: {
        tokenId: uuidv4(),
        issuedAt: Date.now(),
      },
      timestamp: Date.now(),
      ttlMs: 5000,
      payload: { action: 'SAFE_STOP', reason: 'DEADMAN_TIMEOUT' }
    });

    // EDR: Save command log before publishing
    await this.prisma.eventDataRecord.create({
      data: {
        commandId,
        correlationId,
        vehicleId,
        issuer: 'SYSTEM',
        action: 'SAFE_STOP',
        status: 'PENDING',
        details: JSON.parse(JSON.stringify(envelope))
      }
    });

    const topic = `joppilot/v1/vehicles/${vehicleId}/estop`; // E-STOP/SafeStop topic
    if (!this.mqttService.publish(topic, envelope)) {
      // The vehicle's own watchdog is the authoritative failsafe (RES-01) —
      // it latches on the same silence that killed this publish. Record the
      // failed attempt so the EDR chain shows what the cloud tried (LEG-04).
      await this.prisma.eventDataRecord.create({
        data: {
          commandId, correlationId, vehicleId, issuer: 'SYSTEM',
          action: 'SAFE_STOP', status: 'PUBLISH_FAILED',
          details: { note: 'Deadman SAFE_STOP could not be published (MQTT down); vehicle watchdog covers the failsafe.' },
        },
      });
    }
  }

  async validateToken(vehicleId: string, operatorId: string, token: string): Promise<boolean> {
    const lockKey = `lock:vehicle:${vehicleId}`;
    const lock = this.parseLock(await this.redis.getClient().get(lockKey));
    return !!lock && lock.op === operatorId && lock.token === token;
  }

  async getTokenIssuedAt(vehicleId: string): Promise<number> {
    const lockKey = `lock:vehicle:${vehicleId}`;
    return this.parseLock(await this.redis.getClient().get(lockKey))?.issuedAt ?? Date.now();
  }
}
