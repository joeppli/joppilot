import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { TelemetryPayload } from '@joppilot/contract';

/**
 * Telemetry hot-path persistence (Architecture AD-14 / RTP-02/03).
 *
 * High-frequency telemetry writes BYPASS the ORM: rows are buffered and flushed
 * as a single multi-row parameterised INSERT via raw SQL (node-postgres), not
 * Prisma .create() per row. In production the table is range-partitioned by time
 * (pg_partman); here we keep a plain table created via raw DDL on boot.
 */
@Injectable()
export class TelemetryWriterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelemetryWriterService.name);
  private pool!: Pool;
  private buffer: TelemetryPayload[] = [];
  private flushTimer?: NodeJS.Timeout;
  private retryTimer?: NodeJS.Timeout;
  // False until the schema is confirmed. While false, incoming samples are
  // DROPPED, not buffered: real-time data is never held back and replayed
  // later (RTP-08) — a stale telemetry backlog is worthless and unbounded.
  private ready = false;
  private dropWarned = false;
  // M3-4a single-writer rule: in the cloud, persistence belongs to the
  // IoT Rules → SQS → Lambda pipeline; the task runs TELEMETRY_PERSIST=false
  // and keeps only the live broadcast + link-loss. Local dev (no IoT Rules)
  // leaves this true and the writer behaves exactly as before.
  private readonly persistEnabled = process.env.TELEMETRY_PERSIST !== 'false';

  private static readonly FLUSH_INTERVAL_MS = 1000;
  private static readonly FLUSH_THRESHOLD = 200; // flush early if buffer fills
  private static readonly COLS = 8;              // bound params per row (created_at uses default)
  private static readonly RETRY_MS = 5000;

  async onModuleInit() {
    if (!this.persistEnabled) {
      this.logger.log('TELEMETRY_PERSIST=false — persistence owned by the IoT Rules → Lambda pipeline (M3-4a); writer inactive.');
      return;
    }
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 4,
      // Never hang bootstrap on an unreachable DB (pg's default is "wait forever").
      connectionTimeoutMillis: 5000,
      // DB_SSL=true (cloud task env): RDS PostgreSQL 15+ ships rds.force_ssl=1,
      // and raw node-postgres does NOT negotiate TLS on its own (Prisma does,
      // which is why command/fleet were unaffected). DEV-16: the server cert is
      // not verified yet — same in-VPC trust boundary and closure trigger as
      // DEV-2 (in-VPC TLS work in the CloudFront/custom-domain phase).
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    });

    // FAIL-SOFT boot: the service comes up (and /healthz answers) even when
    // the DB is not reachable yet; the writer keeps retrying in the
    // background and logs LOUDLY — a dying task with an empty log taught us
    // (M2-4-3) that a silent boot failure is the worst failure mode.
    await this.tryEnsureSchema();
    if (!this.ready) {
      this.retryTimer = setInterval(() => void this.tryEnsureSchema(), TelemetryWriterService.RETRY_MS);
    }
    this.flushTimer = setInterval(() => void this.flush(), TelemetryWriterService.FLUSH_INTERVAL_MS);
  }

  private async tryEnsureSchema() {
    try {
      await this.ensureSchema();
      this.ready = true;
      if (this.retryTimer) { clearInterval(this.retryTimer); this.retryTimer = undefined; }
      this.logger.log('Telemetry raw writer ready (batched inserts, ORM bypassed)');
    } catch (e) {
      this.logger.error(
        `Telemetry writer DB not ready (retrying every ${TelemetryWriterService.RETRY_MS} ms): ${(e as Error).message}`,
      );
    }
  }

  async onModuleDestroy() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.retryTimer) clearInterval(this.retryTimer);
    await this.flush();
    await this.pool?.end();
  }

  private async ensureSchema() {
    await this.pool.query(`
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
    `);
  }

  enqueue(payload: TelemetryPayload) {
    if (!this.persistEnabled) return; // pipeline owns persistence (M3-4a)
    if (!this.ready) {
      // RTP-08: drop, don't backlog. Live consoles still get the broadcast.
      if (!this.dropWarned) {
        this.dropWarned = true;
        this.logger.warn('Dropping telemetry samples until the DB is ready (RTP-08: no buffer-and-replay).');
      }
      return;
    }
    this.buffer.push(payload);
    if (this.buffer.length >= TelemetryWriterService.FLUSH_THRESHOLD) {
      void this.flush();
    }
  }

  private async flush() {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];

    const { COLS } = TelemetryWriterService;
    const values: unknown[] = [];
    const tuples = batch.map((p, i) => {
      const b = i * COLS;
      values.push(
        p.vehicleId,
        p.timestamp,
        p.location.lat,
        p.location.lng,
        p.speedKmh,
        p.battery?.percent ?? 0,
        p.mode,
        p.connection ? 100 - p.connection.packetLossPercent : 0,
      );
      // 8 bound params + created_at default
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`;
    });

    const sql =
      `INSERT INTO telemetry_samples
        (vehicle_id, ts, lat, lng, speed_kmh, battery_percent, mode, connection_quality)
       VALUES ${tuples.join(',')}`;

    try {
      await this.pool.query(sql, values);
    } catch (e) {
      this.logger.error(`Batched telemetry insert failed (${batch.length} rows)`, e as Error);
    }
  }
}
