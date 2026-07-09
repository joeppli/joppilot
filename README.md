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

- **Two-gate command path** — cloud Gate 1 (Zod + zone/mode filter + fencing token; the mode is **derived from the action server-side**, never client-supplied) → MQTT → edge Gate 2 (JSON-Schema validation, TTL, monotonic token, idempotency/dedup with a bounded store, **mode↔action consistency**, zone-mode matrix). The schema load is fail-closed: an edge that cannot validate commands refuses to start.
- **Latched safe-stop & local watchdog** (RES-01/03/04) — 3 s cloud silence → autonomous safe-stop latch; **leaving the approved territory latches autonomously too** (geofence trigger, RES-03), commands merely observe it. Only `CLEAR_SAFE_STOP` releases the latch. Every latch transition seen in the heartbeat is appended to the EDR (cloud-side interim record until the on-vehicle log + sync lands in M3-6).
- **Maneuver proposal flow** (ICD §6) — edge generates a proposal → cloud `Maneuver` service + decision window → console card → operator decision returns as a regular Mode 1 command; timeout → safe default (edge authoritative).
- **Pre-departure check** (ICD §7 / LEG-03) — OAD checklist (self-diagnosis auto-pass — a **DEV-13** placeholder until M4-4 wires live vehicle health — + operator verification; operators cannot overwrite self-diagnosis items), safety-critical fail blocks confirmation, and mission start is **fail-closed**: no confirmed checklist (including a missing one) → no start. Since **audit-7** the whole fleet workflow is an operator action: every mutating call requires the vehicle's active **fencing token** (fleet reads the lock from Valkey, fail-closed), and every checklist creation / item verification / confirmation (incl. **rejected attempts**) and mission transition is an **append-only audit row** (`FleetEventRecord`, ICD §7 step 4 / LEG-04 — DEV-17 tracks the table split, DEV-18 the not-yet-vehicle-bound command envelopes).
- **Mission lifecycle** — `PENDING → PRE_CHECK → ACTIVE → PAUSED → COMPLETED / ABORTED`.
- **Disruptive-diagnostic deferral** (ICD §1 footnote) — `RESTART_*` / `UPDATE_CONFIG` deferred on a public approved route unless the vehicle is stationary; edge enforces it from live road speed.
- **Single-operator lock + handover** (ICD §8 / SEC-05) — fencing token in Valkey; a handover elevates the token so the previous operator's commands are rejected on the vehicle. Since **audit-7** handover passes the **same assignment gate** as take-control (SEC-04) and is EDR-attributed to the admin who performed it.
- **Operator↔vehicle assignment + revocation** (SEC-04/09, M2-4-4) — admin-granted assignments gate take-control (cloud-enforced; `ASSIGNMENT_ENFORCEMENT=true`); revoking severs an active session immediately (lock deleted → commands/heartbeats fail → vehicle watchdog latches). Every grant/revocation is EDR-logged.
- **Identity binding** (LEG-05, audit-7) — in the cloud (`AUTH_TRUST_APIGW_JWT=true`) the body-supplied `operatorId` must equal the API-GW-verified JWT identity (`cognito:username`/`sub`), and admin actions are attributed to the authenticated admin — an authenticated operator can no longer act (and be audit-attributed) as someone else. Local dev skips the binding (no identity provider).
- **Command-channel honesty** (ICD §3, audit-7) — a publish that cannot reach the broker returns **503 PUBLISH_FAILED** (plus an EDR row) instead of a fake success — critical for E-STOP, which must not silently drop; and a command with no vehicle ACK within TTL+grace gets a **NO_ACK** EDR row (visibility only; the retry policy comes with the M2-5 IoT Core backbone). The edge additionally rejects envelopes addressed to a **different vehicle** (`UNAUTHORIZED`) and refuses maneuver decisions arriving **after the decision window** (safe default wins, ICD §6).
- **Permit-gated zone change** (ICD §1) — **cloud side only (Gate 1)** so far: opening Mode 2 on a public route (→ `public_test_permit`) is controlled + logged, not an instant override — it requires a cantonal permit (`permitId` + validity window) and reverts to the safe default when the permit lapses. **Not yet end-to-end:** today the cloud zone-change does **not** reach the vehicle — the edge runs from its own `EDGE_ZONE_TYPE` env, so a cloud override is ignored on the vehicle. Delivery to the edge (Device Shadow) lands in **M2-5**, and edge permit consumption (`validFrom`, speed limit) in **M3-5**. The contradiction is fail-safe (the edge stays on its stricter local zone), but the feature is not yet wired through.
- **Live map** (AD-15) — swisstopo tiles via MapLibre, vehicle position + approved-zone overlay.

> **Not yet** (each now has a slot in the timeline): RBAC identity is wired in the cloud since **M2-4-3** — the deployed services read the role from the API-GW-verified `cognito:groups` claim (`AUTH_TRUST_APIGW_JWT=true`; the `x-operator-role` header remains a **local-dev-only** convenience). The rest of the M2-4 scope landed with **M2-4-4**: operator↔vehicle **assignment model** + assignment check on take-control (SEC-04, cloud-enforced via `ASSIGNMENT_ENFORCEMENT=true`), revocation→immediate session severing (SEC-09: lock deleted → commands/heartbeats fail → vehicle watchdog latches), and **mandatory `correlationId`** (SEC-06: Gate 1 generates, EDR column carries, edge NACKs without it; the maneuver chain correlates by `proposalId`). Command signing enforced (**M2-5**), log sync (**M3-6**), dual-path E-STOP / WORM audit / graduated failsafe / video KVS WebRTC (**August**). Track: `.claude/joppilot_project_timeline.md`.

---

## Prerequisites

- **Node ≥20** (`package.json` `engines` requires `>=20`; the Docker image is `node:22-alpine`)
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

# 5. Generate each Prisma client + apply the committed migrations (M2-4-2).
#    command and fleet share one database with SEPARATE Postgres schemas
#    (?schema=command / ?schema=fleet in each .env), each with its own
#    migration history — `migrate deploy` creates the schema on first run.
cd services/command && pnpm exec prisma generate && pnpm exec prisma migrate deploy && cd ../..
cd services/fleet   && pnpm exec prisma generate && pnpm exec prisma migrate deploy && cd ../..
# (telemetry_samples is auto-created by the telemetry service on boot — no step needed)
# (in the docker images the entrypoint runs `migrate deploy` automatically on start)
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
# Edge Gate-2 smoke test — expect 13/13 pass
node services/command/test/smoke-edge.cjs

# Assignment + revocation + handover gate (SEC-04/09) — expect 13/13 pass.
# Needs the command service restarted with enforcement on (dev default is off):
#   cd services/command && ASSIGNMENT_ENFORCEMENT=true node dist/main
node services/command/test/smoke-assignment.cjs

# Maneuver proposal end-to-end (ICD §6) — expect 11/11 pass
node services/command/test/smoke-maneuver.cjs

# Zone change / test-permit gate (ICD §1) — expect 6/6 pass
node services/command/test/smoke-zone.cjs

# Fleet & mission + pre-departure check + audit rows — expect 25/25 pass.
# Needs the COMMAND service (4000) + Valkey up too: the fleet workflows are
# fencing-token-gated since audit-7 (the test takes control first).
#   (clears Mission + PreDepartureCheck rows first; safe in local dev —
#    FleetEventRecord is append-only audit and is deliberately NOT cleared)
docker exec joppilot_postgres psql -U joppilot -d joppilot_db \
  -c 'DELETE FROM fleet."Mission"; DELETE FROM fleet."PreDepartureCheck";'
node services/fleet/test/smoke-fleet.cjs

# Contract unit tests
pnpm --filter @joppilot/contract test

# Postgres tables — expect command.EventDataRecord · command.VehicleAssignment ·
# fleet.Mission · fleet.PreDepartureCheck · fleet.FleetEventRecord ·
# public.telemetry_samples
docker exec joppilot_postgres psql -U joppilot -d joppilot_db \
  -c '\dt command.*' -c '\dt fleet.*' -c '\dt public.*'
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
  modules/endpoints/ # interface VPC endpoints (ECR/logs/Secrets Manager) + S3 gateway
  modules/rds/       # RDS PostgreSQL (STATEFUL — never in the destroy button; interim for AD-14)
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
| M2-3c-1b | ALB → **internal** (API Gateway is now the only public entry) | ✅ |
| M2-3c-2 | ECS in **private** subnets, no public IP; VPC endpoints (ECR/logs/S3); image from our ECR | ✅ |
| M2-4-1 | Containerize the 3 services (single-arg `Dockerfile`, `node:22-alpine`, `pnpm deploy`) + CI build/push to 3 new ECR repos (`:latest`+`:sha`) | ✅ |
| M2-4-2 | RDS PostgreSQL db.t4g.micro in-VPC (KMS CMK, deletion-protected; **interim for AD-14** — the free account plan only allows Aurora as a public VPC-less "express" cluster, swaps back to Aurora Serverless v2 on plan upgrade) + RDS-managed secret + `secretsmanager` VPC endpoint + Prisma migrations per schema, applied by the container entrypoint | ✅ |
| M2-4-3 | Real services (command/telemetry/fleet) on ECS Fargate: path-routed behind the internal ALB (`/api/command|maneuver` → 4000, `/api/fleet` → 4002, `/api/telemetry` → 4001), DB creds injected from the RDS-managed secret, **Serverless Valkey** (fencing lock, TLS-only) + RBAC from the API-GW-verified `cognito:groups` claim (closes DEV-7; trust note = DEV-15) + DB/Valkey SG ingress restricted to task SGs (closes DEV-6). **MQTT stays disabled until M2-5** (no broker in the cloud yet) — command/fleet REST is live, telemetry is deployed dormant | ✅ |
| M2-4-4 | Rest of the M2-4 scope: operator↔vehicle **assignment model** + take-control gate (SEC-04, `ASSIGNMENT_ENFORCEMENT=true` on the command task), revocation → immediate session severing (SEC-09), **mandatory `correlationId`** end-to-end (SEC-06: envelope schema + EDR column + edge NACK; maneuver chain correlates by `proposalId`) | ✅ |
| M2-5 | IoT Core (MQTT backbone, mTLS, Device Shadow) | ⏳ |
| later | SPA on S3 + **CloudFront** in front of API GW; WAF moves to CloudFront (AD-19) | ⏳ |

### Ingress path (current)

```
client ──HTTPS──▶ API Gateway (HTTP API, Cognito JWT authorizer)
                    └─▶ VPC Link ─▶ internal ALB (WAF)
                          ├─ /api/command/* · /api/maneuver/* ─▶ command :4000
                          ├─ /api/fleet/*                     ─▶ fleet   :4002
                          ├─ /api/telemetry/*                 ─▶ telemetry :4001 (dormant until M2-5)
                          └─ (default)                        ─▶ hello-world nginx
```

The ALB is **internal** since M2-3c-1b: private subnets, SG restricted to the VPC —
its DNS name no longer answers from the internet, and API Gateway is the **only**
public entry point. Each task SG accepts traffic only from the ALB SG; the DB and
Valkey SGs accept only the task SGs (SEC-04).

> **Console ↔ cloud is NOT wired yet:** the console still talks to localhost
> services, and Socket.IO/WebSocket does not traverse the HTTP API — live
> telemetry to the cloud console arrives with the CloudFront/SPA phase.

### Test the cloud stack

Read `api_endpoint` from the Actions **apply** log (`Outputs:` block) or the AWS
console. It gets a NEW value on every destroy/restore cycle (see cost control).

```bash
# No token must be rejected by the Cognito authorizer:
curl -i https://<api_endpoint>/            # → HTTP 401 {"message":"Unauthorized"}

# SEC-04 (M2-4-4): in the cloud an operator must be ASSIGNED before take-control.
# Assign first with an ADMIN-group token, then take control:
curl -X POST -H "Authorization: Bearer <ADMIN_ID_TOKEN>" -H 'Content-Type: application/json' \
  -d '{"operatorId":"OP-1"}' https://<api_endpoint>/api/command/VEH-001/assign
curl -X POST -H "Authorization: Bearer <ID_TOKEN>" -H 'Content-Type: application/json' \
  -d '{"operatorId":"OP-1"}' https://<api_endpoint>/api/command/VEH-001/take-control
# → {"status":"success","token":...}   (proves ALB routing + Valkey + RDS)
# Without the assign step the same call returns 403 {"reason":"NO_ASSIGNMENT"}.
# Revoke + immediate session severing (SEC-09):
curl -X POST -H "Authorization: Bearer <ADMIN_ID_TOKEN>" -H 'Content-Type: application/json' \
  -d '{"operatorId":"OP-1"}' https://<api_endpoint>/api/command/VEH-001/unassign
# → {"sessionSevered":true,...}; the operator's token stops working at once.

# RBAC (DEV-7 closed): an admin-only route with a NON-admin user's token → 403.
curl -X POST -H "Authorization: Bearer <OPERATOR_ID_TOKEN>" -H 'Content-Type: application/json' \
  -d '{"zone":"depot"}' https://<api_endpoint>/api/command/VEH-001/zone
# → 403 {"reason":"UNAUTHORIZED",...}; the same call with an admin-group token succeeds.

# Fleet pre-departure workflow (LEG-03) end-to-end — token-gated since
# audit-7: assign + take-control first (above), then pass operatorId + the
# fencing token in the body:
curl -X POST -H "Authorization: Bearer <ID_TOKEN>" -H 'Content-Type: application/json' \
  -d '{"operatorId":"OP-1","token":"<FENCING_TOKEN>"}' \
  https://<api_endpoint>/api/fleet/VEH-001/mission

# The internal ALB does NOT answer from the internet — a timeout here is correct
# behaviour (proof that API Gateway is the only entry), not an error:
curl -m 10 http://<alb_dns_name>/          # → timeout
```

A valid Cognito **bearer token** on the API Gateway call reaches the services (needs
a user — invite-only). Gotcha: the authorizer's audience is the app client id; if a
valid token still 401s, send the **ID token** (Cognito access tokens have no `aud`).
The RolesGuard reads the role from the ID token's `cognito:groups` claim — put admin
users in the Cognito `admin` group, operators in `operator`.

> **Identity binding (audit-7, LEG-05):** in the cloud the body-supplied
> `operatorId` must equal the caller's Cognito identity (`cognito:username`,
> falling back to `sub`) or the call gets **403 IDENTITY_MISMATCH** — so in the
> curl examples above, `OP-1` must literally be the Cognito username of the
> user whose token you send, and admins must be assigned/attributed under
> their own username. Local dev (no identity provider) skips the binding.

### Cost control (stop paying overnight)

Fargate is the main variable cost — now **4 services** (hello + command + telemetry +
fleet, ~$9/mo each while running). Scale to 0 when you stop for the day — every
service uses `ignore_changes = [desired_count]`, so Terraform won't revert it:

```bash
for s in hello command telemetry fleet; do
  aws ecs update-service --cluster joppilot-dev-cluster \
    --service joppilot-dev-$s --desired-count 0 --region eu-central-1
done
# resume: --desired-count 1   (or ECS console → service → Update)
```

Standing costs that do **not** scale to zero: **ALB (~$16/mo)** + **WAF (~$6/mo)** +
**4 interface VPC endpoints (~$35/mo, single-AZ)** + **Serverless Valkey (~$6/mo
floor)** ≈ **$63/mo total**. For those there is a one-click **destroy button**:
Actions → `terraform-destroy-billables` → Run workflow → set confirm to
`destroy-billables`. It destroys only the billable pieces (ALB+WAF, API Gateway,
VPC endpoints, ECS services, Valkey — the cache is ephemeral, 6-second locks lose
nothing) and keeps everything free — VPC, **Cognito users + MFA enrollments**, ECR
(pushed images survive), the ECS cluster. Restore: run the `terraform` workflow
manually (or merge any infra PR — apply rebuilds it); services come back and
`api_endpoint` gets a new URL. An `$80/mo` AWS Budgets alarm emails at 50 / 80 / 100 %.

**The database is deliberately NOT in the destroy button** (stateful — permanent
rule). It also costs (almost) nothing to keep: **db.t4g.micro + 20 GB sits inside
the free plan's RDS allowance** (750 h/mo); only its KMS key adds ~$1/mo. If it
ever needs to stop, `aws rds stop-db-instance --db-instance-identifier
joppilot-dev-db` pauses it for up to 7 days (AWS restarts it after that).
`deletion_protection` is on: even a manual `terraform destroy` refuses the
instance until the flag is flipped. (Aurora Serverless v2 returns when the
account moves off the free plan — see the AD-14 deviation note in the
architecture doc.)

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
  (missions + checklists). Both share one database but **separate Postgres schemas**
  (`?schema=command` / `?schema=fleet` in the DSN), each with its own committed
  migration history under `prisma/migrations/` — schema changes go through
  `prisma migrate dev` (creates a new migration) and are applied with
  `prisma migrate deploy` (the docker entrypoint does this automatically). Never
  `prisma db push` — it bypasses the migration history. Telemetry's raw writer
  deliberately stays in the **default `public` schema** (the `pg` driver ignores
  the `?schema=` DSN parameter) — revisit if/when telemetry moves to pg_partman
  partitioning (August).
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
