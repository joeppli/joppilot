import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { CheckItem } from '@joppilot/contract';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_CHECKLIST: Omit<CheckItem, 'status'>[] = [
  { itemId: 'brakes-main',  label: 'Main braking system',          category: 'BRAKES',       safetyCritical: true,  source: 'SELF_DIAGNOSIS' },
  { itemId: 'brakes-park',  label: 'Parking brake',                category: 'BRAKES',       safetyCritical: true,  source: 'SELF_DIAGNOSIS' },
  { itemId: 'steering',     label: 'Steering system',              category: 'STEERING',     safetyCritical: true,  source: 'SELF_DIAGNOSIS' },
  { itemId: 'tires',        label: 'Tire pressure & condition',    category: 'TIRES',        safetyCritical: true,  source: 'OPERATOR' },
  { itemId: 'lights-head',  label: 'Headlights & tail lights',     category: 'LIGHTS',       safetyCritical: true,  source: 'OPERATOR' },
  { itemId: 'lights-turn',  label: 'Turn signals & hazard lights', category: 'LIGHTS',       safetyCritical: true,  source: 'OPERATOR' },
  { itemId: 'cam-front',    label: 'Front camera',                 category: 'PERCEPTION',   safetyCritical: true,  source: 'SELF_DIAGNOSIS' },
  { itemId: 'lidar',        label: 'LiDAR sensor',                 category: 'PERCEPTION',   safetyCritical: true,  source: 'SELF_DIAGNOSIS' },
  { itemId: 'motor',        label: 'Propulsion system',            category: 'PROPULSION',   safetyCritical: true,  source: 'SELF_DIAGNOSIS' },
  { itemId: 'connectivity', label: 'Cellular connectivity',        category: 'CONNECTIVITY', safetyCritical: false, source: 'SELF_DIAGNOSIS' },
];

@Injectable()
export class PreDepartureService {
  private readonly logger = new Logger(PreDepartureService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createChecklist(vehicleId: string): Promise<{ checklistId: string; items: CheckItem[] }> {
    const items: CheckItem[] = DEFAULT_CHECKLIST.map((tpl) => ({
      ...tpl,
      status: tpl.source === 'SELF_DIAGNOSIS' ? 'PASS' : 'PENDING',
    }));

    const record = await this.prisma.preDepartureCheck.create({
      data: {
        vehicleId,
        status: 'IN_PROGRESS',
        items: JSON.parse(JSON.stringify(items)),
      },
    });

    this.logger.log(`Pre-departure checklist created: ${record.id} for ${vehicleId}`);
    return { checklistId: record.id, items };
  }

  async updateItem(checklistId: string, itemId: string, status: 'PASS' | 'FAIL', detail?: string) {
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.preDepartureCheck.findUnique({ where: { id: checklistId } });
      if (!record) throw new Error('Checklist not found');
      if (record.status === 'CONFIRMED') throw new Error('Checklist already confirmed');

      const items = record.items as CheckItem[];
      const item = items.find((i) => i.itemId === itemId);
      if (!item) throw new Error(`Item ${itemId} not found`);

      item.status = status;
      if (detail) item.detail = detail;

      const allDone = items.every((i) => i.status !== 'PENDING');
      const anyFail = items.some((i) => i.safetyCritical && i.status === 'FAIL');
      const checkStatus = allDone ? (anyFail ? 'FAILED' : 'PASSED') : 'IN_PROGRESS';

      await tx.preDepartureCheck.update({
        where: { id: checklistId },
        data: { status: checkStatus, items: JSON.parse(JSON.stringify(items)) },
      });

      this.logger.log(`Checklist ${checklistId} item ${itemId} → ${status}, overall: ${checkStatus}`);
      return { checklistId, checkStatus, items };
    });
  }

  async confirm(checklistId: string, operatorId: string) {
    // LEG-03 invariant: a checklist may NEVER be observable as CONFIRMED while
    // items are pending or a safety-critical item has failed. Validation
    // therefore happens BEFORE the confirm write, inside one transaction — a
    // confirm-then-rollback order would expose a transient CONFIRMED that a
    // concurrent mission-start could act on.
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.preDepartureCheck.findUnique({ where: { id: checklistId } });
      if (!record) throw new Error('Checklist not found');
      if (record.status === 'CONFIRMED') throw new Error('Checklist already confirmed');

      const items = record.items as CheckItem[];
      if (items.some((i) => i.status === 'PENDING')) {
        throw new Error('Cannot confirm: some items are still PENDING');
      }
      // A completed checklist with a critical FAIL is already status FAILED
      // (updateItem sets it); this guard covers it regardless of stored status.
      if (items.some((i) => i.safetyCritical && i.status === 'FAIL')) {
        throw new Error('Cannot confirm: safety-critical item(s) failed');
      }

      // Guarded write: refuses a double-confirm racing outside this snapshot.
      const updated = await tx.preDepartureCheck.updateMany({
        where: { id: checklistId, status: { not: 'CONFIRMED' } },
        data: { status: 'CONFIRMED', confirmedBy: operatorId, confirmedAt: new Date() },
      });
      if (updated.count === 0) throw new Error('Checklist already confirmed');

      this.logger.log(`Checklist ${checklistId} CONFIRMED by ${operatorId}`);
      return { checklistId, status: 'CONFIRMED' };
    });
  }

  async getChecklist(checklistId: string) {
    return this.prisma.preDepartureCheck.findUnique({ where: { id: checklistId } });
  }
}
