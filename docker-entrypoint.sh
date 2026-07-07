#!/bin/sh
# =============================================================================
# Startup for the three service images (M2-4-2).
# =============================================================================
# 1. DSN assembly (cloud posture): ECS task definitions inject the DB password
#    from the RDS-managed Secrets Manager secret as DB_USERNAME/DB_PASSWORD
#    (valueFrom JSON-key selectors) plus plain DB_HOST/DB_PORT/DB_NAME/DB_SCHEMA
#    env — never a full DSN with an embedded secret. The URL is assembled here,
#    through node's encodeURIComponent so special characters in the password
#    cannot break it. A directly provided DATABASE_URL (local dev) wins.
# 2. Schema migration: services that own a Prisma schema run
#    `prisma migrate deploy` against their OWN Postgres schema (?schema=...)
#    before the app starts. `migrate deploy` holds an advisory lock, so
#    concurrently starting tasks cannot collide; a failed migration keeps the
#    new task from starting (the rolling deploy keeps the old version alive).
#    ACCEPTED SIMPLIFICATION: the runtime identity holds DDL rights. Move to a
#    CI-driven one-off migration task when DB users are split into
#    migrate/runtime roles — at latest before real personal data (nDSG).
set -e

if [ -z "$DATABASE_URL" ] && [ -n "$DB_HOST" ]; then
  # Fail LOUDLY on a partial DB_* set: a missing DB_SCHEMA would otherwise
  # produce "?schema=undefined" and Prisma would silently create and use a
  # Postgres schema literally named "undefined". Telemetry sets DB_SCHEMA
  # too (public) even though its pg driver ignores the parameter — one
  # contract for all three images.
  DATABASE_URL="$(node -e '
    const missing = ["DB_USERNAME", "DB_PASSWORD", "DB_NAME", "DB_SCHEMA"].filter((k) => !process.env[k]);
    if (missing.length) {
      console.error(`FATAL: DB_HOST is set but ${missing.join(", ")} missing - refusing to assemble a broken DATABASE_URL`);
      process.exit(1);
    }
    const e = encodeURIComponent;
    const { DB_USERNAME, DB_PASSWORD, DB_HOST, DB_PORT = "5432", DB_NAME, DB_SCHEMA } = process.env;
    console.log(`postgresql://${e(DB_USERNAME)}:${e(DB_PASSWORD)}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=${DB_SCHEMA}`);
  ')"
  export DATABASE_URL
fi

if [ -f prisma/schema.prisma ]; then
  ./node_modules/.bin/prisma migrate deploy
fi

exec node dist/main
