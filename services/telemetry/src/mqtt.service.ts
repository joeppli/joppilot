import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import * as mqtt from 'mqtt';
import * as fs from 'fs';
import { TelemetryWriterService } from './telemetry-writer.service';
import { TelemetryGateway } from './telemetry.gateway';
import { TelemetryPayload, HeartbeatSchema } from '@joppilot/contract';

// Heartbeat is expected ~1Hz from the vehicle. Loss is evaluated over several
// windows so sporadic packet loss does not raise a false alarm (ICD §9).
const HEARTBEAT_PERIOD_MS = 1000;
const DEGRADED_AFTER_MISSES = 2; // ~2s silence → degraded
const LOST_AFTER_MISSES = 4;     // ~4s silence → link lost

@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private client: mqtt.MqttClient;
  private readonly logger = new Logger(MqttService.name);
  private readonly lastHeartbeat = new Map<string, number>();
  private readonly lastLinkStatus = new Map<string, 'HEALTHY' | 'DEGRADED' | 'LOST'>();
  private linkMonitor?: NodeJS.Timeout;

  constructor(
    private writer: TelemetryWriterService,
    private telemetryGateway: TelemetryGateway
  ) {}

  onModuleInit() {
    const isAws = !!process.env.AWS_IOT_ENDPOINT;
    const host = process.env.AWS_IOT_ENDPOINT || 'localhost';
    const protocol = isAws ? 'mqtts' : 'mqtt';
    const port = isAws ? 8883 : 1883;

    const options: mqtt.IClientOptions = {
      clientId: 'joppilot-tel-' + Math.random().toString(16).substr(2, 8),
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
      this.client.subscribe('joppilot/v1/vehicles/+/telemetry', (err) => {
        if (!err) this.logger.log('Subscribed to Telemetry');
      });
      this.client.subscribe('joppilot/v1/vehicles/+/heartbeat', (err) => {
        if (!err) this.logger.log('Subscribed to Heartbeat');
      });
    });

    // Window-based link/safe-mode monitor (ICD §9).
    this.linkMonitor = setInterval(() => this.evaluateLinks(), HEARTBEAT_PERIOD_MS);

    this.client.on('message', async (topic, message) => {
      if (topic.endsWith('/heartbeat')) {
        this.handleHeartbeat(message);
        return;
      }
      if (topic.endsWith('/telemetry')) {
        try {
          const payload = JSON.parse(message.toString()) as TelemetryPayload;

          // 1. Broadcast to Frontend via Socket.IO (low latency, RTP-02)
          this.telemetryGateway.broadcastTelemetry(payload.vehicleId, payload);

          // 2. Persist on the hot-path via batched raw insert (AD-14, ORM bypassed)
          this.writer.enqueue(payload);
        } catch(e) {
          this.logger.error('Failed to parse/save Telemetry', e);
        }
      }
    });

    this.client.on('error', (error) => {
      this.logger.error('MQTT Error: ', error);
    });
  }

  onModuleDestroy() {
    if (this.linkMonitor) clearInterval(this.linkMonitor);
    this.client.end();
  }

  private handleHeartbeat(message: Buffer) {
    const parsed = HeartbeatSchema.safeParse(JSON.parse(message.toString()));
    if (!parsed.success) {
      this.logger.warn('Dropped malformed heartbeat');
      return;
    }
    const hb = parsed.data;
    this.lastHeartbeat.set(hb.vehicleId, Date.now());
    this.telemetryGateway.broadcastHeartbeat(hb.vehicleId, hb);

    // The vehicle itself reports a latched safe-stop → surface immediately.
    if (hb.latched) {
      this.setLinkStatus(hb.vehicleId, 'LOST');
    } else {
      this.setLinkStatus(hb.vehicleId, 'HEALTHY');
    }
  }

  private evaluateLinks() {
    const now = Date.now();
    for (const [vehicleId, last] of this.lastHeartbeat) {
      const misses = Math.floor((now - last) / HEARTBEAT_PERIOD_MS);
      if (misses >= LOST_AFTER_MISSES) {
        this.setLinkStatus(vehicleId, 'LOST');
      } else if (misses >= DEGRADED_AFTER_MISSES) {
        this.setLinkStatus(vehicleId, 'DEGRADED');
      }
    }
  }

  private setLinkStatus(vehicleId: string, status: 'HEALTHY' | 'DEGRADED' | 'LOST') {
    if (this.lastLinkStatus.get(vehicleId) === status) return; // only emit on change
    this.lastLinkStatus.set(vehicleId, status);
    this.logger.log(`Link status for ${vehicleId}: ${status}`);
    this.telemetryGateway.broadcastLinkStatus(vehicleId, status);
  }
}
