import { Controller, Post, Param, Body, Logger, NotFoundException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ManeuverService } from './maneuver.service';
import { SessionService } from './session.service';
import { ZoneService } from './zone.service';
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
    private readonly zoneService: ZoneService,
    private readonly mqttService: MqttService,
    private readonly prisma: PrismaService,
  ) {}

  @Post(':proposalId/decide')
  async decide(
    @Param('proposalId') proposalId: string,
    @Body('operatorId') operatorId: string,
    @Body('token') token: string,
    @Body('decision') decision: 'CONFIRM' | 'REJECT' | 'SELECT_ALTERNATIVE',
    @Body('optionId') optionId?: string,
  ) {
    const proposal = this.maneuverService.getActiveProposalById(proposalId);
    if (!proposal) {
      throw new NotFoundException(`No active proposal found with id '${proposalId}' (may have timed out).`);
    }

    const vehicleId = proposal.vehicleId;
    const isValid = await this.sessionService.validateToken(vehicleId, operatorId, token);
    if (!isValid) {
      throw new UnauthorizedException('Invalid fencing token. You do not have control.');
    }

    let payload: CommandPayload;
    switch (decision) {
      case 'CONFIRM':
        payload = { action: 'CONFIRM_MANEUVER', proposalId } as CommandPayload;
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
    const envelope: CommandEnvelope = {
      commandId,
      correlationId: uuidv4(),
      sessionId: token,
      vehicleId,
      issuer: operatorId,
      mode,
      token: { tokenId: token, issuedAt },
      timestamp: Date.now(),
      ttlMs: 5000,
      payload,
    };

    const check = CommandEnvelopeSchema.safeParse(envelope);
    if (!check.success) {
      this.logger.error(`Envelope failed validation: ${JSON.stringify(check.error.issues)}`);
      throw new BadRequestException({ reason: 'SCHEMA_INVALID', details: check.error.issues });
    }

    await this.prisma.eventDataRecord.create({
      data: {
        commandId,
        vehicleId,
        issuer: operatorId,
        action: payload.action,
        status: 'PENDING',
        details: JSON.parse(JSON.stringify(envelope)),
      },
    });

    const topic = `joppilot/v1/vehicles/${vehicleId}/command`;
    this.mqttService.publish(topic, envelope);
    this.maneuverService.resolveProposal(proposalId);

    this.logger.log(`Maneuver decision dispatched: ${decision} for proposal ${proposalId} by ${operatorId}`);

    return { status: 'pending', commandId, proposalId, decision, action: payload.action };
  }
}
