import { Controller, Post, Get, Param, Body, Req, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PreDepartureService } from './pre-departure.service';
import { MissionService } from './mission.service';
import { SessionCheckService } from './session-check.service';
import { FleetEventsService } from './fleet-events.service';
import { requireOperatorIdentity } from './identity';

/**
 * Fleet workflows are OPERATOR actions on a vehicle (ICD §4/§7): every
 * mutating endpoint requires (a) the claimed operatorId to be the
 * authenticated caller (LEG-05, cloud), and (b) the caller to hold the
 * vehicle's active fencing lock (SEC-05 — which take-control only grants to
 * an ASSIGNED operator, SEC-04). Rejected confirmation attempts are audit
 * rows too: "who tried to confirm what they were not allowed to" is part of
 * the LEG-05 chain of evidence.
 *
 * DEV-18: these remain cloud-side workflows — the matching ICD §4 Mode 1
 * commands (CONFIRM_PRE_DEPARTURE_CHECK, START_MISSION, …) are not yet sent
 * to the vehicle as envelopes; that wiring lands in M3 with the edge
 * mission/checklist consumption.
 */
@Controller('api/fleet')
export class FleetController {
  private readonly logger = new Logger(FleetController.name);

  constructor(
    private readonly preDeparture: PreDepartureService,
    private readonly missions: MissionService,
    private readonly session: SessionCheckService,
    private readonly events: FleetEventsService,
  ) {}

  // ---- Pre-departure check (ICD §7) ----

  @Post(':vehicleId/pre-departure')
  async createChecklist(
    @Param('vehicleId') vehicleId: string,
    @Body('operatorId') operatorId: string,
    @Body('token') token: string,
    @Req() req: any,
  ) {
    requireOperatorIdentity(req, operatorId);
    await this.session.requireControl(vehicleId, operatorId, token);
    return this.preDeparture.createChecklist(vehicleId, operatorId);
  }

  @Get('pre-departure/:checklistId')
  async getChecklist(@Param('checklistId') checklistId: string) {
    const cl = await this.preDeparture.getChecklist(checklistId);
    if (!cl) throw new NotFoundException('Checklist not found');
    return cl;
  }

  @Post('pre-departure/:checklistId/item/:itemId')
  async updateCheckItem(
    @Param('checklistId') checklistId: string,
    @Param('itemId') itemId: string,
    @Body('operatorId') operatorId: string,
    @Body('token') token: string,
    @Body('status') status: 'PASS' | 'FAIL',
    @Req() req: any,
    @Body('detail') detail?: string,
  ) {
    requireOperatorIdentity(req, operatorId);
    const cl = await this.preDeparture.getChecklist(checklistId);
    if (!cl) throw new NotFoundException('Checklist not found');
    await this.session.requireControl(cl.vehicleId, operatorId, token);
    try {
      return await this.preDeparture.updateItem(checklistId, itemId, status, operatorId, detail);
    } catch (e) {
      throw new BadRequestException(e.message);
    }
  }

  @Post('pre-departure/:checklistId/confirm')
  async confirmChecklist(
    @Param('checklistId') checklistId: string,
    @Body('operatorId') operatorId: string,
    @Body('token') token: string,
    @Req() req: any,
  ) {
    requireOperatorIdentity(req, operatorId);
    const cl = await this.preDeparture.getChecklist(checklistId);
    if (!cl) throw new NotFoundException('Checklist not found');
    await this.session.requireControl(cl.vehicleId, operatorId, token);
    try {
      return await this.preDeparture.confirm(checklistId, operatorId);
    } catch (e) {
      // The failed confirmation attempt is evidence too (LEG-05). Written
      // AFTER the rollback — an audit row inside the failed transaction
      // would vanish with it.
      await this.events.append(checklistId, cl.vehicleId, operatorId, 'CHECKLIST_CONFIRM', 'REJECTED', { reason: e.message });
      throw new BadRequestException(e.message);
    }
  }

  // ---- Mission lifecycle ----

  @Post(':vehicleId/mission')
  async createMission(
    @Param('vehicleId') vehicleId: string,
    @Body('operatorId') operatorId: string,
    @Body('token') token: string,
    @Req() req: any,
    @Body('routeId') routeId?: string,
  ) {
    requireOperatorIdentity(req, operatorId);
    await this.session.requireControl(vehicleId, operatorId, token);
    try {
      const mission = await this.missions.create(vehicleId, operatorId, routeId);
      try {
        const checklist = await this.preDeparture.createChecklist(vehicleId, operatorId);
        await this.missions.linkChecklist(mission.id, checklist.checklistId);
        return { mission: { ...mission, status: 'PRE_CHECK' }, checklist };
      } catch (e) {
        // Never leave a checklist-less mission behind: it could not start
        // anyway (LEG-03 fail-closed) but would block the vehicle's slot.
        await this.missions.abort(mission.id, 'SYSTEM-CLEANUP').catch(() => undefined);
        throw e;
      }
    } catch (e) {
      throw new BadRequestException(e.message);
    }
  }

  @Get(':vehicleId/mission')
  async getActiveMission(@Param('vehicleId') vehicleId: string) {
    const mission = await this.missions.getActive(vehicleId);
    if (!mission) throw new NotFoundException('No active mission');
    return mission;
  }

  @Get('mission/:missionId')
  async getMission(@Param('missionId') missionId: string) {
    const mission = await this.missions.get(missionId);
    if (!mission) throw new NotFoundException('Mission not found');
    return mission;
  }

  @Post('mission/:missionId/start')
  async startMission(
    @Param('missionId') missionId: string,
    @Body('operatorId') operatorId: string,
    @Body('token') token: string,
    @Req() req: any,
  ) {
    return this.missionOp(missionId, operatorId, token, req, 'start');
  }

  @Post('mission/:missionId/pause')
  async pauseMission(
    @Param('missionId') missionId: string,
    @Body('operatorId') operatorId: string,
    @Body('token') token: string,
    @Req() req: any,
  ) {
    return this.missionOp(missionId, operatorId, token, req, 'pause');
  }

  @Post('mission/:missionId/resume')
  async resumeMission(
    @Param('missionId') missionId: string,
    @Body('operatorId') operatorId: string,
    @Body('token') token: string,
    @Req() req: any,
  ) {
    return this.missionOp(missionId, operatorId, token, req, 'resume');
  }

  @Post('mission/:missionId/abort')
  async abortMission(
    @Param('missionId') missionId: string,
    @Body('operatorId') operatorId: string,
    @Body('token') token: string,
    @Req() req: any,
  ) {
    return this.missionOp(missionId, operatorId, token, req, 'abort');
  }

  @Post('mission/:missionId/complete')
  async completeMission(
    @Param('missionId') missionId: string,
    @Body('operatorId') operatorId: string,
    @Body('token') token: string,
    @Req() req: any,
  ) {
    return this.missionOp(missionId, operatorId, token, req, 'complete');
  }

  /** Shared gate + dispatch for the mission lifecycle transitions. */
  private async missionOp(
    missionId: string,
    operatorId: string,
    token: string,
    req: any,
    op: 'start' | 'pause' | 'resume' | 'abort' | 'complete',
  ) {
    requireOperatorIdentity(req, operatorId);
    const mission = await this.missions.get(missionId);
    if (!mission) throw new NotFoundException('Mission not found');
    await this.session.requireControl(mission.vehicleId, operatorId, token);
    try {
      return await this.missions[op](missionId, operatorId);
    } catch (e) {
      // A refused transition is evidence too (e.g. a start attempted without
      // a confirmed checklist — LEG-03). Written after the rollback.
      await this.events.append(missionId, mission.vehicleId, operatorId, `MISSION_${op.toUpperCase()}`, 'REJECTED', { reason: e.message });
      throw new BadRequestException(e.message);
    }
  }
}
