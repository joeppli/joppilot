# Joppilot

Remote supervision / control and fleet-management platform for the **Jöppli** autonomous
recycling vehicles operating on public roads in Switzerland. The autonomy stack (ADS) is
**out of scope** — Joppilot is the cloud + edge supervision layer around it.

> Authoritative specs live in [`.claude/`](.claude/): the interface contract (ICD),
> software architecture (AD-1..AD-21), constraints and timeline. **Read those before
> changing behaviour** — this README covers running the stack **locally** and the
> deployed **AWS (M2)** environment (see [Cloud (AWS) — M2](#cloud-aws--m2-migration)).

## Architecture at a glance

| Workspace | Stack | Port | Role |
|-----------|-------|------|------|
| `packages/contract` | TypeScript + Zod | — | Single source of truth for schemas → emits JSON Schema (Rust edge reads these) |
| `services/command` | NestJS + Prisma | **4000** | Cloud **Gate 1**: fencing token / lock (Valkey), EDR audit (Postgres), maneuver-proposal decisions (ICD §6), handover |
| `services/telemetry` | NestJS (raw batched pg) | **4001** | Telemetry ingest + heartbeat / link-loss tracking; WebSocket to console |
| `services/fleet` | NestJS + Prisma | **4002** | Pre-departure check (OAD / LEG-03) + mission lifecycle |
| `edge/sim` | Rust | — | Authoritative **Gate 2** (in-vehicle safety kernel) + maneuver-proposal generator — replaces CARLA |
| `apps/console` | React + Vite | **3000** | Operator panel — MapLibre + swisstopo map, maneuver card, mission/checklist UI |
| `infra` | docker-compose | — | mosquitto (1883/9001) · postgres (5432) · valkey (6379) |

### Implemented so far (all per ICD / architecture, smoke-tested)

- **Two-gate command path** — cloud Gate 1 (Zod + zone/mode filter + fencing token) → MQTT → edge Gate 2 (JSON-Schema validation, TTL, monotonic token, idempotency/dedup, zone-mode matrix).
- **Latched safe-stop & local watchdog** (RES-01/04) — 3 s cloud silence → autonomous safe-stop latch; only `CLEAR_SAFE_STOP` releases it.
- **Maneuver proposal flow** (ICD §6) — edge generates a proposal → cloud `Maneuver` service + decision window → console card → operator decision returns as a regular Mode 1 command; timeout → safe default (edge authoritative).
- **Pre-departure check** (ICD §7 / LEG-03) — OAD checklist (self-diagnosis auto-pass + operator verification), safety-critical fail blocks confirmation, mission cannot start unconfirmed.
- **Mission lifecycle** — `PENDING → PRE_CHECK → ACTIVE → PAUSED → COMPLETED / ABORTED`.
- **Disruptive-diagnostic deferral** (ICD §1 footnote) — `RESTART_*` / `UPDATE_CONFIG` deferred on a public approved route unless the vehicle is stationary; edge enforces it from live road speed.
- **Single-operator lock + handover** (ICD §8 / SEC-05) — fencing token in Valkey; a handover elevates the token so the previous operator's commands are rejected on the vehicle.
- **Permit-gated zone change** (ICD §1) — controlled + logged, not an instant override: opening Mode 2 on a public route (→ `public_test_permit`) requires a cantonal permit (`permitId` + validity window); the zone reverts to the safe default when the permit lapses.
- **Live map** (AD-15) — swisstopo tiles via MapLibre, vehicle position + approved-zone overlay.

> **Not yet:** dual-path E-STOP, WORM/Object-Lock audit, in-app RBAC enforcement, log sync, graduated failsafe, video (KVS WebRTC). **Cognito identity + MFA + the API Gateway authorizer are already deployed** — see [Cloud (AWS) — M2](#cloud-aws--m2-migration). Track: `.claude/joppilot_project_timeline.md`.

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
cp services/fleet/.env.example     services/fleet/.env

# 3. Infra (postgres + mosquitto + valkey)
docker compose -f infra/docker-compose.yml up -d

# 4. Build the contract first (other workspaces import it; edge reads its schemas)
pnpm --filter @joppilot/contract build      # or: cd packages/contract && pnpm build

# 5. Generate each Prisma client + create the Postgres tables.
#    NOTE: command and fleet share one database with separate schemas, so DON'T run
#    `prisma db push` (it would drop the other service's tables). Generate the clients,
#    then create tables with the SQL helper below.
cd services/command && pnpm exec prisma generate && cd ../..
cd services/fleet   && pnpm exec prisma generate && cd ../..

docker exec -i joppilot_postgres psql -U joppilot -d joppilot_db <<'SQL'
CREATE TABLE IF NOT EXISTS "EventDataRecord" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "commandId" TEXT UNIQUE NOT NULL, "vehicleId" TEXT NOT NULL, issuer TEXT NOT NULL,
  action TEXT NOT NULL, status TEXT NOT NULL, details JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS "PreDepartureCheck" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "vehicleId" TEXT NOT NULL, status TEXT NOT NULL, items JSONB NOT NULL,
  "confirmedBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3));
CREATE TABLE IF NOT EXISTS "Mission" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "vehicleId" TEXT NOT NULL, "routeId" TEXT, status TEXT NOT NULL,
  "checklistId" TEXT UNIQUE REFERENCES "PreDepartureCheck"(id),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3));
SQL
# (telemetry_samples is auto-created by the telemetry service on boot — no step needed)
```

> The package name in step 4 may differ — check `packages/contract/package.json`'s `name`.
> If unsure, just `cd packages/contract && pnpm build`.
> Each Prisma client is generated into that service's `generated/prisma/` (git-ignored).

---

## Run it (5 terminals)

```bash
# Terminal 1 — Command service (Gate 1)     → http://localhost:4000
cd services/command   && pnpm build && node dist/main      # or: pnpm dev

# Terminal 2 — Telemetry service             → http://localhost:4001
cd services/telemetry && pnpm build && node dist/main      # or: pnpm dev

# Terminal 3 — Fleet & mission service       → http://localhost:4002
cd services/fleet     && pnpm build && node dist/main      # or: pnpm dev

# Terminal 4 — Edge simulator (Gate 2, authoritative safety kernel)
cd edge/sim && EDGE_ZONE_TYPE=public_approved_route cargo run

# Terminal 5 — Operator console              → http://localhost:3000
cd apps/console && pnpm dev
```

Then open **http://localhost:3000**.

`EDGE_ZONE_TYPE` sets the vehicle's current zone (e.g. `public_approved_route`,
`depot`, `out_of_tod`) and drives the Gate-2 zone/mode matrix from the ICD. Try
`depot` to see disruptive diagnostics (`RESTART_*`) accepted that a public route defers.

---

## Verify it works

With infra + all services + the edge running:

```bash
# Edge Gate-2 smoke test — expect 10/10 pass
node services/command/test/smoke-edge.cjs

# Maneuver proposal end-to-end (ICD §6) — expect 11/11 pass
node services/command/test/smoke-maneuver.cjs

# Fleet & mission + pre-departure check — expect 20/20 pass
#   (clears Mission + PreDepartureCheck rows first; safe in local dev)
docker exec joppilot_postgres psql -U joppilot -d joppilot_db \
  -c 'DELETE FROM "Mission"; DELETE FROM "PreDepartureCheck";'
node services/fleet/test/smoke-fleet.cjs

# Contract unit tests
pnpm --filter @joppilot/contract test

# Postgres tables — expect EventDataRecord · telemetry_samples · Mission ·
# PreDepartureCheck (NOT TelemetryRecord)
docker exec joppilot_postgres psql -U joppilot -d joppilot_db -c "\dt"
```

---

## Cloud (AWS) — M2 migration

`infra/terraform/` provisions the AWS environment, applied by **GitHub Actions via
OIDC** (no stored keys): a PR runs `terraform plan`, a merge to `main` runs
`terraform apply`. Remote state lives in S3 + a DynamoDB lock. Primary region:
**eu-central-1 (Frankfurt)** — AD-17 (IoT Core / KVS WebRTC aren't in Zurich; the
revFADP permits EU/EEA hosting, DAT-08).

```
infra/terraform/
  envs/dev/          # dev environment: composition + backend + vars (start here)
  modules/network/   # VPC, multi-AZ public/private subnets, IGW, route tables
  modules/ecr/       # container registry
  modules/ecs/       # Fargate hello-world (nginx) + task SG
  modules/alb/       # Application Load Balancer + target group + WAF
  modules/cognito/   # user pool (invite-only, MFA/TOTP), admin/operator groups
  modules/apigw/     # HTTP API + Cognito JWT authorizer + VPC Link
  bootstrap/         # one-time: S3 state bucket, DynamoDB lock, OIDC CI role
```

### Deployed so far

| Milestone | What | Status |
|---|---|---|
| M2-1 | Terraform skeleton + GitHub Actions OIDC CI/CD | ✅ |
| M2-2 | VPC (multi-AZ) + ECR + Fargate hello-world (nginx) | ✅ |
| M2-3a | Cognito: invite-only, MFA (TOTP), `admin`/`operator` groups | ✅ |
| M2-3b | ALB in front of ECS (interim internet-facing) | ✅ |
| M2-3c-1a | HTTP API Gateway + Cognito JWT authorizer + VPC Link + WAF | ✅ |
| M2-3c-1b | flip ALB → **internal** (API Gateway becomes the only entry) | ⏳ next |
| M2-3c-2 | move ECS to **private** subnets + VPC endpoints | ⏳ |
| M2-4 | real services (command/telemetry/fleet) on ECS + Aurora | ⏳ |
| M2-5 | IoT Core (MQTT backbone, mTLS, Device Shadow) | ⏳ |

### Ingress path (current)

```
client ──HTTPS──▶ API Gateway (HTTP API, Cognito JWT authorizer)
                    └─▶ VPC Link ─▶ ALB (WAF) ─▶ ECS Fargate (nginx)
```

> **Interim deviations, closed in M2-3c** (recorded in `infra/terraform/envs/dev/main.tf`):
> the ALB is still internet-facing (HTTP :80) and ECS runs in a public subnet. Do
> **not** place real services (M2-4) behind this until 1b/2 make the ALB internal +
> ECS private.

### Test the cloud stack

Read `api_endpoint` / `alb_dns_name` from the Actions **apply** log (`Outputs:`
block) or the AWS console.

```bash
# API Gateway — no token must be rejected by the Cognito authorizer:
curl -i https://<api_endpoint>/            # → HTTP 401 {"message":"Unauthorized"}

# Direct ALB (interim, HTTP) — nginx when the task runs, 503 when scaled to 0:
curl -i http://<alb_dns_name>/             # → 200 "Welcome to nginx!" | 503
```

A valid Cognito **bearer token** on the API Gateway call reaches nginx (needs a
user — invite-only). Gotcha: the authorizer's audience is the app client id; if a
valid token still 401s, send the **ID token** (Cognito access tokens have no `aud`).

### Cost control (stop paying overnight)

Fargate is the main variable cost. Scale the task to 0 when you stop for the day —
the service uses `ignore_changes = [desired_count]`, so Terraform won't revert it:

```bash
aws ecs update-service --cluster joppilot-dev-cluster \
  --service joppilot-dev-hello --desired-count 0 --region eu-central-1
# resume: --desired-count 1   (or ECS console → service → Update)
```

Standing costs that do **not** scale to zero: **ALB (~$16/mo)** + **WAF (~$6/mo,**
toggle `enable_waf = false`**)**. Near-$0 needs `terraform destroy`. An `$80/mo` AWS
Budgets alarm emails at 50 / 80 / 100 %.

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
  Prisma. **Prisma** is used by `services/command` (EDR/audit) and `services/fleet`
  (missions + checklists). Both share one database but **separate schemas**, and each
  generates its client into its own `generated/prisma/` — so never `prisma db push`
  (it drops the other service's tables); create tables via SQL (see Quick start step 5).
- **NestJS services bind to `0.0.0.0`** (`app.listen(port, '0.0.0.0')`). On WSL2 the
  default IPv6-only bind makes the browser fail with "failed to fetch" — keep the explicit
  bind for any new service.
- Default service hosts are `localhost` (broker `1883`, postgres `5432`, valkey `6379`) —
  no extra env needed for the local stack beyond the three `.env` files above.

## Useful root scripts (Turborepo)

```bash
pnpm build       # build all workspaces
pnpm dev         # run all dev tasks
pnpm test        # run all tests
pnpm typecheck   # type-check all workspaces
pnpm lint
```
