import { Controller, Post, Param, Body, Req, Logger, NotFoundException, UnauthorizedException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ManeuverService } from './maneuver.service';
import { SigningService } from './signing.service';
import { requireOperatorIdentity } from './identity';
import { SessionService } from './session.service';
import { MqttService } from './mqtt.service';
import { PrismaService } from './prisma.service';
import {
  CommandEnvelope,
  CommandEnvelopeSchema,
  CommandPayload,
  inferMode,
} from '@joppilot/contract';
import { v4 as uuidv4 } from 'uuid';

@Controller('api/maneuver')
export class ManeuverController {
  private readonly logger = new Logger(ManeuverController.name);

  constructor(
    private readonly maneuverService: ManeuverService,
    private readonly sessionService: SessionService,
    private readonly mqttService: MqttService,
    private readonly signing: SigningService,
    private readonly prisma: PrismaService,
  ) {}

  @Post(':proposalId/decide')
  async decide(
    @Param('proposalId') proposalId: string,
    @Body('operatorId') operatorId: string,
    @Body('token') token: string,
    @Body('decision') decision: 'CONFIRM' | 'REJECT' | 'SELECT_ALTERNATIVE',
    @Req() req: any,
    @Body('optionId') optionId?: string,
  ) {
    // LEG-05: the decision is EDR-attributed to operatorId — bind it to the
    // authenticated identity (audit-7 finding 3).
    requireOperatorIdentity(req, operatorId);
    const proposal = this.maneuverService.getActiveProposalById(proposalId);
    if (!proposal) {
      throw new NotFoundException(`No active proposal found with id '${proposalId}' (may have timed out).`);
    }

    const vehicleId = proposal.vehicleId;
    const isValid = await this.sessionService.validateToken(vehicleId, operatorId, token);
    if (!isValid) {
      throw new UnauthorizedException('Invalid fencing token. You do not have control.');
    }

    // ICD §6 (audit-9): a decision may only land on one of the proposal's OWN
    // options — the option semantics are frozen with the ADS team, so an
    // optionId the ADS never offered must not reach the B-boundary, and the
    // EDR must never evidence a decision on a non-existent option (LEG-05).
    // The edge re-checks this independently (2nd gate).
    const validOptionIds = new Set(proposal.options.map((o) => o.optionId));
    if (optionId && !validOptionIds.has(optionId)) {
      throw new BadRequestException({
        reason: 'INVALID_OPTION',
        details: `Option '${optionId}' is not one of proposal ${proposalId}'s options (ICD §6).`,
      });
    }

    let payload: CommandPayload;
    switch (decision) {
      case 'CONFIRM':
        // ICD §6 evidence semantics: approval carries the option it lands on
        // (usually the ADS's proposed maneuver) so the EDR distinguishes
        // "approved the proposal" from "selected an alternative".
        payload = { action: 'CONFIRM_MANEUVER', proposalId, ...(optionId ? { optionId } : {}) } as CommandPayload;
        break;
      case 'REJECT':
        payload = { action: 'REJECT_MANEUVER', proposalId } as CommandPayload;
        break;
      case 'SELECT_ALTERNATIVE':
        if (!optionId) throw new BadRequestException('optionId is required for SELECT_ALTERNATIVE');
        payload = { action: 'SELECT_ALTERNATIVE', proposalId, optionId } as CommandPayload;
        break;
      default:
        throw new BadRequestException(`Invalid decision: ${decision}`);
    }

    const mode = inferMode(payload.action);
    const commandId = uuidv4();
    const issuedAt = await this.sessionService.getTokenIssuedAt(vehicleId);
    // ICD §4 (M2-5): decisions are regular Mode 1 commands — signed like all.
    const envelope: CommandEnvelope = this.signing.signDocument({
      commandId,
      // The proposalId doubles as the correlation id: the decision command
      // joins the proposal → decision → outcome EDR chain (ICD §10, SEC-06).
      correlationId: proposalId,
      sessionId: token,
      vehicleId,
      issuer: operatorId,
      mode,
      token: { tokenId: token, issuedAt },
      timestamp: Date.now(),
      ttlMs: 5000,
      payload,
    });

    const check = CommandEnvelopeSchema.safeParse(envelope);
    if (!check.success) {
      this.logger.error(`Envelope failed validation: ${JSON.stringify(check.error.issues)}`);
      throw new BadRequestException({ reason: 'SCHEMA_INVALID', details: check.error.issues });
    }

    await this.prisma.eventDataRecord.create({
      data: {
        commandId,
        correlationId: proposalId,
        vehicleId,
        issuer: operatorId,
        action: payload.action,
        status: 'PENDING',
        details: JSON.parse(JSON.stringify(envelope)),
      },
    });

    const topic = `joppilot/v1/vehicles/${vehicleId}/command`;
    // Audit-7 finding 4: a dropped decision must fail loudly — the proposal
    // stays active so the operator can retry (or the edge applies the safe
    // default on timeout, which is exactly the ICD §6 fallback).
    if (!this.mqttService.publish(topic, envelope)) {
      await this.prisma.eventDataRecord.create({
        data: {
          commandId, correlationId: proposalId, vehicleId, issuer: operatorId,
          action: payload.action, status: 'PUBLISH_FAILED', details: { topic },
        },
      });
      throw new ServiceUnavailableException({
        reason: 'PUBLISH_FAILED',
        details: `Decision channel to ${vehicleId} is down — ${payload.action} was NOT sent.`,
      });
    }
    this.maneuverService.resolveProposal(proposalId);

    this.logger.log(`Maneuver decision dispatched: ${decision} for proposal ${proposalId} by ${operatorId}`);

    return { status: 'pending', commandId, proposalId, decision, action: payload.action };
  }
}
