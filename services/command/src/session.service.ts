import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service';
import { MqttService } from './mqtt.service';
import { PrismaService } from './prisma.service';
import { v4 as uuidv4 } from 'uuid';
import { CommandEnvelope } from '@joppilot/contract';

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);
  private deadmanTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private readonly redis: RedisService,
    private readonly mqttService: MqttService,
    private readonly prisma: PrismaService
  ) {}

  async takeControl(vehicleId: string, operatorId: string): Promise<string | null> {
    const lockKey = `lock:vehicle:${vehicleId}`;
    const token = uuidv4();
    
    // Set lock with NX (Not eXists) and EX (Expires in 6 seconds)
    const acquired = await this.redis.getClient().set(lockKey, `${operatorId}:${token}`, 'EX', 6, 'NX');
    
    if (acquired) {
      this.logger.log(`Operator ${operatorId} took control of ${vehicleId} with token ${token}`);
      this.resetDeadmanTimer(vehicleId, operatorId, token);
      return token;
    }
    
    this.logger.warn(`Operator ${operatorId} failed to take control. Vehicle locked.`);
    return null;
  }

  async heartbeat(vehicleId: string, operatorId: string, token: string): Promise<boolean> {
    const lockKey = `lock:vehicle:${vehicleId}`;
    const currentLock = await this.redis.getClient().get(lockKey);
    
    if (currentLock === `${operatorId}:${token}`) {
      // Renew the lock for another 6 seconds
      await this.redis.getClient().expire(lockKey, 6);
      this.resetDeadmanTimer(vehicleId, operatorId, token);
      return true;
    }
    
    return false; // Token mismatch or lock expired
  }

  private resetDeadmanTimer(vehicleId: string, operatorId: string, token: string) {
    if (this.deadmanTimers.has(vehicleId)) {
      clearTimeout(this.deadmanTimers.get(vehicleId)!);
    }

    const timer = setTimeout(async () => {
      this.logger.error(`HEARTBEAT TIMEOUT for ${vehicleId}! Operator disconnected. Triggering DEADMAN SAFE STOP!`);
      // Clear lock immediately
      const lockKey = `lock:vehicle:${vehicleId}`;
      await this.redis.getClient().del(lockKey);
      this.deadmanTimers.delete(vehicleId);
      await this.triggerSafeStop(vehicleId);
    }, 6000);

    this.deadmanTimers.set(vehicleId, timer);
  }

  async triggerSafeStop(vehicleId: string) {
    const commandId = uuidv4();
    const envelope: CommandEnvelope = {
      commandId,
      sessionId: 'DEADMAN-SYSTEM',
      vehicleId,
      issuer: 'SYSTEM',
      mode: 'MODE1',
      token: {
        tokenId: 'SYSTEM-OVERRIDE',
        issuedAt: Date.now()
      },
      timestamp: Date.now(),
      ttlMs: 5000,
      payload: { action: 'SAFE_STOP', reason: 'DEADMAN_TIMEOUT' }
    };

    // EDR: Save command log before publishing
    await this.prisma.eventDataRecord.create({
      data: {
        commandId,
        vehicleId,
        issuer: 'SYSTEM',
        action: 'SAFE_STOP',
        status: 'PENDING',
        details: JSON.parse(JSON.stringify(envelope))
      }
    });

    const topic = `joppilot/v1/vehicles/${vehicleId}/estop`; // E-STOP/SafeStop topic
    this.mqttService.publish(topic, envelope);
  }

  async validateToken(vehicleId: string, operatorId: string, token: string): Promise<boolean> {
    const lockKey = `lock:vehicle:${vehicleId}`;
    const currentLock = await this.redis.getClient().get(lockKey);
    return currentLock === `${operatorId}:${token}`;
  }
}
