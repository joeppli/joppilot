import { Module } from '@nestjs/common';
import { MqttService } from './mqtt.service';
import { TelemetryWriterService } from './telemetry-writer.service';
import { TelemetryGateway } from './telemetry.gateway';

@Module({
  imports: [],
  controllers: [],
  providers: [MqttService, TelemetryWriterService, TelemetryGateway],
})
export class AppModule {}
