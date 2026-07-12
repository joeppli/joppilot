// =============================================================================
// telemetry-ingest Lambda — M3-4a (AD-14, RTP-02)
// =============================================================================
// IoT Rule → SQS → THIS (batched) → RDS `telemetry_samples`.
//
// Serverless persistence for the vehicle telemetry stream: the IoT Topic Rule
// forwards every message on joppilot/v1/vehicles/+/telemetry into SQS, and the
// event-source mapping delivers them here in BATCHES (the "Lambda batch" of
// timeline M3-4) — one multi-row INSERT per invoke, mirroring the ECS
// telemetry writer's raw-SQL hot path (Prisma bypassed per AD-14). With this
// in place persistence no longer needs a running Fargate task: the cloud
// telemetry service runs with TELEMETRY_PERSIST=false so rows are written
// exactly once (single-writer rule).
//
// Failure model: per-record partial batch failure (ReportBatchItemFailures) —
// a poisoned message retries alone and lands in the DLQ after maxReceiveCount;
// good rows in the same batch are never lost or double-inserted (the INSERT
// either commits for the whole filtered batch or every row is retried —
// duplicate telemetry rows are tolerable, dropped ones are not; RTP-08 keeps
// us from replaying stale data on purpose ANYWAY at the source).
//
// Runtime: nodejs22.x. AWS SDK v3 is provided by the runtime; `pg` is the only
// bundled dependency (installed by the terraform workflow via npm ci).
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import pg from 'pg';

const { Pool } = pg;

// Cold-start state: creds + pool + DDL survive across warm invokes.
let pool = null;
let schemaReady = false;

const DDL = `
  CREATE TABLE IF NOT EXISTS telemetry_samples (
    id                 BIGSERIAL PRIMARY KEY,
    vehicle_id         TEXT        NOT NULL,
    ts                 BIGINT      NOT NULL,
    lat                DOUBLE PRECISION NOT NULL,
    lng                DOUBLE PRECISION NOT NULL,
    speed_kmh          REAL        NOT NULL,
    battery_percent    REAL        NOT NULL,
    mode               TEXT        NOT NULL,
    connection_quality REAL        NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_telemetry_vehicle_ts ON telemetry_samples (vehicle_id, ts);
`;

async function getPool() {
  if (pool) return pool;
  const sm = new SecretsManagerClient({});
  const secret = await sm.send(new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN }));
  const { username, password } = JSON.parse(secret.SecretString);
  pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: username,
    password,
    max: 2, // db.t4g.micro: keep the serverless connection footprint tiny
    connectionTimeoutMillis: 5000,
    // DEV-16 (same closure trigger as the ECS writer): rds.force_ssl demands
    // TLS; server-cert verification lands with the in-VPC TLS work.
    ssl: { rejectUnauthorized: false },
  });
  return pool;
}

/** Minimal shape check — the edge already emits contract-valid payloads and
 *  the ECS ingest validates for the live path; here we only guard the INSERT
 *  (a malformed row must fail alone, not poison the batch). */
function toRow(body) {
  const p = JSON.parse(body);
  if (typeof p?.vehicleId !== 'string' || typeof p?.timestamp !== 'number'
    || typeof p?.location?.lat !== 'number' || typeof p?.location?.lng !== 'number') {
    throw new Error('telemetry payload missing required fields');
  }
  return [
    p.vehicleId,
    p.timestamp,
    p.location.lat,
    p.location.lng,
    p.speedKmh ?? 0,
    p.battery?.percent ?? 0,
    p.mode ?? 'MODE1',
    p.connection ? 100 - (p.connection.packetLossPercent ?? 0) : 0,
  ];
}

const COLS = 8;

export const handler = async (event) => {
  const failures = [];
  const rows = [];
  const rowIds = []; // messageId per row, to fail the right records on DB error

  for (const rec of event.Records ?? []) {
    try {
      rows.push(toRow(rec.body));
      rowIds.push(rec.messageId);
    } catch (e) {
      console.error(`Malformed telemetry message ${rec.messageId}: ${e.message}`);
      failures.push({ itemIdentifier: rec.messageId });
    }
  }

  if (rows.length > 0) {
    try {
      const db = await getPool();
      if (!schemaReady) {
        await db.query(DDL);
        schemaReady = true;
      }
      const values = rows.flat();
      const tuples = rows.map((_, i) => {
        const b = i * COLS;
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`;
      });
      await db.query(
        `INSERT INTO telemetry_samples
           (vehicle_id, ts, lat, lng, speed_kmh, battery_percent, mode, connection_quality)
         VALUES ${tuples.join(',')}`,
        values,
      );
      console.log(`Inserted ${rows.length} telemetry rows`);
    } catch (e) {
      // DB-level failure: retry every parsed record (SQS redrive → DLQ caps it).
      console.error(`Batched telemetry insert failed (${rows.length} rows): ${e.message}`);
      for (const id of rowIds) failures.push({ itemIdentifier: id });
    }
  }

  return { batchItemFailures: failures };
};
