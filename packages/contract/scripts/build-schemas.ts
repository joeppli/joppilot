import fs from 'fs';
import path from 'path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  CommandEnvelopeSchema,
  TelemetryPayloadSchema,
  CommandAckSchema,
  ManeuverProposalSchema,
  HeartbeatSchema
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

writeSchema('CommandEnvelope', CommandEnvelopeSchema);
writeSchema('TelemetryPayload', TelemetryPayloadSchema);
writeSchema('CommandAck', CommandAckSchema);
writeSchema('ManeuverProposal', ManeuverProposalSchema);
writeSchema('Heartbeat', HeartbeatSchema);
