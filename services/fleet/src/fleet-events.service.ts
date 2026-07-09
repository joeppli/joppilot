import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Append-only audit writer for the fleet workflows (ICD §7 step 4, LEG-03/04,
 * audit-7 finding 1). Every checklist creation, item verification,
 * confirmation (including rejected attempts) and mission transition becomes a
 * NEW FleetEventRecord row — never an update. correlationId is the
 * checklistId for the pre-departure chain and the missionId for the mission
 * chain, so the whole workflow reads as one thread (SEC-06).
 *
 * The write is awaited BEFORE the state change it evidences where the record
 * is legally load-bearing (confirmation): a confirmation that exists without
 * its audit row would break the LEG-03 evidence chain.
 */
@Injectable()
export class FleetEventsService {
  private readonly logger = new Logger(FleetEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async append(
    correlationId: string,
    vehicleId: string,
    issuer: string,
    action: string,
    status: string,
    details?: unknown,
  ): Promise<void> {
    await this.prisma.fleetEventRecord.create({
      data: {
        correlationId,
        vehicleId,
        issuer,
        action,
        status,
        details: details === undefined ? undefined : JSON.parse(JSON.stringify(details)),
      },
    });
  }
}
