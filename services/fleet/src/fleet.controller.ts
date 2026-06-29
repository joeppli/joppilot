import { Controller, Post, Get, Param, Body, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PreDepartureService } from './pre-departure.service';
import { MissionService } from './mission.service';

@Controller('api/fleet')
export class FleetController {
  private readonly logger = new Logger(FleetController.name);

  constructor(
    private readonly preDeparture: PreDepartureService,
    private readonly missions: MissionService,
  ) {}

  // ---- Pre-departure check (ICD §7) ----

  @Post(':vehicleId/pre-departure')
  async createChecklist(@Param('vehicleId') vehicleId: string) {
    return this.preDeparture.createChecklist(vehicleId);
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
    @Body('status') status: 'PASS' | 'FAIL',
    @Body('detail') detail?: string,
  ) {
    try {
      return await this.preDeparture.updateItem(checklistId, itemId, status, detail);
    } catch (e) {
      throw new BadRequestException(e.message);
    }
  }

  @Post('pre-departure/:checklistId/confirm')
  async confirmChecklist(
    @Param('checklistId') checklistId: string,
    @Body('operatorId') operatorId: string,
  ) {
    try {
      return await this.preDeparture.confirm(checklistId, operatorId);
    } catch (e) {
      throw new BadRequestException(e.message);
    }
  }

  // ---- Mission lifecycle ----

  @Post(':vehicleId/mission')
  async createMission(
    @Param('vehicleId') vehicleId: string,
    @Body('routeId') routeId?: string,
  ) {
    try {
      const mission = await this.missions.create(vehicleId, routeId);
      const checklist = await this.preDeparture.createChecklist(vehicleId);
      await this.missions.linkChecklist(mission.id, checklist.checklistId);
      return { mission: { ...mission, status: 'PRE_CHECK' }, checklist };
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
  async startMission(@Param('missionId') missionId: string) {
    try {
      return await this.missions.start(missionId);
    } catch (e) {
      throw new BadRequestException(e.message);
    }
  }

  @Post('mission/:missionId/pause')
  async pauseMission(@Param('missionId') missionId: string) {
    try {
      return await this.missions.pause(missionId);
    } catch (e) {
      throw new BadRequestException(e.message);
    }
  }

  @Post('mission/:missionId/resume')
  async resumeMission(@Param('missionId') missionId: string) {
    try {
      return await this.missions.resume(missionId);
    } catch (e) {
      throw new BadRequestException(e.message);
    }
  }

  @Post('mission/:missionId/abort')
  async abortMission(@Param('missionId') missionId: string) {
    try {
      return await this.missions.abort(missionId);
    } catch (e) {
      throw new BadRequestException(e.message);
    }
  }

  @Post('mission/:missionId/complete')
  async completeMission(@Param('missionId') missionId: string) {
    try {
      return await this.missions.complete(missionId);
    } catch (e) {
      throw new BadRequestException(e.message);
    }
  }
}
