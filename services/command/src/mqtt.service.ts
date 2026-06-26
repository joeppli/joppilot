import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import * as mqtt from 'mqtt';
import * as fs from 'fs';
import { PrismaService } from './prisma.service';

@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private client: mqtt.MqttClient;
  private readonly logger = new Logger(MqttService.name);

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    const isAws = !!process.env.AWS_IOT_ENDPOINT;
    const host = process.env.AWS_IOT_ENDPOINT || 'localhost';
    const protocol = isAws ? 'mqtts' : 'mqtt';
    const port = isAws ? 8883 : 1883;

    const options: mqtt.IClientOptions = {
      clientId: 'joppilot-cmd-' + Math.random().toString(16).substr(2, 8),
      protocol,
      host,
      port,
    };

    if (isAws) {
      this.logger.log('Configuring mTLS for AWS IoT Core...');
      options.key = fs.readFileSync(process.env.AWS_CERT_PRIVATE_KEY_PATH!);
      options.cert = fs.readFileSync(process.env.AWS_CERT_CERT_PATH!);
      options.ca = fs.readFileSync(process.env.AWS_CERT_ROOT_CA_PATH!);
    }

    this.client = mqtt.connect(options);

    this.client.on('connect', () => {
      this.logger.log(`Connected to MQTT Broker (${isAws ? 'AWS IoT Core' : 'Mosquitto'})`);
      
      this.client.subscribe('joppilot/v1/vehicles/+/command/ack', (err) => {
        if (!err) this.logger.log('Subscribed to command ACKs');
      });
    });

    this.client.on('message', async (topic, message) => {
      if (topic.endsWith('/ack')) {
        this.logger.log(`Received ACK on ${topic}: ${message.toString()}`);
        try {
          const payload = JSON.parse(message.toString());
          await this.prisma.eventDataRecord.update({
            where: { commandId: payload.commandId },
            data: { status: payload.status }
          });
        } catch(e) {
          this.logger.error('Failed to parse/update ACK', e);
        }
      }
    });

    this.client.on('error', (error) => {
      this.logger.error('MQTT Error: ', error);
    });
  }

  onModuleDestroy() {
    this.client.end();
  }

  publish(topic: string, payload: any) {
    if (this.client.connected) {
      this.client.publish(topic, JSON.stringify(payload), { qos: 1 });
      this.logger.log(`Published to ${topic}: ${JSON.stringify(payload)}`);
    } else {
      this.logger.error('MQTT client not connected. Cannot publish.');
    }
  }
}

