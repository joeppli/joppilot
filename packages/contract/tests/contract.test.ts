import { describe, it, expect } from 'vitest';
import {
  CommandEnvelopeSchema,
  TelemetryPayloadSchema,
  HeartbeatSchema,
  isModeAllowedInZone,
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
      }
    };

    const result = CommandEnvelopeSchema.safeParse(validCommand);
    expect(result.success).toBe(true);
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
