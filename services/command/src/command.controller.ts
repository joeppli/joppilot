import { Controller, Post, Get, Param, Body, Req, Logger, UnauthorizedException, BadRequestException, ForbiddenException, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { MqttService } from './mqtt.service';
import { SessionService } from './session.service';
import { PrismaService } from './prisma.service';
import { ZoneService } from './zone.service';
import { AssignmentService } from './assignment.service';
import { Roles, RolesGuard } from './roles.guard';
import { SigningService } from './signing.service';
import { requireOperatorIdentity, actorFrom } from './identity';
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
    private readonly signing: SigningService,
    private readonly prisma: PrismaService
  ) {}

  @Post(':vehicleId/take-control')
  async takeControl(@Param('vehicleId') vehicleId: string, @Body('operatorId') operatorId: string, @Req() req: any) {
    // LEG-05: the claimed operatorId must be the authenticated caller — the
    // EDR chain attributes every later command to this id (audit-7 finding 3).
    requireOperatorIdentity(req, operatorId);
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
    // LEG-05/SEC-06: acquiring control is a critical action — "who, when,
    // with which authorization" must be traceable. tokenId ties this row to
    // every later command envelope carrying the same fencing token.
    await this.logEdr(uuidv4(), vehicleId, operatorId, 'TAKE_CONTROL', 'ACK', {
      tokenId: result.token,
      issuedAt: result.issuedAt,
    });
    return { status: 'success', token: result.token, issuedAt: result.issuedAt };
  }

  /** SEC-04: grant an operator control authority over a vehicle. Admin-only.
   *  The recorded actor is the authenticated admin identity in the cloud —
   *  the body value is a local-dev fallback only (LEG-05). */
  @Roles('admin')
  @Post(':vehicleId/assign')
  async assign(
    @Param('vehicleId') vehicleId: string,
    @Body('operatorId') operatorId: string,
    @Body('assignedBy') assignedByBody: string | undefined,
    @Req() req: any,
  ) {
    if (!operatorId) throw new BadRequestException('operatorId is required');
    const assignedBy = actorFrom(req, assignedByBody);
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
    @Body('revokedBy') revokedByBody: string | undefined,
    @Req() req: any,
  ) {
    if (!operatorId) throw new BadRequestException('operatorId is required');
    const revokedBy = actorFrom(req, revokedByBody);
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
    @Body('token') token: string,
    @Req() req: any
  ) {
    requireOperatorIdentity(req, operatorId);
    const isAlive = await this.sessionService.heartbeat(vehicleId, operatorId, token);
    if (isAlive) {
      // Relay the operator-liveness ping to the Edge node to reset its watchdog.
      // NOTE: this is the cloud → vehicle "deadman" ping. The vehicle → cloud
      // "I'm healthy" heartbeat (ICD §3) is a separate channel ingested by the
      // telemetry service.
      // audit-9: SIGNED like a command (contract DeadmanPingSchema) — this is
      // the one input that keeps the vehicle out of safe mode, so the edge
      // refuses unsigned/foreign/stale pings (ICD §1: the link can be spoofed;
      // an attacker must not be able to suppress the RES-01 watchdog).
      this.mqttService.publish(
        `joppilot/v1/vehicles/${vehicleId}/deadman`,
        this.signing.signDocument({ vehicleId, timestamp: Date.now() }),
      );
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
    @Req() req: any
  ) {
    // 0. LEG-05: bind the claimed operatorId to the authenticated identity.
    requireOperatorIdentity(req, operatorId);
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
    @Body('token') token: string,
    @Req() req: any
  ) {
    requireOperatorIdentity(req, operatorId);
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
    @Body('token') token: string,
    @Req() req: any
  ) {
    requireOperatorIdentity(req, operatorId);
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
    @Req() req: any,
  ) {
    if (!operatorId) throw new BadRequestException('operatorId is required');
    const admin = actorFrom(req);
    // SEC-04 (audit-7 finding 2): handover mints a fencing token like
    // take-control does, so it passes the SAME assignment gate — an admin
    // cannot hand a vehicle to an operator who was never assigned to it.
    if (!(await this.assignments.canControl(vehicleId, operatorId))) {
      await this.logEdr(uuidv4(), vehicleId, admin, 'HANDOVER', 'REJECTED', { reason: 'NO_ASSIGNMENT', newOperator: operatorId });
      throw new ForbiddenException({
        reason: 'NO_ASSIGNMENT',
        details: `Cannot hand over ${vehicleId}: operator '${operatorId}' has no active assignment (SEC-04).`,
      });
    }
    const result = await this.sessionService.handover(vehicleId, operatorId);
    if (!result) throw new BadRequestException('Handover failed');
    // LEG-05: the actor is the admin who performed the intervention, not the
    // operator who received the token.
    await this.logEdr(uuidv4(), vehicleId, admin, 'HANDOVER', 'ACK', { newOperator: operatorId, issuedAt: result.issuedAt });
    this.logger.log(`HANDOVER completed for ${vehicleId} → ${operatorId} (by ${admin})`);
    return { status: 'success', token: result.token, issuedAt: result.issuedAt };
  }

  /**
   * Admin/permit operation: (re)configure a vehicle's zone type (ICD §1).
   * Controlled + logged, not an instant override. Opening Mode 2 on a public
   * route (→ public_test_permit) requires a cantonal test permit; the
   * authorization comes from the permit (id + validity window), never from a
   * role flipping a rule at runtime. Admin-only (RolesGuard).
   *
   * DEV-14 (tightened in M2-5, still open): every Mode-2-capable zone type
   * now requires an authorization artifact + validity window (enforced
   * below), and the change reaches the vehicle as a signed config (DEV-8
   * closed). What remains open is validation against a canton-approved
   * zone-definition CATALOG (geometry + conditions) — the M3-5 zone work.
   * Tracked in the architecture register.
   */
  @Roles('admin')
  @Post(':vehicleId/zone')
  async setZone(
    @Param('vehicleId') vehicleId: string,
    @Body('zone') zone: ZoneType,
    @Req() req: any,
    @Body('issuer') issuerBody?: string,
    @Body('permitId') permitId?: string,
    @Body('reason') reason?: string,
    @Body('validUntil') validUntil?: number,
    // M3-5 (ICD §1 permit conditions): activation start + speed limit —
    // delivered in the signed ZoneConfig and ENFORCED ON THE VEHICLE.
    @Body('validFrom') validFrom?: number,
    @Body('speedLimitKmh') speedLimitKmh?: number,
  ) {
    // LEG-05: the recorded issuer is the authenticated admin in the cloud.
    const issuer = actorFrom(req, issuerBody);
    // Validate the target zone against the contract.
    const parsed = ZoneTypeSchema.safeParse(zone);
    if (!parsed.success) {
      throw new BadRequestException({ reason: 'INVALID_ZONE', details: `Unknown zone '${zone}'.` });
    }

    const from = this.zoneService.getZone(vehicleId);

    // ICD §1: opening Mode 2 is authorization-based AND time-limited. Since
    // M2-5 the config actually REACHES the vehicle (DEV-8 closed), so a
    // free-form "depot" label would open Mode 2 for real — therefore EVERY
    // Mode-2-capable zone type now requires an authorization artifact
    // (cantonal test permit for public_test_permit; site authorization id
    // for depot/private/permitted_test) plus a validity window the EDGE
    // enforces: past the window the vehicle reverts to the safe default on
    // its own. Tightens DEV-14; the full canton-approved zone-definition
    // catalog (geometry-validated) remains open with the M3-5 zone work.
    const MODE2_CAPABLE: ZoneType[] = ['public_test_permit', 'depot', 'private', 'permitted_test'];
    if (MODE2_CAPABLE.includes(parsed.data)) {
      if (!permitId || typeof validUntil !== 'number') {
        await this.logEdr(uuidv4(), vehicleId, issuer, 'ZONE_CHANGE', 'REJECTED', { reason: 'PERMIT_REQUIRED', from, to: zone, permitId, validUntil });
        throw new ForbiddenException({
          reason: 'PERMIT_REQUIRED',
          details: `Zone '${zone}' permits Mode 2 — an authorization artifact (permitId) and a validity window (validUntil) are required (ICD §1).`,
        });
      }
      if (validUntil <= Date.now()) {
        await this.logEdr(uuidv4(), vehicleId, issuer, 'ZONE_CHANGE', 'REJECTED', { reason: 'PERMIT_EXPIRED', from, to: zone, permitId, validUntil });
        throw new ForbiddenException({
          reason: 'PERMIT_EXPIRED',
          details: `Authorization validity window ends in the past (validUntil=${validUntil}).`,
        });
      }
      // M3-5: a window that never opens is a broken permit, not a zone change.
      if (typeof validFrom === 'number' && validFrom >= validUntil) {
        await this.logEdr(uuidv4(), vehicleId, issuer, 'ZONE_CHANGE', 'REJECTED', { reason: 'PERMIT_WINDOW_INVALID', from, to: zone, permitId, validFrom, validUntil });
        throw new ForbiddenException({
          reason: 'PERMIT_WINDOW_INVALID',
          details: `validFrom (${validFrom}) must be before validUntil (${validUntil}).`,
        });
      }
    }

    const permit = permitId ? { permitId, changedBy: issuer, reason, validUntil, validFrom, speedLimitKmh } : undefined;
    // M2-5 (DEV-8 closed): the change is DELIVERED to the vehicle as a signed,
    // revision-monotonic config document. Delivery status is part of the
    // audit record — an undelivered change is only cloud-side state and the
    // vehicle stays on its stricter current zone (fail-safe).
    const delivery = this.zoneService.setZone(vehicleId, parsed.data, permit);
    await this.logEdr(uuidv4(), vehicleId, issuer, 'ZONE_CHANGE', 'ACK', { from, to: zone, permitId, reason, validUntil, validFrom, speedLimitKmh, ...delivery });
    this.logger.log(`Zone change for ${vehicleId}: ${from} → ${zone} by ${issuer}${permitId ? ` (permit ${permitId})` : ''} (delivered=${delivery.delivered})`);
    return { status: 'success', vehicleId, zone, from, permitId, ...delivery };
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
    // ICD §4 (M2-5): every envelope is SIGNED — the vehicle NACKs anything
    // unsigned or altered in flight.
    const envelope: CommandEnvelope = this.signing.signDocument({
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
    });

    // Validate our own envelope against the contract before it leaves the cloud.
    const check = CommandEnvelopeSchema.safeParse(envelope);
    if (!check.success) {
      this.logger.error(`Envelope failed contract validation: ${JSON.stringify(check.error.issues)}`);
      throw new BadRequestException({ reason: 'SCHEMA_INVALID', details: check.error.issues });
    }

    await this.logEdr(commandId, vehicleId, operatorId, payload.action, 'PENDING', envelope, envelope.correlationId);

    const topic = `joppilot/v1/vehicles/${vehicleId}/${channel}`;

    // ICD §3 (M3-3): E-STOP is sent SIMULTANEOUSLY via two separate messages —
    // the dedicated estop topic AND the regular command topic. The vehicle
    // stops on whichever arrives first; the second copy carries the SAME
    // command_id and is deduplicated on the edge (same ACK replayed, ICD §4 —
    // no double stop). Redundancy semantics: ONE delivered copy is a sent
    // E-STOP; only both failing is a failure (503). NOTE: locally both
    // messages ride the same broker/link — true dual-PATH (independent
    // transports/carriers, AD-3: WebRTC data channel + MQTT) lands with the
    // August channel-reliability work; M3-3 closes the dual-MESSAGE half.
    if (channel === 'estop') {
      const viaEstop = this.mqttService.publish(topic, envelope);
      const viaCommand = this.mqttService.publish(`joppilot/v1/vehicles/${vehicleId}/command`, envelope);
      if (!viaEstop && !viaCommand) {
        await this.logEdr(commandId, vehicleId, operatorId, payload.action, 'PUBLISH_FAILED', { topic, dual: true }, envelope.correlationId);
        throw new ServiceUnavailableException({
          reason: 'PUBLISH_FAILED',
          details: `Command channel to ${vehicleId} is down — ${payload.action} was NOT sent on either message path.`,
        });
      }
      if (!viaEstop || !viaCommand) {
        // Degraded redundancy is auditable (LEG-04) — the E-STOP is on its
        // way on one path, but the loss of the second must not be silent.
        await this.logEdr(commandId, vehicleId, operatorId, payload.action, 'PUBLISH_DEGRADED',
          { delivered: { estop: viaEstop, command: viaCommand } }, envelope.correlationId);
      }
      this.watchForAck(commandId, vehicleId, operatorId, payload.action, envelope.correlationId, envelope.ttlMs);
      return {
        status: 'pending', commandId, action: payload.action, mode,
        channels: { estop: viaEstop, command: viaCommand },
        message: `${payload.action} published (dual message, ICD §3)`,
      };
    }

    // Audit-7 finding 4: a silently dropped publish must never look like a
    // sent command — for E-STOP the ICD (§3) demands first-attempt delivery,
    // so the operator needs the failure signal IMMEDIATELY to fall back to
    // another action. EDR keeps both rows: the PENDING attempt + the failure.
    if (!this.mqttService.publish(topic, envelope)) {
      await this.logEdr(commandId, vehicleId, operatorId, payload.action, 'PUBLISH_FAILED', { topic }, envelope.correlationId);
      throw new ServiceUnavailableException({
        reason: 'PUBLISH_FAILED',
        details: `Command channel to ${vehicleId} is down — ${payload.action} was NOT sent to the vehicle.`,
      });
    }

    // ICD §3: every command is acknowledged. If no ACK/NACK lands within the
    // TTL (+grace), append a NO_ACK record so the exchange has a recorded
    // outcome (audit-7 finding 6). Visibility only — the retry policy comes
    // with the M2-5 IoT Core backbone. Per-instance timer, same class and
    // closure trigger as the deadman timers (DEV-11).
    this.watchForAck(commandId, vehicleId, operatorId, payload.action, envelope.correlationId, envelope.ttlMs);

    return { status: 'pending', commandId, action: payload.action, mode, message: `${payload.action} published` };
  }

  private watchForAck(commandId: string, vehicleId: string, operatorId: string, action: string, correlationId: string, ttlMs: number) {
    const timer = setTimeout(async () => {
      try {
        const ack = await this.prisma.eventDataRecord.findFirst({
          where: { commandId, issuer: 'VEHICLE' },
        });
        if (ack) return;
        await this.logEdr(commandId, vehicleId, operatorId, action, 'NO_ACK', {
          note: `No ACK/NACK from the vehicle within ttl ${ttlMs}ms + grace (ICD §3).`,
        }, correlationId);
        this.logger.warn(`NO_ACK recorded for ${action} (${commandId}) on ${vehicleId}`);
      } catch (e) {
        this.logger.error(`NO_ACK watcher failed for ${commandId}`, e as Error);
      }
    }, ttlMs + 3000);
    // Do not hold the process open for a watcher (tests, graceful shutdown).
    timer.unref?.();
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
