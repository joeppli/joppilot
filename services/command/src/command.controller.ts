import { Controller, Post, Get, Param, Body, Logger, UnauthorizedException, BadRequestException, ForbiddenException, UseGuards } from '@nestjs/common';
import { MqttService } from './mqtt.service';
import { SessionService } from './session.service';
import { PrismaService } from './prisma.service';
import { ZoneService } from './zone.service';
import { AssignmentService } from './assignment.service';
import { Roles, RolesGuard } from './roles.guard';
import {
  CommandEnvelope,
  CommandEnvelopeSchema,
  CommandPayloadSchema,
  CommandPayload,
  OperationMode,
  ZoneType,
  ZoneTypeSchema,
  inferMode,
  isDiagDisruptiveAllowed,
} from '@joppilot/contract';
import { v4 as uuidv4 } from 'uuid';

@Controller('api/command')
@UseGuards(RolesGuard)
export class CommandController {
  private readonly logger = new Logger(CommandController.name);

  constructor(
    private readonly mqttService: MqttService,
    private readonly sessionService: SessionService,
    private readonly zoneService: ZoneService,
    private readonly assignments: AssignmentService,
    private readonly prisma: PrismaService
  ) {}

  @Post(':vehicleId/take-control')
  async takeControl(@Param('vehicleId') vehicleId: string, @Body('operatorId') operatorId: string) {
    // SEC-04: control/supervision authority is valid only for ASSIGNED
    // vehicles. Checked BEFORE the lock so an unassigned operator can never
    // hold even a transient token.
    if (!(await this.assignments.canControl(vehicleId, operatorId))) {
      await this.logEdr(uuidv4(), vehicleId, operatorId, 'TAKE_CONTROL', 'REJECTED', { reason: 'NO_ASSIGNMENT' });
      throw new ForbiddenException({
        reason: 'NO_ASSIGNMENT',
        details: `Operator '${operatorId}' has no active assignment for ${vehicleId} (SEC-04).`,
      });
    }
    const result = await this.sessionService.takeControl(vehicleId, operatorId);
    if (!result) {
      throw new UnauthorizedException('Vehicle is currently locked by another operator.');
    }
    return { status: 'success', token: result.token, issuedAt: result.issuedAt };
  }

  /** SEC-04: grant an operator control authority over a vehicle. Admin-only. */
  @Roles('admin')
  @Post(':vehicleId/assign')
  async assign(
    @Param('vehicleId') vehicleId: string,
    @Body('operatorId') operatorId: string,
    @Body('assignedBy') assignedBy: string = 'ADMIN',
  ) {
    if (!operatorId) throw new BadRequestException('operatorId is required');
    const result = await this.assignments.assign(vehicleId, operatorId, assignedBy);
    await this.logEdr(uuidv4(), vehicleId, assignedBy, 'ASSIGN_OPERATOR', 'ACK', { operatorId, ...result });
    return { status: 'success', vehicleId, operatorId, ...result };
  }

  /**
   * SEC-04/SEC-09: revoke an operator's assignment. If they hold the active
   * session, the fencing lock is deleted — their commands and heartbeats fail
   * immediately, and the vehicle's watchdog latches a safe stop on the
   * resulting silence (the fail-safe chain performs the "disconnect").
   */
  @Roles('admin')
  @Post(':vehicleId/unassign')
  async unassign(
    @Param('vehicleId') vehicleId: string,
    @Body('operatorId') operatorId: string,
    @Body('revokedBy') revokedBy: string = 'ADMIN',
  ) {
    if (!operatorId) throw new BadRequestException('operatorId is required');
    const result = await this.assignments.revoke(vehicleId, operatorId, revokedBy);
    await this.logEdr(uuidv4(), vehicleId, revokedBy, 'REVOKE_OPERATOR', 'ACK', { operatorId, ...result });
    return { status: 'success', vehicleId, operatorId, ...result };
  }

  @Roles('admin')
  @Get(':vehicleId/assignments')
  async listAssignments(@Param('vehicleId') vehicleId: string) {
    return this.assignments.listForVehicle(vehicleId);
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
    @Body('payload') payload: unknown
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
    // The mode is DERIVED from the action, never taken from the caller: a
    // client-supplied mode label would let a Mode 2 driving command ride the
    // Mode 1 allowance through the zone filter below (ICD §1). The edge
    // re-derives and re-checks this independently (2nd gate).
    const mode: OperationMode = inferMode(cmd.action);

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

    // 3b. Disruptive diagnostic actions (ICD §1 footnote). The cloud lacks live
    //     vehicle state, so it only blocks the zone-impossible case (out_of_tod);
    //     the state-based public-route deferral is enforced authoritatively on the
    //     edge, which holds live speed/latch state. (isStationary=true here.)
    const zone = this.zoneService.getZone(vehicleId);
    if (!alwaysAllowed && !isDiagDisruptiveAllowed(cmd.action, zone, true)) {
      await this.logEdr(uuidv4(), vehicleId, operatorId, cmd.action, 'REJECTED', { reason: 'DIAG_DEFERRED', zone });
      throw new ForbiddenException({
        reason: 'DIAG_DEFERRED',
        details: `Disruptive diagnostic action '${cmd.action}' is not permitted in zone '${zone}'.`,
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

  /** ICD §8: handover is an ADMINISTRATOR intervention — elevates the token,
   *  the old token is rejected on the vehicle. Admin-only (RolesGuard). */
  @Roles('admin')
  @Post(':vehicleId/handover')
  async handover(
    @Param('vehicleId') vehicleId: string,
    @Body('operatorId') operatorId: string,
  ) {
    const result = await this.sessionService.handover(vehicleId, operatorId);
    if (!result) throw new BadRequestException('Handover failed');
    await this.logEdr(uuidv4(), vehicleId, operatorId, 'HANDOVER', 'ACK', { newOperator: operatorId, issuedAt: result.issuedAt });
    this.logger.log(`HANDOVER completed for ${vehicleId} → ${operatorId}`);
    return { status: 'success', token: result.token, issuedAt: result.issuedAt };
  }

  /**
   * Admin/permit operation: (re)configure a vehicle's zone type (ICD §1).
   * Controlled + logged, not an instant override. Opening Mode 2 on a public
   * route (→ public_test_permit) requires a cantonal test permit; the
   * authorization comes from the permit (id + validity window), never from a
   * role flipping a rule at runtime. Admin-only (RolesGuard).
   *
   * DEV-14 (accepted deviation): reclassifying to OTHER Mode 2 zone types
   * (depot/private/permitted_test) currently needs no permit artifact — an
   * admin could mislabel a public location. The edge stays on its own zone
   * config (fail-safe, DEV-8), so this cannot reach the vehicle today; it
   * must be closed in M2-5 when zone config starts flowing to the vehicle:
   * zone changes then only come from canton-approved zone definitions, not
   * this free-form endpoint. Tracked in the architecture register.
   */
  @Roles('admin')
  @Post(':vehicleId/zone')
  async setZone(
    @Param('vehicleId') vehicleId: string,
    @Body('zone') zone: ZoneType,
    @Body('issuer') issuer: string = 'ADMIN',
    @Body('permitId') permitId?: string,
    @Body('reason') reason?: string,
    @Body('validUntil') validUntil?: number,
  ) {
    // Validate the target zone against the contract.
    const parsed = ZoneTypeSchema.safeParse(zone);
    if (!parsed.success) {
      throw new BadRequestException({ reason: 'INVALID_ZONE', details: `Unknown zone '${zone}'.` });
    }

    const from = this.zoneService.getZone(vehicleId);

    // ICD §1: Mode 2 on a public route is permit-based AND time-limited —
    // without a validity window the zone would never fall back to the safe
    // default, i.e. Mode 2 open indefinitely on a public road.
    if (zone === 'public_test_permit') {
      if (!permitId || typeof validUntil !== 'number') {
        await this.logEdr(uuidv4(), vehicleId, issuer, 'ZONE_CHANGE', 'REJECTED', { reason: 'PERMIT_REQUIRED', from, to: zone, permitId, validUntil });
        throw new ForbiddenException({
          reason: 'PERMIT_REQUIRED',
          details: 'Opening Mode 2 on a public route requires a cantonal test permit (permitId + validUntil).',
        });
      }
      if (validUntil <= Date.now()) {
        await this.logEdr(uuidv4(), vehicleId, issuer, 'ZONE_CHANGE', 'REJECTED', { reason: 'PERMIT_EXPIRED', from, to: zone, permitId, validUntil });
        throw new ForbiddenException({
          reason: 'PERMIT_EXPIRED',
          details: `Permit validity window ends in the past (validUntil=${validUntil}).`,
        });
      }
    }

    const permit = permitId ? { permitId, changedBy: issuer, reason, validUntil } : undefined;
    this.zoneService.setZone(vehicleId, parsed.data, permit);
    await this.logEdr(uuidv4(), vehicleId, issuer, 'ZONE_CHANGE', 'ACK', { from, to: zone, permitId, reason, validUntil });
    this.logger.log(`Zone change for ${vehicleId}: ${from} → ${zone} by ${issuer}${permitId ? ` (permit ${permitId})` : ''}`);
    return { status: 'success', vehicleId, zone, from, permitId };
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
    const issuedAt = await this.sessionService.getTokenIssuedAt(vehicleId);
    const envelope: CommandEnvelope = {
      commandId,
      correlationId: uuidv4(),
      sessionId: token,
      vehicleId,
      issuer: operatorId,
      mode,
      token: { tokenId: token, issuedAt },
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

    await this.logEdr(commandId, vehicleId, operatorId, payload.action, 'PENDING', envelope, envelope.correlationId);

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
    details: unknown,
    // SEC-06: every row is correlatable; rejections/admin ops that never grew
    // an envelope get a fresh id of their own.
    correlationId: string = uuidv4()
  ) {
    await this.prisma.eventDataRecord.create({
      data: { commandId, correlationId, vehicleId, issuer, action, status, details: JSON.parse(JSON.stringify(details)) },
    });
  }
}
