import { Controller, Post, Param, Body, Logger, UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { MqttService } from './mqtt.service';
import { SessionService } from './session.service';
import { PrismaService } from './prisma.service';
import { ZoneService } from './zone.service';
import {
  CommandEnvelope,
  CommandEnvelopeSchema,
  CommandPayloadSchema,
  CommandPayload,
  OperationMode,
  ZoneType,
  inferMode,
} from '@joppilot/contract';
import { v4 as uuidv4 } from 'uuid';

@Controller('api/command')
export class CommandController {
  private readonly logger = new Logger(CommandController.name);

  constructor(
    private readonly mqttService: MqttService,
    private readonly sessionService: SessionService,
    private readonly zoneService: ZoneService,
    private readonly prisma: PrismaService
  ) {}

  @Post(':vehicleId/take-control')
  async takeControl(@Param('vehicleId') vehicleId: string, @Body('operatorId') operatorId: string) {
    const token = await this.sessionService.takeControl(vehicleId, operatorId);
    if (!token) {
      throw new UnauthorizedException('Vehicle is currently locked by another operator.');
    }
    return { status: 'success', token };
  }

  @Post(':vehicleId/heartbeat')
  async heartbeat(
    @Param('vehicleId') vehicleId: string,
    @Body('operatorId') operatorId: string,
    @Body('token') token: string
  ) {
    const isAlive = await this.sessionService.heartbeat(vehicleId, operatorId, token);
    if (isAlive) {
      // Relay the operator-liveness ping to the Edge node to reset its watchdog.
      // NOTE: this is the cloud → vehicle "deadman" ping. The vehicle → cloud
      // "I'm healthy" heartbeat (ICD §3) is a separate channel ingested by the
      // telemetry service.
      this.mqttService.publish(`joppilot/v1/vehicles/${vehicleId}/deadman`, { timestamp: Date.now() });
    }
    return { status: isAlive ? 'alive' : 'deadman_triggered' };
  }

  /**
   * Generic command endpoint with the full 1st gate (ICD §1/§4):
   * token lock → schema validation → zone/mode filter → envelope build →
   * envelope schema validation → EDR log → MQTT publish.
   */
  @Post(':vehicleId/command')
  async sendCommand(
    @Param('vehicleId') vehicleId: string,
    @Body('operatorId') operatorId: string,
    @Body('token') token: string,
    @Body('payload') payload: unknown,
    @Body('mode') modeOverride?: OperationMode
  ) {
    // 1. Single-operator lock (SEC-05 / ICD §8)
    const isValid = await this.sessionService.validateToken(vehicleId, operatorId, token);
    if (!isValid) throw new UnauthorizedException('Invalid fencing token. You do not have control.');

    // 2. Schema validation (SCHEMA_INVALID, ICD §4) - reject before sending
    const parsed = CommandPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new BadRequestException({ reason: 'SCHEMA_INVALID', details: parsed.error.issues });
    }
    const cmd: CommandPayload = parsed.data;
    const mode: OperationMode = modeOverride ?? inferMode(cmd.action);

    // 3. Zone/mode filter (1st gate, ICD §1). E-STOP / SAFE-STOP / CLEAR are
    //    valid in any zone and bypass the mode filter.
    const alwaysAllowed = ['E_STOP', 'SAFE_STOP', 'CLEAR_SAFE_STOP'].includes(cmd.action);
    if (!alwaysAllowed && !this.zoneService.isModeAllowed(vehicleId, mode)) {
      const zone = this.zoneService.getZone(vehicleId);
      await this.logEdr(uuidv4(), vehicleId, operatorId, cmd.action, 'REJECTED', { reason: 'MODE_MISMATCH', zone, mode });
      throw new ForbiddenException({
        reason: 'MODE_MISMATCH',
        details: `Mode ${mode} is not permitted in zone '${zone}' for ${vehicleId}.`,
      });
    }

    return this.dispatch(vehicleId, operatorId, token, mode, cmd);
  }

  @Post(':vehicleId/estop')
  async triggerEStop(
    @Param('vehicleId') vehicleId: string,
    @Body('operatorId') operatorId: string,
    @Body('token') token: string
  ) {
    const isValid = await this.sessionService.validateToken(vehicleId, operatorId, token);
    if (!isValid) throw new UnauthorizedException('Invalid fencing token. You do not have control.');

    this.logger.log(`E-STOP requested for ${vehicleId} by ${operatorId}`);
    // E-STOP goes on its dedicated, highest-priority topic.
    return this.dispatch(vehicleId, operatorId, token, 'MODE1', { action: 'E_STOP' }, 'estop');
  }

  @Post(':vehicleId/clear-safe-stop')
  async clearSafeStop(
    @Param('vehicleId') vehicleId: string,
    @Body('operatorId') operatorId: string,
    @Body('token') token: string
  ) {
    const isValid = await this.sessionService.validateToken(vehicleId, operatorId, token);
    if (!isValid) throw new UnauthorizedException('Invalid fencing token. You do not have control.');
    this.logger.log(`CLEAR_SAFE_STOP (authorized latch release) for ${vehicleId} by ${operatorId}`);
    return this.dispatch(vehicleId, operatorId, token, 'MODE1', { action: 'CLEAR_SAFE_STOP' });
  }

  /** Admin/permit operation: (re)configure a vehicle's zone type (controlled, logged). */
  @Post(':vehicleId/zone')
  async setZone(@Param('vehicleId') vehicleId: string, @Body('zone') zone: ZoneType) {
    this.zoneService.setZone(vehicleId, zone);
    return { status: 'success', vehicleId, zone };
  }

  // ----------------------------------------------------------------
  // Shared dispatch: build envelope → validate → EDR → publish
  // ----------------------------------------------------------------
  private async dispatch(
    vehicleId: string,
    operatorId: string,
    token: string,
    mode: OperationMode,
    payload: CommandPayload,
    channel: 'command' | 'estop' = 'command'
  ) {
    const commandId = uuidv4();
    const envelope: CommandEnvelope = {
      commandId,
      sessionId: token,
      vehicleId,
      issuer: operatorId,
      mode,
      token: { tokenId: token, issuedAt: Date.now() },
      timestamp: Date.now(),
      ttlMs: payload.action === 'E_STOP' ? 5000 : 2000,
      payload,
    };

    // Validate our own envelope against the contract before it leaves the cloud.
    const check = CommandEnvelopeSchema.safeParse(envelope);
    if (!check.success) {
      this.logger.error(`Envelope failed contract validation: ${JSON.stringify(check.error.issues)}`);
      throw new BadRequestException({ reason: 'SCHEMA_INVALID', details: check.error.issues });
    }

    await this.logEdr(commandId, vehicleId, operatorId, payload.action, 'PENDING', envelope);

    const topic = `joppilot/v1/vehicles/${vehicleId}/${channel}`;
    this.mqttService.publish(topic, envelope);

    return { status: 'pending', commandId, action: payload.action, mode, message: `${payload.action} published` };
  }

  private async logEdr(
    commandId: string,
    vehicleId: string,
    issuer: string,
    action: string,
    status: string,
    details: unknown
  ) {
    await this.prisma.eventDataRecord.create({
      data: { commandId, vehicleId, issuer, action, status, details: JSON.parse(JSON.stringify(details)) },
    });
  }
}
