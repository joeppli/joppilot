# Joppilot - Project Timeline

## Phase 1: Core Components and Rough Prototype

| ID | Phase / Milestone | Task / Work Item | Dates |
|:---|:---|:---|:---:|
| **M1-1** | **Milestone 1:** Local Rapid Prototype | Monorepo skeleton: NestJS (TS) backend + React/Vite SPA + docker-compose (local MQTT, Postgres) | 29.06.2026 - 03.07.2026 |
| **M1-2** | **Milestone 1:** Local Rapid Prototype | command_id, session_id, target_vehicle, mode, fencing token, timestamp, ttl, signature + ACK/NACK schema | 29.06.2026 - 03.07.2026 |
| **M1-3** | **Milestone 1:** Local Rapid Prototype | Envelope generation + 1st gate (zone/mode filter, simple version of ICD §1 matrix) → MQTT publish (fleet/{id}/commands) | 29.06.2026 - 03.07.2026 |
| **M1-4** | **Milestone 1:** Local Rapid Prototype | Rust safety kernel (AD-16 / RES-01): MQTT subscribe + 2nd gate validation (token/zone/ttl/idempotency) + ACK/NACK; geofence/deadman skeleton. Greengrass-ready design → carries over to M3/M4 | 29.06.2026 - 03.07.2026 |
| **M1-5** | **Milestone 1:** Local Rapid Prototype | CARLA bridge (Python, sim adapter, non-safety): Receive verified command from Rust kernel via local IPC → CARLA Python API (movement/E-STOP). Throwaway for M4 | 29.06.2026 - 03.07.2026 |
| **M1-6** | **Milestone 1:** Local Rapid Prototype | CARLA telemetry flow: position/speed/(sim battery) → edge → telemetry topic → backend → SPA | 29.06.2026 - 03.07.2026 |
| **M1-7** | **Milestone 1:** Local Rapid Prototype | Minimal operator console: connect, command buttons/gamepad, live telemetry, E-STOP button | 29.06.2026 - 03.07.2026 |
| **M1-8** | **Milestone 1:** Local Rapid Prototype | End-to-end local smoke test (command→CARLA movement, telemetry back) + AWS migration notes | 29.06.2026 - 03.07.2026 |
| | | | |
| **M2-1** | **Milestone 2:** AWS Migration | Terraform skeleton + GitHub Actions CI/CD (dev account, eu-central-1) | 06.07.2026 - 10.07.2026 |
| **M2-2** | **Milestone 2:** AWS Migration | VPC (multi-AZ) + ECR + basic VPC endpoints + hello-world deploy to ECS Fargate | 06.07.2026 - 10.07.2026 |
| **M2-3** | **Milestone 2:** AWS Migration | Cognito (invite-only, MFA, group→role JWT) + API Gateway (WAF + Cognito authorizer) → VPC Link → internal ALB | 06.07.2026 - 10.07.2026 |
| **M2-4** | **Milestone 2:** AWS Migration | Migrate backend services (command / telemetry / fleet) to ECS Fargate + connect Aurora PostgreSQL (Prisma). Includes: in-app RBAC guard (`cognito:groups` → role, SEC-03/04) · **operator↔vehicle assignment model + assignment check on take-control (SEC-04: authority valid only for ASSIGNED vehicles)** · authorization revocation → immediate session disconnect (SEC-09) · `correlationId` mandatory in the command envelope (SEC-06) | 06.07.2026 - 10.07.2026 |
| **M2-5** | **Milestone 2:** AWS Migration | IoT Core: topic hierarchy (fleet/{id}/commands-telemetry-status...), X.509 + mTLS provisioning, core Device Shadow fields. Includes: command `signature` becomes mandatory + enforced on the vehicle (ICD §4) · **zone/permit configuration delivery to the vehicle via Device Shadow** (cloud zone-change now reaches the edge) | 06.07.2026 - 10.07.2026 |
| | | | |
| **M3-1** | **Milestone 3:** CARLA from Cloud | Greengrass V2 edge: VEA component (2nd gate validation, idempotency, ACK/NACK) + CARLA bridge component | 13.07.2026 - 17.07.2026 |
| **M3-2** | **Milestone 3:** CARLA from Cloud | End-to-end command path via cloud: forward/backward/right/left/throttle/brake works in CARLA | 13.07.2026 - 17.07.2026 |
| **M3-3** | **Milestone 3:** CARLA from Cloud | E-STOP path (ICD §3): dual message/highest priority; immediate stop in CARLA; dedup with command_id | 13.07.2026 - 17.07.2026 |
| **M3-4** | **Milestone 3:** CARLA from Cloud | Telemetry: CARLA → Greengrass → IoT Rules → Lambda batch → Aurora partition + live WSS → console | 13.07.2026 - 17.07.2026 |
| **M3-5** | **Milestone 3:** CARLA from Cloud | Geofence 2-gate (ICD §1): simple polygon, zone type → command class permission (Mode 2 rejection in public). Includes: **edge consumption of the permit + permit fields `validFrom` and speed limit enforced on the vehicle** (ICD §1 conditions) | 13.07.2026 - 17.07.2026 |
| **M3-6** | **Milestone 3:** CARLA from Cloud | Connection loss scenario: local deadman/safe-stop (zero connectivity, latched) demonstration in CARLA. Includes: offline log buffer on the edge → lossless log sync on reconnect (RES-02) | 13.07.2026 - 17.07.2026 |
| | | | |
| **M4-1** | **Milestone 4:** Real Vehicle | B-boundary adapter + clarifying Mode 2 with the ADS team (temporary ROS2/gRPC) | 20.07.2026 - 24.07.2026 |
| **M4-2** | **Milestone 4:** Real Vehicle | Greengrass edge → real vehicle interface (CAN decode/B-adapter) command bridge | 20.07.2026 - 24.07.2026 |
| **M4-3** | **Milestone 4:** Real Vehicle | Application of Mode 2 driving commands on the vehicle | 20.07.2026 - 24.07.2026 |
| **M4-4** | **Milestone 4:** Real Vehicle | Real vehicle telemetry (GPS/speed/battery/DTC) → telemetry pipeline → console | 20.07.2026 - 24.07.2026 |
| **M4-5** | **Milestone 4:** Real Vehicle | Field smoke test + E-STOP/safe-stop confirmation on the real vehicle | 20.07.2026 - 24.07.2026 |
| | | | |
| **INT** | **Buffer & Integration** | Demo of 4 Milestones, bug fixing, closing gaps | 27.07.2026 - 31.07.2026 |

---

## August - AWS Deep Dive
* **Data Infrastructure (~3d):** 
  * Firehose → S3 Parquet/Glue/Athena, 
  * pg_partman partition rotation
  * 90-day retention
* **Audio/Visual Communication (~5d):** 
  * KVS WebRTC (POC)
  * On-demand session, multi-camera, two-way audio, latency overlay
* **Channel & Communication Reliability (~2d):** 
  * WebRTC Data Channel (Main) + IoT Core MQTT QoS1 (Backup)
  * Dual-path E-STOP
* **Audit and Logging (~2d):** 
  * WORM / EDR
  * S3 Object Lock + Aurora append-only
  * Correlation ID
  * *Design:* Postgres EDR = **working copy** (queryable); S3 Object Lock = **append-only evidence copy** (immutable). A status transition is written as a **NEW record**, never an in-place update — the audit trail is append-only end to end.
* **Edge Failsafe v2 (~3d):** 
  * Graduated, speed-sensitive, hysteresis, N-of-M
* **Remote Update / OTA (~2d):** 
  * Greengrass Deployments
  * IoT Jobs (Canary + Rollback)
* **Security Hardening (~3d):** 
  * WAF rules, GuardDuty / Security Hub
  * KMS, Secrets Manager
  * Client VPN (Operator only CH)
* **Disaster Recovery (DR) - Zurich (~2d):** 
  * S3 CRR + Aurora replica
* **Observability (~2d):** 
  * CloudWatch / X-Ray + OpenTelemetry
* **Internationalization (i18n) [M] (~3d):** 
  * Localization completion (de-CH / fr-CH / it-CH / en) — **committed**, not optional (LNG-01 / LNG-02 / LNG-04 are [M])
  * Language switch + locale-aware formatting; console strings externalized

## September (if needed)
- Load testing (10→50→100→200 sim vehicles; video session concurrency)  - ~5d
- Penetration testing + finding remediation  - ~4d
- revFADP/nDSG privacy package (ROPA, anonymization, retention)  - ~4d
- WCAG 2.1 AA audit  - ~2d
- Pilot preparation (Track R / sync with cantonal permit)  - ~5d