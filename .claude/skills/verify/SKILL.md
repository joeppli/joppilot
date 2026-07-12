---
name: verify
description: Build, launch and drive the Joppilot local stack (3 NestJS services + Rust edge + MQTT/Postgres/Valkey infra) to verify a change end-to-end via the smoke suites and manual MQTT/HTTP probes.
---

# Verify the Joppilot stack locally

## Build & launch (order matters)

```bash
docker compose -f infra/docker-compose.yml up -d     # mosquitto 1883 · postgres 5432 · valkey 6379
pnpm build                                            # turbo: contract FIRST (schemas/*.json regenerate), then services + console

# Prisma (command + fleet): generate client, apply committed migrations
(cd services/command && pnpm exec prisma generate && pnpm exec prisma migrate deploy)
(cd services/fleet   && pnpm exec prisma generate && pnpm exec prisma migrate deploy)

# Services (each needs its .env; templates in .env.example)
(cd services/command   && nohup node dist/main > /tmp/command.log 2>&1 &)
(cd services/telemetry && nohup node dist/main > /tmp/telemetry.log 2>&1 &)
(cd services/fleet     && nohup node dist/main > /tmp/fleet.log 2>&1 &)

# Edge — rustup stable is installed since 2026-07-12 (apt rust 1.75 is too old
# for the v4 lockfile; edge/sim/target is root-owned → use CARGO_TARGET_DIR):
export PATH="$HOME/.cargo/bin:$PATH" CARGO_TARGET_DIR="$HOME/.cache/joppilot/edge-target"
(cd edge/sim && cargo build && \
  EDGE_ZONE_TYPE=public_approved_route \
  EDGE_CLOUD_PUBKEY=MtCOj41fShxsJ6haPWkaNOWXIqPp9PBRmbZ6caosNpM= \
  nohup "$CARGO_TARGET_DIR/debug/edge" > /tmp/edge.log 2>&1 &)

# Docker fallback (no rustup): rust:1-slim works, rust:1.83 is too old
# (base64ct needs edition2024).
# docker run --rm -v "$PWD":/w -w /w/edge/sim rust:1-slim cargo build
```

## Drive it

```bash
node services/command/test/smoke-edge.cjs       # 19/19 — Gate 2 (schema/signature/TTL/token/dedup/mode-spoof/latch/zone-config)
node services/command/test/smoke-drive.cjs      # 16/16 — M3-2 driving path over the actuation IPC (plays the CARLA bridge; edge only)
node services/command/test/smoke-estop.cjs      # 11/11 — M3-3 dual-message E-STOP + command_id dedup (needs command svc + edge)
node services/command/test/smoke-maneuver.cjs   # 15/15 — ICD §6 proposal flow incl. the APPROVE (CONFIRM) leg
node services/command/test/smoke-zone.cjs       # 12/12 — permit-gated zone change + delivery to the vehicle (needs edge up)
docker exec joppilot_postgres psql -U joppilot -d joppilot_db \
  -c 'DELETE FROM fleet."Mission"; DELETE FROM fleet."PreDepartureCheck";'   # fleet smoke needs clean tables
node services/fleet/test/smoke-fleet.cjs        # 25/25 — pre-departure + mission lifecycle + audit rows (needs command svc on 4000)
node services/command/test/smoke-assignment.cjs # 13/13 — needs command svc restarted with ASSIGNMENT_ENFORCEMENT=true
```

Manual probes: `POST /api/command/VEH-001/take-control` → token, then
`POST .../command` with `{operatorId, token, payload}`. EDR rows:
`psql ... -c 'SELECT * FROM "EventDataRecord" ORDER BY "createdAt" DESC LIMIT 10;'`.

## Gotchas

- **Edge watchdog latches after 3 s of cloud silence.** After any smoke test
  ends (deadman pings stop) the vehicle is LATCHED — later commands get
  `SAFE_STOP_LATCHED`. Clear with take-control + `POST .../clear-safe-stop`,
  or just restart the edge container. This is correct RES-01 behaviour, not a bug.
- Fencing-token lock TTL is 6 s — take a fresh token right before each probe.
  Re-taking control while the lock is still alive FAILS (SET NX) — long tests
  keep ONE token alive via `POST .../heartbeat` every ~2 s (also resets the
  cloud deadman, which otherwise injects its own SAFE_STOP at ~7 s).
- **The edge's newest_token is monotonic ACROSS suites** (ICD §8): smoke-edge's
  elevation test pushes it ~100 ms into the future, so a suite started
  back-to-back in the same second gets `Stale fencing token` on everything.
  Not a bug — leave ~1 s between smoke suites (or restart the edge).
- Since M2-5 every command envelope must be SIGNED: services need
  COMMAND_SIGNING_KEY (in .env.example) and the edge needs EDGE_CLOUD_PUBKEY,
  or the edge NACKs everything with SCHEMA_INVALID. Crafted test envelopes
  sign via services/command/test/sign-helper.cjs.
- Local dev DB may predate the committed migrations (P3005): baseline with
  `prisma migrate resolve --applied 20260707000000_init`, then `migrate deploy`.
- Local `.env` files may still say `?schema=public` (pre-M2-4-2); fine locally.
- Edge start location is hardcoded inside the approved rectangle
  (`is_in_approved_territory`). To exercise the geofence latch, temporarily
  patch the start coords outside (e.g. 47.40, 8.60), rebuild, observe
  "GEOFENCE VIOLATION → latched SAFE-STOP", then revert.
- Console has no headless browser harness here: `pnpm build` (tsc + rollup)
  is the only console check available; note GUI behaviour as unverified.
- Contract changes: re-run `pnpm --filter @joppilot/contract build` and commit
  regenerated `packages/contract/schemas/*.json` — the edge reads them at runtime.
