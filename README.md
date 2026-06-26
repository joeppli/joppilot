# Joppilot

Remote supervision / control and fleet-management platform for the **Jöppli** autonomous
recycling vehicles operating on public roads in Switzerland. The autonomy stack (ADS) is
**out of scope** — Joppilot is the cloud + edge supervision layer around it.

> Authoritative specs live in [`.claude/`](.claude/): the interface contract (ICD),
> software architecture (AD-1..AD-21), constraints and timeline. **Read those before
> changing behaviour** — this README only covers how to run the stack locally.

## Architecture at a glance

| Workspace | Stack | Port | Role |
|-----------|-------|------|------|
| `packages/contract` | TypeScript + Zod | — | Single source of truth for schemas → emits JSON Schema (Rust edge reads these) |
| `services/command` | NestJS + Prisma | **4000** | Cloud **Gate 1**: fencing token / lock (Valkey), EDR audit (Postgres) |
| `services/telemetry` | NestJS (raw batched pg) | **4001** | Telemetry ingest + heartbeat / link-loss tracking; WebSocket to console |
| `edge/sim` | Rust | — | Authoritative **Gate 2** (in-vehicle safety kernel) — replaces CARLA |
| `apps/console` | React + Vite | **3000** | Operator panel |
| `infra` | docker-compose | — | mosquitto (1883/9001) · postgres (5432) · valkey (6379) |

---

## Prerequisites

- **Node 18** (Node 20 is fine; pnpm's "wanted node 20" is just a warning)
- **pnpm** — `npm install -g pnpm` or `corepack enable`
  ⚠️ Use **pnpm only**. Do **not** run `npm install` in this repo — it corrupts the pnpm store.
- **Docker** + Docker Compose (for postgres / mosquitto / valkey)
- **Rust** toolchain (`rustup`, stable) for the edge simulator

---

## Quick start (fresh machine)

```bash
# 1. Clone & install all workspaces
git clone <repo-url> joppilot
cd joppilot
pnpm install

# 2. Per-service env (copy the templates — values match docker-compose)
cp services/command/.env.example   services/command/.env
cp services/telemetry/.env.example services/telemetry/.env

# 3. Infra (postgres + mosquitto + valkey)
docker compose -f infra/docker-compose.yml up -d

# 4. Build the contract first (other workspaces import it; edge reads its schemas)
pnpm --filter @joppilot/contract build      # or: cd packages/contract && pnpm build

# 5. Create the command service's Postgres tables (Prisma)
cd services/command
pnpm exec prisma generate
pnpm exec prisma db push       # creates EventDataRecord
cd ../..
# (telemetry_samples is auto-created by the telemetry service on boot — no step needed)
```

> The package name in step 4 may differ — check `packages/contract/package.json`'s `name`.
> If unsure, just `cd packages/contract && pnpm build`.

---

## Run it (4 terminals)

```bash
# Terminal 1 — Command service (Gate 1)   → http://localhost:4000
cd services/command   && pnpm build && node dist/main      # or: pnpm dev

# Terminal 2 — Telemetry service           → http://localhost:4001
cd services/telemetry && pnpm build && node dist/main      # or: pnpm dev

# Terminal 3 — Edge simulator (Gate 2, authoritative safety kernel)
cd edge/sim && EDGE_ZONE_TYPE=public_approved_route cargo run

# Terminal 4 — Operator console            → http://localhost:3000
cd apps/console && pnpm dev
```

Then open **http://localhost:3000**.

`EDGE_ZONE_TYPE` sets the vehicle's current zone (e.g. `public_approved_route`,
`out_of_tod`) and drives the Gate-2 zone/mode matrix from the ICD.

---

## Verify it works

```bash
# Edge Gate-2 smoke test — expect 10/10 pass
node services/command/test/smoke-edge.cjs

# Contract unit tests
pnpm --filter @joppilot/contract test

# Postgres tables — expect EventDataRecord + telemetry_samples (NOT TelemetryRecord)
docker exec joppilot_postgres psql -U joppilot -d joppilot_db -c "\dt"
```

---

## Notes & gotchas

- **pnpm, never npm** in this repo (store corruption).
- `packages/contract/schemas/*.json` are **committed** even though they're generated —
  the Rust edge reads them at runtime and never runs the TS build. Re-run the contract
  build after changing any Zod schema so the edge stays in sync.
- **Local MQTT** is plaintext on `1883`. The edge & services switch to **AWS IoT mTLS**
  (port 8883) only when `AWS_IOT_ENDPOINT` + the `AWS_CERT_*_PATH` cert files are set —
  certs are git-ignored, keep them out of the repo.
- Telemetry persistence uses **raw batched Postgres inserts** (architecture AD-14), not
  Prisma. Prisma lives only in `services/command` (EDR/audit).
- Default service hosts are `localhost` (broker `1883`, postgres `5432`, valkey `6379`) —
  no extra env needed for the local stack beyond the two `.env` files above.

## Useful root scripts (Turborepo)

```bash
pnpm build       # build all workspaces
pnpm dev         # run all dev tasks
pnpm test        # run all tests
pnpm typecheck   # type-check all workspaces
pnpm lint
```
