import { z } from 'zod';

export const FencingTokenSchema = z.object({
  tokenId: z.string().uuid(),
  issuedAt: z.number().int().positive() // monotonically increasing epoch ms
});

export const LocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const OperationModeSchema = z.enum(['MODE1', 'MODE2', 'DIAG']);
export const ZoneTypeSchema = z.enum([
  'public_approved_route',
  'public_test_permit',
  'depot',
  'private',
  'permitted_test',
  'out_of_tod',
]);
export const VehicleStateSchema = z.enum([
  'IDLE',
  'SUPERVISED_ASSIST',
  'REMOTE_DRIVE',
  'SAFE_STOPPED',
  'MISSION_PAUSED'
]);

// ------------------------------------------------------------------
// ZONE ↔ MODE MATRIX (ICD §1)
// `mode1` : supervision/assist allowed.
// `mode2` : direct remote driving allowed.
// `diagRead` : diagnostic read allowed (always true per ICD).
// `diagActions` : disruptive diagnostic actions (restart) allowed.
//
// SINGLE SOURCE OF TRUTH (M3-1): the build emits this matrix + the action→mode
// classification as schemas/ZoneModePolicy.json, and the edge safety kernel
// loads that file at startup (fail-closed) — the two gates can no longer
// drift. After changing the matrix or the §4 command catalogue: re-run
// `pnpm --filter @joppilot/contract build`, COMMIT the regenerated
// schemas/*.json, and re-run services/command/test/smoke-edge.cjs.
// ------------------------------------------------------------------
export interface ZonePermissions {
  mode1: boolean;
  mode2: boolean;
  diagRead: boolean;
  diagActions: boolean;
}

export const ZONE_MODE_MATRIX: Record<ZoneType, ZonePermissions> = {
  // Public, canton-approved route: supervision only, vehicle rejects Mode 2.
  public_approved_route: { mode1: true, mode2: false, diagRead: true, diagActions: true },
  // Public + valid test permit: both modes (Remote Driver / Admin) inside the permit.
  public_test_permit:    { mode1: true, mode2: true,  diagRead: true, diagActions: true },
  // Depot / private / permitted test site: both modes if authorized.
  depot:                 { mode1: true, mode2: true,  diagRead: true, diagActions: true },
  private:               { mode1: true, mode2: true,  diagRead: true, diagActions: true },
  permitted_test:        { mode1: true, mode2: true,  diagRead: true, diagActions: true },
  // Outside approved zone: no operation → safe stop; only diagnostic read (limited).
  out_of_tod:            { mode1: false, mode2: false, diagRead: true, diagActions: false },
};

// Mode classification per command action (ICD §4 command catalogue).
// LIGHTS (headlights / turn signals) is Mode-2-only: ICD §4 lists it under
// "Mode 2 — lights & signals"; the Mode 1 catalogue only grants hazard /
// warning lights (HAZARD_LIGHTS, inferred MODE1 by default below).
export const MODE2_ACTIONS = ['STEER', 'DRIVE', 'SELECT_DIRECTION', 'CREEP', 'TURN', 'PARK', 'LIGHTS'] as const;
export const DIAG_READ_ACTIONS = ['PULL_LOGS'] as const;
export const DIAG_DISRUPTIVE_ACTIONS = ['RESTART_SERVICE', 'RESTART_COMPUTER', 'RESTART_SENSOR', 'UPDATE_CONFIG'] as const;
export const DIAG_ACTIONS = [...DIAG_READ_ACTIONS, ...DIAG_DISRUPTIVE_ACTIONS] as const;

/** Derive the operation mode a command action belongs to (E-STOP/SAFE-STOP/signalling default to Mode 1, valid in both). */
export function inferMode(action: string): OperationMode {
  if ((MODE2_ACTIONS as readonly string[]).includes(action)) return 'MODE2';
  if ((DIAG_ACTIONS as readonly string[]).includes(action)) return 'DIAG';
  return 'MODE1';
}

/** Public, canton-approved route is the only zone where disruptive diagnostics are
 *  "restricted" (ICD §1 table): allowed only while the vehicle sits in a safe state.
 *  public_test_permit is a controlled test zone → "yes" (unrestricted). */
export const DIAG_RESTRICTED_ZONES: ZoneType[] = ['public_approved_route'];

export function isDiagDisruptive(action: string): boolean {
  return (DIAG_DISRUPTIVE_ACTIONS as readonly string[]).includes(action);
}

/**
 * ICD §1 footnote: restarting a sensor/computer while the vehicle is actively
 * operating on a public road creates a momentary perception/control gap, so such
 * disruptive diagnostic actions are **deferred to a safe state** (IDLE / depot /
 * maintenance). This is a *state* rule, not a pure zone rule:
 *   - out_of_tod              → never (matrix diagActions=false)
 *   - public_approved_route   → only when the vehicle is stationary/idle (restricted)
 *   - public_test_permit / depot / private / permitted_test → always (off-public or test)
 *
 * The authoritative check lives on the edge (it holds live vehicle state); the cloud
 * 1st gate, lacking live state, calls this with `isStationary=true` so it only blocks
 * the zone-impossible (out_of_tod) case and defers the state-based call to the edge.
 */
export function isDiagDisruptiveAllowed(action: string, zone: ZoneType, isStationary: boolean): boolean {
  if (!isDiagDisruptive(action)) return true;
  const p = ZONE_MODE_MATRIX[zone];
  if (!p || !p.diagActions) return false;                  // out_of_tod
  if (DIAG_RESTRICTED_ZONES.includes(zone)) return isStationary;
  return true;
}

/**
 * Authoritative zone/mode check used by BOTH gates (cloud 1st gate, edge 2nd gate).
 * DIAG is permitted wherever diagnostic read is allowed; Mode 1/2 follow the matrix.
 */
export function isModeAllowedInZone(zone: ZoneType, mode: OperationMode): boolean {
  const p = ZONE_MODE_MATRIX[zone];
  if (!p) return false;
  switch (mode) {
    case 'MODE1': return p.mode1;
    case 'MODE2': return p.mode2;
    case 'DIAG':  return p.diagRead;
    default:      return false;
  }
}

// ------------------------------------------------------------------
// MODE 1 COMMANDS
// ------------------------------------------------------------------
export const SafeStopCommandSchema = z.object({ action: z.literal('SAFE_STOP'), reason: z.string().optional() });
export const EStopCommandSchema = z.object({ action: z.literal('E_STOP'), reason: z.string().optional() });
// Authorized explicit action that releases a latched safe-stop (ICD §9).
// The latch never clears on its own (e.g. on reconnection); only this command does.
export const ClearSafeStopCommandSchema = z.object({ action: z.literal('CLEAR_SAFE_STOP'), reason: z.string().optional() });
// `optionId` names the option the approval lands on (ICD §6 approve ≠ select
// alternative: same execution, DIFFERENT evidence — the EDR must show whether
// the operator approved the ADS's proposed maneuver or picked another). The
// edge already resolves CONFIRM via payload.optionId when present.
export const ConfirmManeuverCommandSchema = z.object({ action: z.literal('CONFIRM_MANEUVER'), proposalId: z.string(), optionId: z.string().optional() });
export const RejectManeuverCommandSchema = z.object({ action: z.literal('REJECT_MANEUVER'), proposalId: z.string() });
export const SelectAlternativeCommandSchema = z.object({ action: z.literal('SELECT_ALTERNATIVE'), proposalId: z.string(), optionId: z.string() });

export const StartMissionCommandSchema = z.object({ action: z.literal('START_MISSION'), routeId: z.string().optional() });
export const PauseMissionCommandSchema = z.object({ action: z.literal('PAUSE_MISSION') });
export const AbortMissionCommandSchema = z.object({ action: z.literal('ABORT_MISSION') });

export const ActivateADSCommandSchema = z.object({ action: z.literal('ACTIVATE_ADS') });
export const DeactivateADSCommandSchema = z.object({ action: z.literal('DEACTIVATE_ADS') });
export const ResumeAutonomyCommandSchema = z.object({ action: z.literal('RESUME_AUTONOMY') });

export const ConfirmPreDepartureCheckCommandSchema = z.object({ action: z.literal('CONFIRM_PRE_DEPARTURE_CHECK'), checklistId: z.string() });
export const IntercomCommandSchema = z.object({ action: z.literal('INTERCOM'), state: z.enum(['OPEN', 'CLOSE']) });
export const PersonSafetyCommandSchema = z.object({ action: z.literal('PERSON_SAFETY'), actionType: z.enum(['WARN_AWAY', 'LOCK_COMPARTMENT']) });
export const MarkCompletedCommandSchema = z.object({ action: z.literal('MARK_COMPLETED'), stopId: z.string() });
// ICD §4 Mode 1 "signaling & environment alert": hazard / warning lights.
// Deliberately a SEPARATE action from the Mode 2 LIGHTS command — headlights
// and turn signals are Mode-2-only (the ADS signals for itself on a public
// route), hazards are a supervision capability valid in any operating zone.
export const HazardLightsCommandSchema = z.object({ action: z.literal('HAZARD_LIGHTS'), on: z.boolean() });

// ------------------------------------------------------------------
// MODE 2 COMMANDS
// ------------------------------------------------------------------
export const SteerCommandSchema = z.object({ action: z.literal('STEER'), angle: z.number().min(-45).max(45) });
export const DriveCommandSchema = z.object({ action: z.literal('DRIVE'), throttle: z.number().min(0).max(100), brake: z.number().min(0).max(100) });
export const SelectDirectionCommandSchema = z.object({ action: z.literal('SELECT_DIRECTION'), direction: z.enum(['FORWARD', 'REVERSE', 'NEUTRAL']) });
export const CreepCommandSchema = z.object({ action: z.literal('CREEP'), speedKmh: z.number().min(0).max(5) });
export const TurnCommandSchema = z.object({ action: z.literal('TURN'), direction: z.enum(['LEFT', 'RIGHT', 'STRAIGHT']) });
export const ParkCommandSchema = z.object({ action: z.literal('PARK'), engage: z.boolean() });
// ICD §4 splits lights across the two catalogues: hazard/warning lights are a
// Mode 1 "signaling & environment alert" capability (HAZARD_LIGHTS above),
// while headlights and turn signals exist ONLY in the Mode 2 "lights &
// signals" catalogue — on a public route the ADS owns them, so LIGHTS is a
// MODE2 action (see MODE2_ACTIONS) and both gates refuse it outside a
// Mode-2-capable zone.
export const LightsCommandSchema = z.object({ action: z.literal('LIGHTS'), state: z.enum(['OFF', 'LOW', 'HIGH', 'BLINK_LEFT', 'BLINK_RIGHT']) });
export const HornCommandSchema = z.object({ action: z.literal('HORN'), durationMs: z.number().int().min(0).max(5000) });
export const SpeakerCommandSchema = z.object({ action: z.literal('SPEAKER'), message: z.string() });

// ------------------------------------------------------------------
// DIAGNOSTICS
// ------------------------------------------------------------------
export const RestartServiceCommandSchema = z.object({ action: z.literal('RESTART_SERVICE'), serviceName: z.string() });
export const RestartComputerCommandSchema = z.object({ action: z.literal('RESTART_COMPUTER'), target: z.string() });
export const RestartSensorCommandSchema = z.object({ action: z.literal('RESTART_SENSOR'), sensorId: z.string() });
export const UpdateConfigCommandSchema = z.object({ action: z.literal('UPDATE_CONFIG'), configKey: z.string(), configValue: z.string() });
export const PullLogsCommandSchema = z.object({ action: z.literal('PULL_LOGS'), timeRangeMs: z.number() });

// ------------------------------------------------------------------
// THE DISCRIMINATED UNION OF ALL COMMANDS
//
// DEV-22 (architecture register): the ICD §4 Mode 1 mission/fleet extras —
// skip next stop · return to depot · send to charging station · route to
// specific location · acknowledge/clear warning — are NOT in this catalogue
// yet. They presuppose the Dispatch service (AD-15 sequencing) and the ADS
// route/stop feed (OP-9), neither of which exists; ICD §4 itself is marked
// for expansion. Add them WITH that work, not as dead schema entries.
// ------------------------------------------------------------------
export const CommandPayloadSchema = z.discriminatedUnion('action', [
  SafeStopCommandSchema, EStopCommandSchema, ClearSafeStopCommandSchema, ConfirmManeuverCommandSchema, RejectManeuverCommandSchema, SelectAlternativeCommandSchema,
  StartMissionCommandSchema, PauseMissionCommandSchema, AbortMissionCommandSchema, ActivateADSCommandSchema, DeactivateADSCommandSchema, ResumeAutonomyCommandSchema,
  ConfirmPreDepartureCheckCommandSchema, IntercomCommandSchema, PersonSafetyCommandSchema, MarkCompletedCommandSchema, HazardLightsCommandSchema,
  SteerCommandSchema, DriveCommandSchema, SelectDirectionCommandSchema, CreepCommandSchema, TurnCommandSchema, ParkCommandSchema, LightsCommandSchema, HornCommandSchema, SpeakerCommandSchema,
  RestartServiceCommandSchema, RestartComputerCommandSchema, RestartSensorCommandSchema, UpdateConfigCommandSchema, PullLogsCommandSchema
]);

// ------------------------------------------------------------------
// THE ENVELOPE (Sent over MQTT)
// ------------------------------------------------------------------
export const CommandEnvelopeSchema = z.object({
  commandId: z.string().uuid(),
  // REQUIRED since M2-4 (SEC-06): the EDR audit chain correlates records by
  // this id. Gate 1 generates it when the console omits it; every EDR row
  // carries it; the edge NACKs an envelope without one (SCHEMA_INVALID).
  correlationId: z.string().uuid(),
  sessionId: z.string().min(1),
  vehicleId: z.string().min(1),
  issuer: z.string().min(1),
  mode: OperationModeSchema,
  token: FencingTokenSchema,
  timestamp: z.number().int().positive(), // UTC epoch ms
  ttlMs: z.number().int().positive(),
  payload: CommandPayloadSchema,
  // REQUIRED since M2-5 (ICD §4). Ed25519 over the CANONICAL JSON of the
  // envelope WITHOUT this field (see canonicalStringify): Gate 1 signs with
  // the cloud private key, the vehicle verifies against its pinned public
  // key and NACKs unsigned/invalid envelopes (SCHEMA_INVALID). The vehicle
  // holds only the PUBLIC key — no signing secret ever rides on the vehicle
  // (SEC-08 spirit). base64, 64-byte Ed25519 signature.
  signature: z.string().min(1),
});

/**
 * Canonical JSON for signing (M2-5): object keys sorted recursively, no
 * whitespace. Both signer (cloud, this function) and verifier (Rust edge,
 * serde_json::Value with its default sorted BTreeMap) re-serialize the SAME
 * parsed value, so key order and number formatting agree as long as payloads
 * stay within plain JSON (shortest-roundtrip numbers, no exotic strings) —
 * which the Zod schemas above already guarantee.
 */
export function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// ------------------------------------------------------------------
// ZONE CONFIGURATION DELIVERY (ICD §1, M2-5 — closes DEV-8)
// The cloud distributes the vehicle's zone type (and, for a public test
// permit, the permit context) TO the vehicle: retained MQTT topic locally,
// the `zone-config` named Device Shadow on AWS IoT. The document is SIGNED
// with the same cloud key as commands — zone config decides whether Mode 2
// is possible, so it gets the same integrity protection; `revision` is
// monotonic per vehicle so a replayed older config can never downgrade the
// vehicle to a more permissive zone. The edge stays fail-safe: an absent,
// unverifiable or stale document leaves it on its stricter local default.
// ------------------------------------------------------------------
export const ZonePermitConfigSchema = z.object({
  permitId: z.string().min(1),
  // Validity window end (epoch ms). The edge reverts to the safe default the
  // moment it lapses — enforced on the vehicle, independent of the cloud.
  validUntil: z.number().int().positive(),
  // M3-5: BOTH enforced on the vehicle (ICD §1 permit conditions) — before
  // validFrom the permissive zone is not yet active (edge stays on the safe
  // default), and Mode 2 commands above speedLimitKmh are NACKed
  // (PERMIT_SPEED_LIMIT) while the internal sim clamps its road speed.
  validFrom: z.number().int().positive().optional(),
  speedLimitKmh: z.number().positive().optional(),
});

export const ZoneConfigSchema = z.object({
  vehicleId: z.string().min(1),
  zone: ZoneTypeSchema,
  permit: ZonePermitConfigSchema.optional(),
  issuedAt: z.number().int().positive(), // epoch ms
  revision: z.number().int().positive(), // monotonic per vehicle (anti-replay)
  issuer: z.string().min(1),
  // Ed25519 over canonicalStringify(config without `signature`), base64.
  signature: z.string().min(1),
});

// ------------------------------------------------------------------
// MANEUVER PROPOSAL (Mode 1, ICD §6)
// ------------------------------------------------------------------
export const ManeuverOptionSchema = z.object({
  optionId: z.string(),
  description: z.string(),
  expectedResult: z.string()
});

export const ManeuverProposalSchema = z.object({
  proposalId: z.string().uuid(),
  vehicleId: z.string(),
  reasonCode: z.string(),
  context: z.object({
    sceneSummary: z.string(),
    sensorRefs: z.array(z.string())
  }),
  options: z.array(ManeuverOptionSchema).min(1),
  validityWindowMs: z.number().int().positive(),
  defaultOnTimeout: z.string(),
  timestamp: z.number().int().positive(),
});

export const ManeuverProposalStatusSchema = z.enum([
  'PENDING',
  'DECIDED',
  'TIMED_OUT',
  'CANCELLED',
]);

export const ManeuverProposalStatusUpdateSchema = z.object({
  proposalId: z.string().uuid(),
  vehicleId: z.string(),
  status: ManeuverProposalStatusSchema,
  selectedOptionId: z.string().optional(),
  timestamp: z.number().int().positive(),
});

// ------------------------------------------------------------------
// TELEMETRY
// ------------------------------------------------------------------
export const MotorTelemetrySchema = z.object({
  rpm: z.number(),
  temperatureC: z.number()
});

export const BatteryTelemetrySchema = z.object({
  voltageV: z.number(),
  currentA: z.number(),
  temperatureC: z.number(),
  percent: z.number().min(0).max(100)
});

export const SensorStatusSchema = z.object({
  id: z.string(),
  type: z.enum(['CAMERA', 'LIDAR', 'ULTRASONIC', 'RADAR']),
  status: z.enum(['OK', 'DEGRADED', 'FAULT'])
});

export const ComputeHealthSchema = z.object({
  cpuPercent: z.number().min(0).max(100),
  ramPercent: z.number().min(0).max(100),
  temperatureC: z.number()
});

export const ConnectionQualitySchema = z.object({
  rttMs: z.number(),
  packetLossPercent: z.number().min(0).max(100),
  carrier: z.string(),
  band: z.string()
});

export const VehicleStateVectorSchema = z.object({
  accelerationX: z.number(),
  accelerationY: z.number(),
  accelerationZ: z.number(),
  yawRate: z.number()
});

export const TelemetryPayloadSchema = z.object({
  vehicleId: z.string().min(1),
  timestamp: z.number().int().positive(),
  location: LocationSchema,
  speedKmh: z.number().min(0).max(200),
  vehicleState: VehicleStateSchema,
  mode: OperationModeSchema,
  
  battery: BatteryTelemetrySchema,
  motor: MotorTelemetrySchema.optional(),
  sensors: z.array(SensorStatusSchema),
  computeHealth: ComputeHealthSchema,
  connection: ConnectionQualitySchema,
  stateVector: VehicleStateVectorSchema.optional(),

  activeFencingToken: FencingTokenSchema.optional(),
  currentZone: ZoneTypeSchema.optional(),
  dtc: z.array(z.string()).optional(),
});

// ------------------------------------------------------------------
// PRE-DEPARTURE CHECK (ICD §7, LEG-03)
// OAD-mandated checklist: brakes, steering, tires, lights, self-diagnosis.
// ------------------------------------------------------------------
export const CheckItemStatusSchema = z.enum(['PASS', 'FAIL', 'PENDING', 'NOT_APPLICABLE']);
export const CheckSourceSchema = z.enum(['SELF_DIAGNOSIS', 'OPERATOR']);

export const CheckItemSchema = z.object({
  itemId: z.string(),
  label: z.string(),
  category: z.enum(['BRAKES', 'STEERING', 'TIRES', 'LIGHTS', 'PERCEPTION', 'PROPULSION', 'CONNECTIVITY', 'OTHER']),
  safetyCritical: z.boolean(),
  source: CheckSourceSchema,
  status: CheckItemStatusSchema,
  detail: z.string().optional(),
});

export const PreDepartureCheckSchema = z.object({
  checklistId: z.string().uuid(),
  vehicleId: z.string(),
  items: z.array(CheckItemSchema),
  status: z.enum(['IN_PROGRESS', 'PASSED', 'FAILED', 'CONFIRMED']),
  createdAt: z.number().int().positive(),
  confirmedAt: z.number().int().positive().optional(),
  confirmedBy: z.string().optional(),
});

// ------------------------------------------------------------------
// MISSION (Fleet & Mission service)
// ------------------------------------------------------------------
export const MissionStatusSchema = z.enum([
  'PENDING',
  'PRE_CHECK',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'ABORTED',
]);

export const MissionSchema = z.object({
  missionId: z.string().uuid(),
  vehicleId: z.string(),
  routeId: z.string().optional(),
  status: MissionStatusSchema,
  createdAt: z.number().int().positive(),
  startedAt: z.number().int().positive().optional(),
  completedAt: z.number().int().positive().optional(),
  checklistId: z.string().uuid().optional(),
});

// ------------------------------------------------------------------
// HEARTBEAT (Vehicle → Cloud, ICD §3/§9)
// "I'm here, I'm healthy" signal that feeds the cloud-side safe-mode decision.
// Distinct from the operator deadman (cloud → vehicle).
// ------------------------------------------------------------------
export const HeartbeatSchema = z.object({
  vehicleId: z.string().min(1),
  timestamp: z.number().int().positive(), // UTC epoch ms
  seq: z.number().int().nonnegative(),    // monotonic; lets cloud detect loss over windows
  healthy: z.boolean(),
  vehicleState: VehicleStateSchema,
  currentZone: ZoneTypeSchema.optional(),
  latched: z.boolean().optional(),        // true while a safe-stop latch is engaged
});

// ------------------------------------------------------------------
// EDGE EVENT LOG SYNC (RES-02 / LEG-04, M3-6)
// The vehicle records safety-relevant events LOCALLY (works with zero
// connectivity) and uploads them losslessly once the link returns:
// vehicle → joppilot/v1/vehicles/{id}/logsync (QoS1 batches). `seq` is
// strictly monotonic per vehicle boot — the cloud dedups on (vehicleId,
// seq) since QoS1 is at-least-once, and can flag gaps.
// ------------------------------------------------------------------
export const EdgeLogEventTypeSchema = z.enum([
  'LATCH_ENGAGED',    // details.trigger: WATCHDOG | GEOFENCE | POSE_SILENCE | E_STOP | SAFE_STOP
  'LATCH_RELEASED',   // authorized CLEAR_SAFE_STOP (ICD §9)
  'ZONE_CONFIG_APPLIED',
]);

export const EdgeLogEventSchema = z.object({
  vehicleId: z.string().min(1),
  // seq restarts at 1 on every kernel boot — bootId disambiguates, so the
  // cloud dedup key (vehicleId, bootId, seq) survives restarts.
  bootId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  timestamp: z.number().int().positive(), // ms, VEHICLE clock at event time
  type: EdgeLogEventTypeSchema,
  details: z.record(z.string(), z.unknown()).optional(),
});

export const EdgeLogBatchSchema = z.object({
  vehicleId: z.string().min(1),
  events: z.array(EdgeLogEventSchema).min(1).max(100),
});

// The cloud confirms a synced batch on .../logsync/ack with a SIGNED document
// (audit-9). Both hardenings protect the on-vehicle evidence buffer (LEG-04):
//   - `bootId` scoping: the edge only trims events when the ack names ITS OWN
//     boot — a stale ack from a previous boot (kernel restarted while a batch
//     was in flight) can no longer discard the new boot's unsynced events,
//     which would silently break the RES-02 "lossless" guarantee.
//   - the Ed25519 signature (same cloud key as commands): a spoofed ack must
//     not be able to make the vehicle destroy evidence it never synced.
export const EdgeLogSyncAckSchema = z.object({
  vehicleId: z.string().min(1),
  bootId: z.string().min(1),
  upTo: z.number().int().nonnegative(), // highest confirmed seq of that boot
  // Ed25519 over canonicalStringify(ack without `signature`), base64.
  signature: z.string().min(1),
});

// Cloud → vehicle operator-liveness ping (the "deadman", ICD §9). This is the
// ONE input that keeps the vehicle's local watchdog from latching, so it gets
// the same integrity protection as commands (audit-9; ICD §1: the link "can
// drop, be delayed, or be spoofed"): signed with the cloud key, addressed to
// one vehicle, and timestamped — the edge additionally requires the timestamp
// to be fresh and strictly increasing, so a captured ping cannot be replayed
// to keep a vehicle out of safe mode after the operator session is gone.
export const DeadmanPingSchema = z.object({
  vehicleId: z.string().min(1),
  timestamp: z.number().int().positive(), // UTC epoch ms, cloud clock
  // Ed25519 over canonicalStringify(ping without `signature`), base64.
  signature: z.string().min(1),
});
export const AckStatusSchema = z.enum(['ACK', 'REJECTED', 'ERROR']);
export const RejectReasonSchema = z.enum([
  'UNAUTHORIZED',
  'INVALID_TOKEN',
  'GEOFENCE_VIOLATION',
  'SCHEMA_INVALID',
  'TTL_EXPIRED',
  'VEHICLE_HEALTH_ERROR',
  'MODE_MISMATCH',
  'DUPLICATE_COMMAND',
  'SAFE_STOP_LATCHED',
  'DIAG_DEFERRED',
  // M3-5 (ICD §1 permit conditions): a Mode 2 command requesting a speed
  // above the zone permit's speedLimitKmh is refused ON THE VEHICLE.
  'PERMIT_SPEED_LIMIT'
]);

export const CommandAckSchema = z.object({
  commandId: z.string().uuid(),
  status: AckStatusSchema,
  reason: RejectReasonSchema.optional(),
  details: z.string().optional(),
});

// ------------------------------------------------------------------
// EXPORT TYPES
// ------------------------------------------------------------------
export type FencingToken = z.infer<typeof FencingTokenSchema>;
export type Location = z.infer<typeof LocationSchema>;
export type OperationMode = z.infer<typeof OperationModeSchema>;
export type ZoneType = z.infer<typeof ZoneTypeSchema>;
export type VehicleState = z.infer<typeof VehicleStateSchema>;
export type CommandPayload = z.infer<typeof CommandPayloadSchema>;
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;
export type ManeuverProposal = z.infer<typeof ManeuverProposalSchema>;
export type ManeuverProposalStatus = z.infer<typeof ManeuverProposalStatusSchema>;
export type ManeuverProposalStatusUpdate = z.infer<typeof ManeuverProposalStatusUpdateSchema>;
export type TelemetryPayload = z.infer<typeof TelemetryPayloadSchema>;
export type Heartbeat = z.infer<typeof HeartbeatSchema>;
export type CommandAck = z.infer<typeof CommandAckSchema>;
export type RejectReason = z.infer<typeof RejectReasonSchema>;
export type CheckItem = z.infer<typeof CheckItemSchema>;
export type CheckItemStatus = z.infer<typeof CheckItemStatusSchema>;
export type PreDepartureCheck = z.infer<typeof PreDepartureCheckSchema>;
export type MissionStatus = z.infer<typeof MissionStatusSchema>;
export type Mission = z.infer<typeof MissionSchema>;
export type ZonePermitConfig = z.infer<typeof ZonePermitConfigSchema>;
export type ZoneConfig = z.infer<typeof ZoneConfigSchema>;
export type EdgeLogEvent = z.infer<typeof EdgeLogEventSchema>;
export type EdgeLogBatch = z.infer<typeof EdgeLogBatchSchema>;
export type EdgeLogSyncAck = z.infer<typeof EdgeLogSyncAckSchema>;
export type DeadmanPing = z.infer<typeof DeadmanPingSchema>;
