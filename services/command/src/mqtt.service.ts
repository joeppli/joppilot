import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import * as mqtt from 'mqtt';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { HeartbeatSchema } from '@joppilot/contract';
import { PrismaService } from './prisma.service';

@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private client: mqtt.MqttClient;
  private readonly logger = new Logger(MqttService.name);
  private maneuverHandler: ((topic: string, message: Buffer) => void) | null = null;
  // Last latch state per vehicle, to record only TRANSITIONS (RES-04).
  // Per-instance like the deadman timers (DEV-11) — with >1 task a transition
  // may be recorded twice; append-only EDR tolerates duplicates.
  private readonly lastLatch = new Map<string, boolean>();

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    // M2-4-3 interim: the cloud has no MQTT broker until IoT Core lands
    // (M2-5). MQTT_ENABLED=false skips the client entirely — otherwise the
    // task would reconnect-loop against localhost forever, spamming
    // CloudWatch. Command publish / ACK ingest / latch-EDR stay inactive
    // until M2-5 wires the real backbone.
    if (process.env.MQTT_ENABLED === 'false') {
      this.logger.warn('MQTT disabled (MQTT_ENABLED=false) — vehicle channels inactive until IoT Core (M2-5).');
      return;
    }
    const isAws = !!process.env.AWS_IOT_ENDPOINT;
    // Plain-MQTT host/port are configurable (MQTT_HOST/MQTT_PORT) so the
    // containerized service can reach a broker that is not on its own loopback
    // (docker/ECS — "localhost" only holds for the bare-metal M1 dev setup).
    const host = process.env.AWS_IOT_ENDPOINT || process.env.MQTT_HOST || 'localhost';
    const protocol = isAws ? 'mqtts' : 'mqtt';
    const port = isAws ? 8883 : Number(process.env.MQTT_PORT) || 1883;

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
      this.client.subscribe('joppilot/v1/vehicles/+/maneuver/proposal', (err) => {
        if (!err) this.logger.log('Subscribed to maneuver proposals');
      });
      this.client.subscribe('joppilot/v1/vehicles/+/maneuver/status', (err) => {
        if (!err) this.logger.log('Subscribed to maneuver status');
      });
      // Heartbeat carries the safe-stop latch flag; RES-04 requires every
      // latch entry to create an event record.
      this.client.subscribe('joppilot/v1/vehicles/+/heartbeat', (err) => {
        if (!err) this.logger.log('Subscribed to heartbeats (latch EDR)');
      });
    });

    this.client.on('message', async (topic, message) => {
      try {
        if (topic.endsWith('/ack')) {
          this.logger.log(`Received ACK on ${topic}: ${message.toString()}`);
          const payload = JSON.parse(message.toString());
          // Append-only EDR (LEG-04/SEC-06): the ACK/NACK is a NEW record
          // correlated by commandId — the PENDING row is never mutated.
          const original = await this.prisma.eventDataRecord.findFirst({
            where: { commandId: payload.commandId },
            orderBy: { createdAt: 'asc' },
          });
          await this.prisma.eventDataRecord.create({
            data: {
              commandId: payload.commandId,
              // SEC-06: the ACK inherits the correlation id of the command it
              // answers, so the whole exchange reads as one chain.
              correlationId: original?.correlationId ?? uuidv4(),
              vehicleId: original?.vehicleId ?? topic.split('/')[3],
              issuer: 'VEHICLE',
              action: original?.action ?? 'UNKNOWN',
              status: payload.status,
              details: payload,
            },
          });
        } else if (topic.endsWith('/heartbeat')) {
          // await so a malformed heartbeat rejects INTO this try/catch —
          // fire-and-forget would turn it into a process-killing unhandled
          // rejection (untrusted network input must never crash the service).
          await this.recordLatchTransition(message);
        } else if (topic.includes('/maneuver/') && this.maneuverHandler) {
          this.maneuverHandler(topic, message);
        }
      } catch (e) {
        this.logger.error(`Failed to process MQTT message on ${topic}`, e as Error);
      }
    });

    this.client.on('error', (error) => {
      this.logger.error('MQTT Error: ', error);
    });
  }

  onModuleDestroy() {
    this.client?.end();
  }

  subscribeManeuver(handler: (topic: string, message: Buffer) => void) {
    this.maneuverHandler = handler;
  }

  /**
   * RES-04: "every entry [into safe mode] creates an event record." The edge
   * latches locally (watchdog/geofence) without any cloud round-trip, so the
   * cloud observes latch state via the heartbeat flag and appends an EDR row
   * on every transition. INTERIM compensating record: the authoritative
   * on-vehicle event log + lossless sync is M3-6 (LEG-04); this cloud-side
   * row exists so no latch entry goes unrecorded until then.
   */
  private async recordLatchTransition(message: Buffer) {
    let raw: unknown;
    try {
      raw = JSON.parse(message.toString());
    } catch {
      return; // non-JSON heartbeat: drop, never throw
    }
    const parsed = HeartbeatSchema.safeParse(raw);
    if (!parsed.success) return;
    const hb = parsed.data;
    const latched = hb.latched === true;
    const prev = this.lastLatch.get(hb.vehicleId);
    this.lastLatch.set(hb.vehicleId, latched);
    // Record a transition; also record an initial "already latched" state so a
    // latch predating this instance's start is still evidenced.
    if (prev === latched || (prev === undefined && !latched)) return;

    await this.prisma.eventDataRecord.create({
      data: {
        commandId: uuidv4(),
        correlationId: uuidv4(),
        vehicleId: hb.vehicleId,
        issuer: 'VEHICLE',
        action: 'SAFE_STOP_LATCH',
        status: latched ? 'ENGAGED' : 'RELEASED',
        details: { heartbeat: hb },
      },
    });
    this.logger.warn(`SAFE_STOP_LATCH ${latched ? 'ENGAGED' : 'RELEASED'} recorded for ${hb.vehicleId} (RES-04)`);
  }

  publish(topic: string, payload: any) {
    if (this.client?.connected) {
      this.client.publish(topic, JSON.stringify(payload), { qos: 1 });
      this.logger.log(`Published to ${topic}: ${JSON.stringify(payload)}`);
    } else {
      this.logger.error('MQTT client not connected. Cannot publish.');
    }
  }
}

