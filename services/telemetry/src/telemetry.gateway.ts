import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { TelemetryPayload, Heartbeat } from '@joppilot/contract';
import { Logger } from '@nestjs/common';

@WebSocketGateway({ cors: { origin: '*' } })
export class TelemetryGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;
  
  private logger = new Logger('TelemetryGateway');

  handleConnection(client: Socket) {
    this.logger.log(`Frontend Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Frontend Client disconnected: ${client.id}`);
  }

  broadcastTelemetry(vehicleId: string, payload: TelemetryPayload) {
    this.server.emit(`telemetry/${vehicleId}`, payload);
  }

  broadcastHeartbeat(vehicleId: string, payload: Heartbeat) {
    this.server.emit(`heartbeat/${vehicleId}`, payload);
  }

  // Cloud-side link/safe-mode advisory derived from heartbeat windows (ICD §9).
  // The binding safe-mode decision is on the vehicle; this drives operator alerting.
  broadcastLinkStatus(vehicleId: string, status: 'HEALTHY' | 'DEGRADED' | 'LOST') {
    this.server.emit(`link/${vehicleId}`, { vehicleId, status, at: Date.now() });
  }
}
