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

  private static readonly FLUSH_INTERVAL_MS = 1000;
  private static readonly FLUSH_THRESHOLD = 200; // flush early if buffer fills
  private static readonly COLS = 8;              // bound params per row (created_at uses default)

  async onModuleInit() {
    this.pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
    await this.ensureSchema();
    this.flushTimer = setInterval(() => void this.flush(), TelemetryWriterService.FLUSH_INTERVAL_MS);
    this.logger.log('Telemetry raw writer ready (batched inserts, ORM bypassed)');
  }

  async onModuleDestroy() {
    if (this.flushTimer) clearInterval(this.flushTimer);
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
