import { describe, it, expect } from 'vitest';
import {
  CommandEnvelopeSchema,
  TelemetryPayloadSchema,
  HeartbeatSchema,
  ZoneConfigSchema,
  isModeAllowedInZone,
  canonicalStringify,
} from '../src/index';

describe('Zone ↔ Mode matrix (ICD §1)', () => {
  it('rejects Mode 2 on a public approved route', () => {
    expect(isModeAllowedInZone('public_approved_route', 'MODE2')).toBe(false);
    expect(isModeAllowedInZone('public_approved_route', 'MODE1')).toBe(true);
  });

  it('allows Mode 2 with a valid test permit and in the depot', () => {
    expect(isModeAllowedInZone('public_test_permit', 'MODE2')).toBe(true);
    expect(isModeAllowedInZone('depot', 'MODE2')).toBe(true);
  });

  it('blocks all movement outside an approved zone but keeps diagnostic read', () => {
    expect(isModeAllowedInZone('out_of_tod', 'MODE1')).toBe(false);
    expect(isModeAllowedInZone('out_of_tod', 'MODE2')).toBe(false);
    expect(isModeAllowedInZone('out_of_tod', 'DIAG')).toBe(true);
  });
});

describe('Heartbeat schema (ICD §3/§9)', () => {
  it('validates a healthy vehicle heartbeat', () => {
    const hb = {
      vehicleId: 'VEH-001',
      timestamp: Date.now(),
      seq: 42,
      healthy: true,
      vehicleState: 'IDLE',
      currentZone: 'public_approved_route',
      latched: false,
    };
    expect(HeartbeatSchema.safeParse(hb).success).toBe(true);
  });
});

describe('Zod Contract Validations', () => {
  it('should validate a correct E-STOP command envelope', () => {
    const validCommand = {
      commandId: '123e4567-e89b-12d3-a456-426614174000',
      // REQUIRED since M2-4-4 (SEC-06): the EDR chain correlates by this id.
      correlationId: '123e4567-e89b-12d3-a456-426614174002',
      sessionId: 'sess-123',
      vehicleId: 'VEH-001',
      issuer: 'OP-01',
      mode: 'MODE1',
      token: {
        tokenId: '123e4567-e89b-12d3-a456-426614174001',
        issuedAt: Date.now()
      },
      timestamp: Date.now(),
      ttlMs: 5000,
      payload: {
        action: 'E_STOP',
        reason: 'Obstacle detected'
      },
      // REQUIRED since M2-5 (ICD §4): Ed25519 over the canonical JSON.
      signature: 'c2lnbmF0dXJl',
    };

    const result = CommandEnvelopeSchema.safeParse(validCommand);
    expect(result.success).toBe(true);

    // ...and the SAME envelope without a signature must be refused (M2-5).
    const { signature, ...unsigned } = validCommand;
    expect(CommandEnvelopeSchema.safeParse(unsigned).success).toBe(false);
  });

  it('canonicalStringify sorts keys recursively and drops undefined (signing base)', () => {
    const a = canonicalStringify({ b: 1, a: { d: [1, 2], c: 'x' }, skip: undefined });
    expect(a).toBe('{"a":{"c":"x","d":[1,2]},"b":1}');
  });

  it('validates a zone-config document and requires its signature (M2-5, DEV-8)', () => {
    const cfg = {
      vehicleId: 'VEH-001',
      zone: 'public_test_permit',
      permit: { permitId: 'GL-2026-042', validUntil: Date.now() + 3600_000 },
      issuedAt: Date.now(),
      revision: Date.now(),
      issuer: 'ADMIN',
      signature: 'c2lnbmF0dXJl',
    };
    expect(ZoneConfigSchema.safeParse(cfg).success).toBe(true);
    const { signature, ...unsigned } = cfg;
    expect(ZoneConfigSchema.safeParse(unsigned).success).toBe(false);
  });

  it('should reject a command with missing TTL', () => {
    const invalidCommand = {
      commandId: '123e4567-e89b-12d3-a456-426614174000',
      sessionId: 'sess-123',
      vehicleId: 'VEH-001',
      issuer: 'OP-01',
      mode: 'MODE1',
      token: {
        tokenId: '123e4567-e89b-12d3-a456-426614174001',
        issuedAt: Date.now()
      },
      timestamp: Date.now(),
      // missing ttlMs
      payload: {
        action: 'E_STOP'
      }
    };

    const result = CommandEnvelopeSchema.safeParse(invalidCommand);
    expect(result.success).toBe(false);
  });

  it('should validate telemetry payload', () => {
    const validTelemetry = {
      vehicleId: 'VEH-001',
      timestamp: Date.now(),
      location: { lat: 47.3, lng: 8.5 },
      speedKmh: 15.5,
      vehicleState: 'REMOTE_DRIVE',
      mode: 'MODE1',
      battery: {
        voltageV: 400.5,
        currentA: -10.2,
        temperatureC: 35.0,
        percent: 85
      },
      sensors: [
        { id: 'CAM_FRONT', type: 'CAMERA', status: 'OK' }
      ],
      computeHealth: {
        cpuPercent: 45,
        ramPercent: 60,
        temperatureC: 65
      },
      connection: {
        rttMs: 35,
        packetLossPercent: 0,
        carrier: 'Swisscom',
        band: '5G'
      }
    };

    const result = TelemetryPayloadSchema.safeParse(validTelemetry);
    expect(result.success).toBe(true);
  });
});
