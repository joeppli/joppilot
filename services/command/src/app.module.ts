import { Module } from '@nestjs/common';
import { MqttService } from './mqtt.service';
import { CommandController } from './command.controller';
import { HealthController } from './health.controller';
import { ManeuverController } from './maneuver.controller';
import { ManeuverService } from './maneuver.service';
import { ManeuverGateway } from './maneuver.gateway';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { SessionService } from './session.service';
import { ZoneService } from './zone.service';
import { AssignmentService } from './assignment.service';

@Module({
  imports: [],
  controllers: [CommandController, ManeuverController, HealthController],
  providers: [MqttService, PrismaService, RedisService, SessionService, ZoneService, AssignmentService, ManeuverService, ManeuverGateway],
})
export class AppModule {}
