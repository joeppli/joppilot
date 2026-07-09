import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { MissionStatus } from '@joppilot/contract';

@Injectable()
export class MissionService {
  private readonly logger = new Logger(MissionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(vehicleId: string, createdBy: string, routeId?: string) {
    const activeMission = await this.prisma.mission.findFirst({
      where: { vehicleId, status: { in: ['PENDING', 'PRE_CHECK', 'ACTIVE', 'PAUSED'] } },
    });
    if (activeMission) {
      throw new Error(`Vehicle ${vehicleId} already has an active mission: ${activeMission.id}`);
    }

    // Mission row + audit row are one atomic fact (LEG-04).
    const mission = await this.prisma.$transaction(async (tx) => {
      const m = await tx.mission.create({
        data: { vehicleId, routeId, status: 'PENDING' },
      });
      await tx.fleetEventRecord.create({
        data: {
          correlationId: m.id, vehicleId, issuer: createdBy,
          action: 'MISSION_CREATE', status: 'ACK', details: { routeId },
        },
      });
      return m;
    });

    this.logger.log(`Mission created: ${mission.id} for ${vehicleId} by ${createdBy}`);
    return mission;
  }

  async linkChecklist(missionId: string, checklistId: string) {
    await this.prisma.mission.update({
      where: { id: missionId },
      data: { checklistId, status: 'PRE_CHECK' },
    });
    this.logger.log(`Mission ${missionId} → PRE_CHECK (checklist: ${checklistId})`);
  }

  async start(missionId: string, startedBy: string) {
    const mission = await this.prisma.mission.findUnique({
      where: { id: missionId },
      include: { checklist: true },
    });
    if (!mission) throw new Error('Mission not found');

    // Only PRE_CHECK may start: a PENDING mission has no checklist linked yet,
    // and LEG-03 makes the pre-departure check mandatory before EVERY operation.
    const validFrom: MissionStatus[] = ['PRE_CHECK'];
    if (!validFrom.includes(mission.status as MissionStatus)) {
      throw new Error(`Cannot start mission in status ${mission.status}`);
    }

    // FAIL-CLOSED (LEG-03/ICD §7): no confirmed checklist → no start. A missing
    // checklist must block exactly like an unconfirmed one, otherwise any path
    // that leaves a mission without a checklist (e.g. a failed link step)
    // silently skips the legally mandatory check.
    if (!mission.checklist || mission.checklist.status !== 'CONFIRMED') {
      throw new Error('Cannot start: pre-departure check not confirmed');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.mission.update({
        where: { id: missionId },
        data: { status: 'ACTIVE', startedAt: new Date() },
      });
      await tx.fleetEventRecord.create({
        data: {
          correlationId: missionId, vehicleId: mission.vehicleId, issuer: startedBy,
          action: 'MISSION_START', status: 'ACK',
          details: { checklistId: mission.checklistId },
        },
      });
    });
    this.logger.log(`Mission ${missionId} STARTED by ${startedBy}`);
    return { missionId, status: 'ACTIVE' as MissionStatus };
  }

  async pause(missionId: string, by: string) {
    return this.transition(missionId, 'PAUSED', ['ACTIVE'], by);
  }

  async resume(missionId: string, by: string) {
    return this.transition(missionId, 'ACTIVE', ['PAUSED'], by);
  }

  async abort(missionId: string, by: string) {
    return this.transition(missionId, 'ABORTED', ['PENDING', 'PRE_CHECK', 'ACTIVE', 'PAUSED'], by);
  }

  async complete(missionId: string, by: string) {
    return this.transition(missionId, 'COMPLETED', ['ACTIVE'], by);
  }

  async getActive(vehicleId: string) {
    return this.prisma.mission.findFirst({
      where: { vehicleId, status: { in: ['PENDING', 'PRE_CHECK', 'ACTIVE', 'PAUSED'] } },
      include: { checklist: true },
    });
  }

  async get(missionId: string) {
    return this.prisma.mission.findUnique({ where: { id: missionId }, include: { checklist: true } });
  }

  private async transition(missionId: string, to: MissionStatus, fromAllowed: MissionStatus[], by: string) {
    const mission = await this.prisma.mission.findUnique({ where: { id: missionId } });
    if (!mission) throw new Error('Mission not found');
    if (!fromAllowed.includes(mission.status as MissionStatus)) {
      throw new Error(`Cannot transition from ${mission.status} to ${to}`);
    }

    const data: any = { status: to };
    if (to === 'COMPLETED' || to === 'ABORTED') data.completedAt = new Date();
    if (to === 'ACTIVE' && !mission.startedAt) data.startedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.mission.update({ where: { id: missionId }, data });
      // LEG-04: mission transitions are part of the operational event chain.
      await tx.fleetEventRecord.create({
        data: {
          correlationId: missionId, vehicleId: mission.vehicleId, issuer: by,
          action: `MISSION_${to}`, status: 'ACK', details: { from: mission.status },
        },
      });
    });
    this.logger.log(`Mission ${missionId} → ${to} by ${by}`);
    return { missionId, status: to };
  }
}
