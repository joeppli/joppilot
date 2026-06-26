import { Module } from '@nestjs/common';
import { MqttService } from './mqtt.service';
import { CommandController } from './command.controller';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { SessionService } from './session.service';
import { ZoneService } from './zone.service';

@Module({
  imports: [],
  controllers: [CommandController],
  providers: [MqttService, PrismaService, RedisService, SessionService, ZoneService],
})
export class AppModule {}
