import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({ cors: { origin: '*' } })
export class FleetGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private logger = new Logger('FleetGateway');

  handleConnection(client: Socket) {
    this.logger.log(`Console connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Console disconnected: ${client.id}`);
  }

  broadcastMissionUpdate(vehicleId: string, data: any) {
    this.server.emit(`mission/${vehicleId}`, data);
  }

  broadcastChecklistUpdate(vehicleId: string, data: any) {
    this.server.emit(`checklist/${vehicleId}`, data);
  }
}
