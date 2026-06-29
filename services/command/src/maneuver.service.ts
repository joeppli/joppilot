import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { MqttService } from './mqtt.service';
import { PrismaService } from './prisma.service';
import {
  ManeuverProposalSchema,
  ManeuverProposal,
  ManeuverProposalStatusUpdateSchema,
  ManeuverProposalStatusUpdate,
} from '@joppilot/contract';

interface ActiveProposal {
  proposal: ManeuverProposal;
  receivedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

@Injectable()
export class ManeuverService implements OnModuleInit {
  private readonly logger = new Logger(ManeuverService.name);
  private activeProposals = new Map<string, ActiveProposal>();
  private statusListeners: ((update: ManeuverProposalStatusUpdate) => void)[] = [];
  private proposalListeners: ((proposal: ManeuverProposal) => void)[] = [];

  constructor(
    private readonly mqttService: MqttService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.mqttService.subscribeManeuver(
      (topic, message) => this.handleIncoming(topic, message),
    );
    this.logger.log('Maneuver service initialized — listening for proposals and status updates');
  }

  onProposal(fn: (proposal: ManeuverProposal) => void) {
    this.proposalListeners.push(fn);
  }

  onStatusUpdate(fn: (update: ManeuverProposalStatusUpdate) => void) {
    this.statusListeners.push(fn);
  }

  getActiveProposal(vehicleId: string): ManeuverProposal | null {
    for (const [, ap] of this.activeProposals) {
      if (ap.proposal.vehicleId === vehicleId) return ap.proposal;
    }
    return null;
  }

  getActiveProposalById(proposalId: string): ManeuverProposal | null {
    return this.activeProposals.get(proposalId)?.proposal ?? null;
  }

  resolveProposal(proposalId: string) {
    const ap = this.activeProposals.get(proposalId);
    if (ap) {
      clearTimeout(ap.timer);
      this.activeProposals.delete(proposalId);
    }
  }

  private async handleIncoming(topic: string, raw: Buffer) {
    const msg = JSON.parse(raw.toString());

    if (topic.includes('/maneuver/proposal')) {
      await this.handleProposal(msg);
    } else if (topic.includes('/maneuver/status')) {
      await this.handleStatusUpdate(msg);
    }
  }

  private async handleProposal(msg: unknown) {
    const parsed = ManeuverProposalSchema.safeParse(msg);
    if (!parsed.success) {
      this.logger.warn(`Invalid maneuver proposal received: ${JSON.stringify(parsed.error.issues)}`);
      return;
    }

    const proposal = parsed.data;
    this.logger.log(`Maneuver proposal received: ${proposal.proposalId} (reason: ${proposal.reasonCode}, window: ${proposal.validityWindowMs}ms)`);

    // Cloud-side timeout tracker (UI/EDR only — edge is authoritative)
    const timer = setTimeout(() => {
      this.logger.warn(`Maneuver proposal TIMED OUT (cloud-side): ${proposal.proposalId}`);
      this.activeProposals.delete(proposal.proposalId);
    }, proposal.validityWindowMs + 2000); // +2s grace: edge is authoritative

    this.activeProposals.set(proposal.proposalId, {
      proposal,
      receivedAt: Date.now(),
      timer,
    });

    // EDR
    await this.prisma.eventDataRecord.create({
      data: {
        commandId: `proposal-${proposal.proposalId}`,
        vehicleId: proposal.vehicleId,
        issuer: 'ADS',
        action: 'MANEUVER_PROPOSAL',
        status: 'PENDING',
        details: JSON.parse(JSON.stringify(proposal)),
      },
    });

    this.proposalListeners.forEach(fn => fn(proposal));
  }

  private async handleStatusUpdate(msg: unknown) {
    const parsed = ManeuverProposalStatusUpdateSchema.safeParse(msg);
    if (!parsed.success) {
      this.logger.warn(`Invalid maneuver status update: ${JSON.stringify(parsed.error.issues)}`);
      return;
    }

    const update = parsed.data;
    this.logger.log(`Maneuver status update: ${update.proposalId} → ${update.status}`);

    if (update.status === 'DECIDED' || update.status === 'TIMED_OUT' || update.status === 'CANCELLED') {
      this.resolveProposal(update.proposalId);
    }

    // Update EDR
    try {
      await this.prisma.eventDataRecord.update({
        where: { commandId: `proposal-${update.proposalId}` },
        data: {
          status: update.status,
          details: JSON.parse(JSON.stringify(update)),
        },
      });
    } catch {
      this.logger.warn(`EDR update failed for proposal ${update.proposalId} (may not exist)`);
    }

    this.statusListeners.forEach(fn => fn(update));
  }
}
