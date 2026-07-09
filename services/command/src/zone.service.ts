import { Injectable, Logger } from '@nestjs/common';
import { ZoneType, OperationMode, ZoneConfig, isModeAllowedInZone } from '@joppilot/contract';
import { MqttService } from './mqtt.service';
import { SigningService } from './signing.service';

/** Permit context attached to a zone that opens Mode 2 on a public route (ICD §1). */
export interface ZonePermit {
  permitId: string;
  changedBy: string;
  reason?: string;
  // Permit validity window. The zone is only honoured while current; past the
  // window it falls back to the safe default (public_approved_route).
  validUntil?: number;
}

interface ZoneRecord {
  zone: ZoneType;
  permit?: ZonePermit;
}

/**
 * Cloud-side Zone/Geofence service - the 1st gate (ICD §1, Architecture §5).
 *
 * Holds the canton-approved zone type per vehicle. Cantonal approvals and
 * test permits enter the system as zone CONFIGURATION here; no role can flip
 * a mode at runtime. The final, authoritative check still lives on the
 * vehicle (2nd gate) - this gate only hides/blocks disallowed controls early.
 *
 * M2-5 (closes DEV-8): every zone (re)configuration is DELIVERED to the
 * vehicle as a SIGNED, revision-monotonic ZoneConfig document — a retained
 * MQTT message locally, the `zone-config` named Device Shadow on AWS IoT.
 * The edge verifies the signature against its pinned cloud key and ignores
 * anything unverifiable or older than what it already holds (fail-safe: it
 * stays on its stricter current zone).
 */
@Injectable()
export class ZoneService {
  private readonly logger = new Logger(ZoneService.name);
  // In-memory zone registry + revision counters (DEV-11). In production this
  // is backed by Aurora + Valkey cache and pushed to the vehicle edge (AD-15).
  private readonly vehicleZones = new Map<string, ZoneRecord>();
  private readonly revisions = new Map<string, number>();

  constructor(
    private readonly mqttService: MqttService,
    private readonly signing: SigningService,
  ) {}

  /** Effective zone. A test-permit zone whose validity window has lapsed falls
   *  back to the safe default — a permit can never silently outlive its window. */
  getZone(vehicleId: string): ZoneType {
    const rec = this.vehicleZones.get(vehicleId);
    if (!rec) return 'public_approved_route';
    if (rec.permit?.validUntil && Date.now() > rec.permit.validUntil) {
      this.logger.warn(`Permit for ${vehicleId} expired → reverting '${rec.zone}' to public_approved_route`);
      this.vehicleZones.set(vehicleId, { zone: 'public_approved_route' });
      // Best-effort delivery of the reverted config; the edge reverts on its
      // own via the document's validUntil either way (vehicle-authoritative).
      this.deliverConfig(vehicleId, 'PERMIT-EXPIRY');
      return 'public_approved_route';
    }
    return rec.zone;
  }

  getZoneInfo(vehicleId: string): ZoneRecord {
    return this.vehicleZones.get(vehicleId) ?? { zone: 'public_approved_route' };
  }

  /** Controlled, logged zone (re)configuration - e.g. activating a test permit.
   *  Returns whether the signed config reached the broker (ICD §1 delivery). */
  setZone(vehicleId: string, zone: ZoneType, permit?: ZonePermit): { delivered: boolean; revision: number } {
    this.vehicleZones.set(vehicleId, { zone, permit });
    const tag = permit ? ` (permit ${permit.permitId} by ${permit.changedBy})` : '';
    this.logger.log(`Zone for ${vehicleId} set to '${zone}'${tag} (configuration change, logged)`);
    return this.deliverConfig(vehicleId, permit?.changedBy ?? 'ADMIN');
  }

  /**
   * Build, sign and publish the vehicle's current zone config (M2-5).
   * Local broker: retained topic joppilot/v1/vehicles/{id}/zone-config.
   * AWS IoT: the `zone-config` named Device Shadow (desired state).
   */
  private deliverConfig(vehicleId: string, issuer: string): { delivered: boolean; revision: number } {
    const rec = this.getZoneInfo(vehicleId);
    // Monotonic revision: replayed older configs can never downgrade the edge.
    const revision = Math.max(Date.now(), (this.revisions.get(vehicleId) ?? 0) + 1);
    this.revisions.set(vehicleId, revision);

    const config: ZoneConfig = this.signing.signDocument({
      vehicleId,
      zone: rec.zone,
      permit: rec.permit?.validUntil
        ? { permitId: rec.permit.permitId, validUntil: rec.permit.validUntil }
        : undefined,
      issuedAt: Date.now(),
      revision,
      issuer,
    });

    const isAws = !!process.env.AWS_IOT_ENDPOINT;
    const delivered = isAws
      ? this.mqttService.publish(
          `$aws/things/${vehicleId}/shadow/name/zone-config/update`,
          { state: { desired: { config } } },
        )
      : this.mqttService.publish(`joppilot/v1/vehicles/${vehicleId}/zone-config`, config, { retain: true });

    if (!delivered) {
      // Fail-safe direction (ICD §1/DEV-8 note): the edge stays on its
      // stricter current zone until a verifiable config arrives.
      this.logger.error(`Zone config for ${vehicleId} NOT delivered (broker down) — edge stays on its current zone.`);
    }
    return { delivered, revision };
  }

  isModeAllowed(vehicleId: string, mode: OperationMode): boolean {
    return isModeAllowedInZone(this.getZone(vehicleId), mode);
  }
}
