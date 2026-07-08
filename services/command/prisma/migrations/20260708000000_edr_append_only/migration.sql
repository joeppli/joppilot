-- Append-only EDR (LEG-04/SEC-06): status transitions become NEW rows, so
-- commandId is a correlation key, not unique. Keep it indexed for lookups.
--
-- The uniqueness exists as a plain UNIQUE INDEX on databases created from the
-- committed init migration, but as a table CONSTRAINT on dev databases that
-- predate the migration history (created via `prisma db push`). Handle both.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE c.conname = 'EventDataRecord_commandId_key'
      AND t.relname = 'EventDataRecord'
      AND n.nspname = current_schema()
  ) THEN
    ALTER TABLE "EventDataRecord" DROP CONSTRAINT "EventDataRecord_commandId_key";
  ELSIF EXISTS (
    SELECT 1
    FROM pg_class i
    JOIN pg_namespace n ON i.relnamespace = n.oid
    WHERE i.relname = 'EventDataRecord_commandId_key'
      AND i.relkind = 'i'
      AND n.nspname = current_schema()
  ) THEN
    DROP INDEX "EventDataRecord_commandId_key";
  END IF;
END $$;

-- CreateIndex
CREATE INDEX "EventDataRecord_commandId_idx" ON "EventDataRecord"("commandId");
