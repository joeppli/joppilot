import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, OnModuleInit } from '@nestjs/common';
import { ManeuverService } from './maneuver.service';
import { ManeuverProposal, ManeuverProposalStatusUpdate } from '@joppilot/contract';

@WebSocketGateway({ cors: { origin: '*' } })
export class ManeuverGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer()
  server: Server;

  private logger = new Logger('ManeuverGateway');

  constructor(private readonly maneuverService: ManeuverService) {}

  onModuleInit() {
    this.maneuverService.onProposal((proposal) => {
      this.server.emit(`maneuver/proposal/${proposal.vehicleId}`, proposal);
      this.logger.log(`Broadcast proposal ${proposal.proposalId} to consoles`);
    });

    this.maneuverService.onStatusUpdate((update) => {
      this.server.emit(`maneuver/status/${update.vehicleId}`, update);
      this.logger.log(`Broadcast status ${update.proposalId} → ${update.status}`);
    });
  }

  handleConnection(client: Socket) {
    this.logger.log(`Console connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Console disconnected: ${client.id}`);
  }
}
