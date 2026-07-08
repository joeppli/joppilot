import { Module } from '@nestjs/common';
import { MqttService } from './mqtt.service';
import { HealthController } from './health.controller';
import { TelemetryWriterService } from './telemetry-writer.service';
import { TelemetryGateway } from './telemetry.gateway';

@Module({
  imports: [],
  controllers: [HealthController],
  providers: [MqttService, TelemetryWriterService, TelemetryGateway],
})
export class AppModule {}
