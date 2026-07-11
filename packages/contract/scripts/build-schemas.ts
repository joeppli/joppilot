import fs from 'fs';
import path from 'path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  CommandEnvelopeSchema,
  TelemetryPayloadSchema,
  CommandAckSchema,
  ManeuverProposalSchema,
  ManeuverProposalStatusUpdateSchema,
  HeartbeatSchema,
  ZoneConfigSchema,
  ZONE_MODE_MATRIX,
  MODE2_ACTIONS,
  DIAG_READ_ACTIONS,
  DIAG_DISRUPTIVE_ACTIONS,
  DIAG_RESTRICTED_ZONES,
} from '../src/index';

const schemasDir = path.resolve(process.cwd(), 'schemas');

if (!fs.existsSync(schemasDir)) {
  fs.mkdirSync(schemasDir, { recursive: true });
}

function writeSchema(name: string, schema: any) {
  const jsonSchema = zodToJsonSchema(schema, name);
  const filePath = path.join(schemasDir, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(jsonSchema, null, 2));
  console.log(`Generated JSON Schema: ${filePath}`);
}

// ICD §1 matrix + §4 action classification as a GENERATED artifact: the edge
// safety kernel loads this at startup, so Gate 1 (cloud, this package) and
// Gate 2 (Rust kernel) read the same rules and cannot drift (M3-1 — closes
// the duplication warning that used to live in both files).
const policyPath = path.join(schemasDir, 'ZoneModePolicy.json');
fs.writeFileSync(policyPath, JSON.stringify({
  $comment: 'GENERATED from @joppilot/contract (ICD §1/§4) — do not edit; regenerate with: pnpm --filter @joppilot/contract build',
  zoneModeMatrix: ZONE_MODE_MATRIX,
  mode2Actions: MODE2_ACTIONS,
  diagReadActions: DIAG_READ_ACTIONS,
  diagDisruptiveActions: DIAG_DISRUPTIVE_ACTIONS,
  diagRestrictedZones: DIAG_RESTRICTED_ZONES,
}, null, 2));
console.log(`Generated zone/mode policy: ${policyPath}`);

writeSchema('CommandEnvelope', CommandEnvelopeSchema);
writeSchema('TelemetryPayload', TelemetryPayloadSchema);
writeSchema('CommandAck', CommandAckSchema);
writeSchema('ManeuverProposal', ManeuverProposalSchema);
writeSchema('ManeuverProposalStatusUpdate', ManeuverProposalStatusUpdateSchema);
writeSchema('Heartbeat', HeartbeatSchema);
writeSchema('ZoneConfig', ZoneConfigSchema);
