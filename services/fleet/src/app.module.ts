import { Module } from '@nestjs/common';
import { FleetController } from './fleet.controller';
import { FleetGateway } from './fleet.gateway';
import { PreDepartureService } from './pre-departure.service';
import { MissionService } from './mission.service';
import { PrismaService } from './prisma.service';

@Module({
  controllers: [FleetController],
  providers: [PrismaService, PreDepartureService, MissionService, FleetGateway],
})
export class AppModule {}
