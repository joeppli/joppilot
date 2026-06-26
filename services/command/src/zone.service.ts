import { Injectable, Logger } from '@nestjs/common';
import { ZoneType, OperationMode, isModeAllowedInZone } from '@joppilot/contract';

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
  private readonly vehicleZones = new Map<string, ZoneType>();

  getZone(vehicleId: string): ZoneType {
    return this.vehicleZones.get(vehicleId) ?? 'public_approved_route';
  }

  /** Controlled, logged zone (re)configuration - e.g. activating a test permit. */
  setZone(vehicleId: string, zone: ZoneType): void {
    this.vehicleZones.set(vehicleId, zone);
    this.logger.log(`Zone for ${vehicleId} set to '${zone}' (configuration change, logged)`);
  }

  isModeAllowed(vehicleId: string, mode: OperationMode): boolean {
    return isModeAllowedInZone(this.getZone(vehicleId), mode);
  }
}
