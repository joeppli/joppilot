import { Module } from '@nestjs/common';
import { MqttService } from './mqtt.service';
import { CommandController } from './command.controller';
import { ManeuverController } from './maneuver.controller';
import { ManeuverService } from './maneuver.service';
import { ManeuverGateway } from './maneuver.gateway';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { SessionService } from './session.service';
import { ZoneService } from './zone.service';

@Module({
  imports: [],
  controllers: [CommandController, ManeuverController],
  providers: [MqttService, PrismaService, RedisService, SessionService, ZoneService, ManeuverService, ManeuverGateway],
})
export class AppModule {}
