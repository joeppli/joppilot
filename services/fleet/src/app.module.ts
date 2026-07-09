import { Module } from '@nestjs/common';
import { FleetController } from './fleet.controller';
import { HealthController } from './health.controller';
import { FleetGateway } from './fleet.gateway';
import { PreDepartureService } from './pre-departure.service';
import { MissionService } from './mission.service';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { SessionCheckService } from './session-check.service';
import { FleetEventsService } from './fleet-events.service';

@Module({
  controllers: [FleetController, HealthController],
  providers: [PrismaService, RedisService, SessionCheckService, FleetEventsService, PreDepartureService, MissionService, FleetGateway],
})
export class AppModule {}
