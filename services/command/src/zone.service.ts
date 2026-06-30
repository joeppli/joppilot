import { Injectable, Logger } from '@nestjs/common';
import { ZoneType, OperationMode, isModeAllowedInZone } from '@joppilot/contract';

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
 */
@Injectable()
export class ZoneService {
  private readonly logger = new Logger(ZoneService.name);
  // In-memory zone registry. In production this is backed by Aurora + Valkey
  // cache and pushed to the vehicle edge (Architecture AD-15).
  private readonly vehicleZones = new Map<string, ZoneRecord>();

  /** Effective zone. A test-permit zone whose validity window has lapsed falls
   *  back to the safe default — a permit can never silently outlive its window. */
  getZone(vehicleId: string): ZoneType {
    const rec = this.vehicleZones.get(vehicleId);
    if (!rec) return 'public_approved_route';
    if (rec.permit?.validUntil && Date.now() > rec.permit.validUntil) {
      this.logger.warn(`Permit for ${vehicleId} expired → reverting '${rec.zone}' to public_approved_route`);
      this.vehicleZones.set(vehicleId, { zone: 'public_approved_route' });
      return 'public_approved_route';
    }
    return rec.zone;
  }

  getZoneInfo(vehicleId: string): ZoneRecord {
    return this.vehicleZones.get(vehicleId) ?? { zone: 'public_approved_route' };
  }

  /** Controlled, logged zone (re)configuration - e.g. activating a test permit. */
  setZone(vehicleId: string, zone: ZoneType, permit?: ZonePermit): void {
    this.vehicleZones.set(vehicleId, { zone, permit });
    const tag = permit ? ` (permit ${permit.permitId} by ${permit.changedBy})` : '';
    this.logger.log(`Zone for ${vehicleId} set to '${zone}'${tag} (configuration change, logged)`);
  }

  isModeAllowed(vehicleId: string, mode: OperationMode): boolean {
    return isModeAllowedInZone(this.getZone(vehicleId), mode);
  }
}
