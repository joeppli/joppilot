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
// DUPLICATION WARNING: the edge safety kernel re-implements this matrix in
// edge/sim/src/main.rs (`mode_allowed_in_zone` / `diag_disruptive_allowed`)
// because Rust cannot import TS. If the ICD §1 matrix changes, change BOTH
// and re-run services/command/test/smoke-edge.cjs. Planned fix (M3-1): emit
// the matrix as generated JSON alongside the other schemas so the edge loads
// it at startup instead of hardcoding it.
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
export const MODE2_ACTIONS = ['STEER', 'DRIVE', 'SELECT_DIRECTION', 'CREEP', 'TURN', 'PARK'] as const;
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
export const ConfirmManeuverCommandSchema = z.object({ action: z.literal('CONFIRM_MANEUVER'), proposalId: z.string() });
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

// ------------------------------------------------------------------
// MODE 2 COMMANDS
// ------------------------------------------------------------------
export const SteerCommandSchema = z.object({ action: z.literal('STEER'), angle: z.number().min(-45).max(45) });
export const DriveCommandSchema = z.object({ action: z.literal('DRIVE'), throttle: z.number().min(0).max(100), brake: z.number().min(0).max(100) });
export const SelectDirectionCommandSchema = z.object({ action: z.literal('SELECT_DIRECTION'), direction: z.enum(['FORWARD', 'REVERSE', 'NEUTRAL']) });
export const CreepCommandSchema = z.object({ action: z.literal('CREEP'), speedKmh: z.number().min(0).max(5) });
export const TurnCommandSchema = z.object({ action: z.literal('TURN'), direction: z.enum(['LEFT', 'RIGHT', 'STRAIGHT']) });
export const ParkCommandSchema = z.object({ action: z.literal('PARK'), engage: z.boolean() });
export const LightsCommandSchema = z.object({ action: z.literal('LIGHTS'), state: z.enum(['OFF', 'LOW', 'HIGH', 'HAZARD', 'BLINK_LEFT', 'BLINK_RIGHT']) });
export const HornCommandSchema = z.object({ action: z.literal('HORN'), durationMs: z.number().max(5000) });
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
// ------------------------------------------------------------------
export const CommandPayloadSchema = z.discriminatedUnion('action', [
  SafeStopCommandSchema, EStopCommandSchema, ClearSafeStopCommandSchema, ConfirmManeuverCommandSchema, RejectManeuverCommandSchema, SelectAlternativeCommandSchema,
  StartMissionCommandSchema, PauseMissionCommandSchema, AbortMissionCommandSchema, ActivateADSCommandSchema, DeactivateADSCommandSchema, ResumeAutonomyCommandSchema,
  ConfirmPreDepartureCheckCommandSchema, IntercomCommandSchema, PersonSafetyCommandSchema, MarkCompletedCommandSchema,
  SteerCommandSchema, DriveCommandSchema, SelectDirectionCommandSchema, CreepCommandSchema, TurnCommandSchema, ParkCommandSchema, LightsCommandSchema, HornCommandSchema, SpeakerCommandSchema,
  RestartServiceCommandSchema, RestartComputerCommandSchema, RestartSensorCommandSchema, UpdateConfigCommandSchema, PullLogsCommandSchema
]);

// ------------------------------------------------------------------
// THE ENVELOPE (Sent over MQTT)
// ------------------------------------------------------------------
export const CommandEnvelopeSchema = z.object({
  commandId: z.string().uuid(),
  // TODO(M2-4): make REQUIRED. The WORM/EDR audit chain (SEC-06, LEG-04/05)
  // correlates records by this id; it needs no crypto, only discipline — Gate 1
  // must generate it when the console omits it, and every EDR row must carry it.
  correlationId: z.string().uuid().optional(),
  sessionId: z.string().min(1),
  vehicleId: z.string().min(1),
  issuer: z.string().min(1),
  mode: OperationModeSchema,
  token: FencingTokenSchema,
  timestamp: z.number().int().positive(), // UTC epoch ms
  ttlMs: z.number().int().positive(),
  payload: CommandPayloadSchema,
  // TODO(M2-5): make REQUIRED and enforced. ICD §4 mandates a signature on every
  // command; it stays optional ONLY because the local prototype has no key
  // infrastructure yet. When the command channel moves to IoT Core (X.509 mTLS,
  // M2-5), Gate 1 signs, the edge verifies against the pinned cloud key and
  // NACKs unsigned/invalid envelopes (SCHEMA_INVALID). Do NOT fake-fill this
  // field before then — a placeholder signature is worse evidence than none.
  signature: z.string().optional(),
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
// ACK / NACK
// ------------------------------------------------------------------
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
  'DIAG_DEFERRED'
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
