# syntax=docker/dockerfile:1
# =============================================================================
# One parameterized image for the three NestJS services (M2-4-1).
#   docker build --build-arg SERVICE=command|telemetry|fleet -t <tag> .
# Build context = repo root (pnpm monorepo). Multi-stage: the builder installs
# the workspace, builds @joppilot/contract + the service, generates the Prisma
# client where the service has one, then `pnpm deploy`s a self-contained
# production bundle that the slim runtime stage copies. Ports: command 4000,
# telemetry 4001, fleet 4002 (fixed in each service's main.ts).
# =============================================================================

FROM node:22-alpine AS build
ARG SERVICE
# openssl: lets Prisma's engine detection see the runtime's OpenSSL 3 during
# `prisma generate` (the schemas also pin binaryTargets — belt and suspenders).
RUN apk add --no-cache openssl && npm install -g pnpm@11
WORKDIR /repo

# Manifests first — the dependency-install layer caches until one changes.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.json tsconfig.base.json ./
COPY packages/contract/package.json packages/contract/
COPY services/command/package.json services/command/
COPY services/telemetry/package.json services/telemetry/
COPY services/fleet/package.json services/fleet/
# The console is a workspace importer in the lockfile; its MANIFEST (not its
# code) must be present for a frozen-lockfile install to validate.
COPY apps/console/package.json apps/console/
RUN pnpm install --frozen-lockfile

COPY packages ./packages
COPY services ./services

# Contract first (the services import it; its build also emits the JSON schemas).
RUN pnpm --filter @joppilot/contract build
# Prisma client for command/fleet; telemetry uses raw pg and has no schema.
# Generating INSIDE this alpine stage picks the linux-musl engine that matches
# the runtime image below.
RUN if [ -d "services/${SERVICE}/prisma" ]; then cd "services/${SERVICE}" && pnpm exec prisma generate; fi
RUN pnpm --filter "@joppilot/service-${SERVICE}" build
# Self-contained production bundle: dist/ + generated/ + pruned node_modules.
RUN pnpm --filter "@joppilot/service-${SERVICE}" deploy --legacy --prod /out

FROM node:22-alpine
# Prisma's query engine links against OpenSSL at runtime.
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
# Startup script: assembles DATABASE_URL from DB_* env if needed, then runs
# `prisma migrate deploy` (services with a Prisma schema) before the app.
COPY --chmod=0755 docker-entrypoint.sh /app/docker-entrypoint.sh
USER node
ENTRYPOINT ["/app/docker-entrypoint.sh"]
