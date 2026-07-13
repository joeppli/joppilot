# =============================================================================
# Joppilot — dev environment root module
# =============================================================================
# Composes the dev stack: network + ECR + internal ALB + Fargate hello-world +
# Cognito + API Gateway.
#
# TARGET NETWORK POSTURE REACHED — M2-3c complete (AD-19): API Gateway (Cognito
# JWT authorizer) → VPC Link → internal ALB (WAF) → ECS in PRIVATE subnets with
# no public IP; AWS API access (ECR pull, CloudWatch logs) flows through VPC
# endpoints, not a NAT gateway. No NETWORK deviations remain — the real services
# (M2-4) may now be placed behind this stack. (One recorded engine deviation
# exists: module.rds below runs interim RDS instead of Aurora, AD-14 — see the
# deviations register in the architecture doc §11.3.)
#
# Still to come: real services on ECS (M2-4-3), IoT Core (M2-5), and — with the
# SPA's cloud deployment (post M2-5) — S3+CloudFront in front of everything, at
# which point the WAF moves from the ALB to CloudFront (AD-19; see the
# WAF-placement note in the architecture doc).

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# --- M2-2: network foundation (VPC, multi-AZ public/private subnets) — free ---
module "network" {
  source      = "../../modules/network"
  name_prefix = "joppilot-${var.environment}"
  vpc_cidr    = "10.0.0.0/16"
  az_count    = 2
}

# --- M2-2/M2-4-1: container registries ---
# hello-world = the M2-2/M2-3 demo image. command/telemetry/fleet are filled by
# the docker-build workflow (build on PR, push on merge to main).
module "ecr" {
  source = "../../modules/ecr"
  repository_names = [
    "joppilot/hello-world",
    "joppilot/command",
    "joppilot/telemetry",
    "joppilot/fleet",
  ]
}

# --- M2-3b / M2-3c-1b: internal Application Load Balancer behind API Gateway ---
# Internal since M2-3c-1b (closes deviation #2 up top): lives in the private
# subnets, SG allows :80 only from inside the VPC (the API Gateway VPC Link ENIs
# are the expected callers). Its DNS name no longer answers from the internet —
# reach the service through the API Gateway endpoint with a Cognito token.
module "alb" {
  source        = "../../modules/alb"
  name_prefix   = "joppilot-${var.environment}"
  vpc_id        = module.network.vpc_id
  subnet_ids    = module.network.private_subnet_ids
  internal      = true
  ingress_cidrs = [module.network.vpc_cidr]
  enable_waf    = var.enable_waf
}

# --- M2-3c-1a: HTTP API Gateway + Cognito JWT authorizer + VPC Link → ALB ---
# The public front door (AD-19). Since M2-3c-1b flipped the ALB internal, this
# is the ONLY public entry point into the stack.
module "apigw" {
  source             = "../../modules/apigw"
  name_prefix        = "joppilot-${var.environment}"
  vpc_id             = module.network.vpc_id
  subnet_ids         = module.network.private_subnet_ids
  vpc_cidr           = module.network.vpc_cidr
  alb_listener_arn   = module.alb.listener_arn
  cognito_issuer_url = module.cognito.issuer_url
  cognito_client_id  = module.cognito.client_id
  # M3-4c: let the operator console (cross-origin SPA) call the API with its
  # Cognito Bearer token. Dev origin only; add the CloudFront domain with the
  # SPA hosting phase (AD-19).
  cors_allow_origins = var.console_origins
}

# --- M2-3c-2: VPC endpoints — private AWS API access for the private ECS task ---
# ecr.api + ecr.dkr + logs (interface, ~$26/mo single-AZ) + S3 gateway (free).
# Chosen over a NAT gateway per architecture §6.1 (cheaper + no per-GB egress).
module "endpoints" {
  source          = "../../modules/endpoints"
  name_prefix     = "joppilot-${var.environment}"
  vpc_id          = module.network.vpc_id
  vpc_cidr        = module.network.vpc_cidr
  subnet_ids      = [module.network.private_subnet_ids[0]] # single AZ — dev cost posture
  route_table_ids = module.network.private_route_table_ids
  # M2-5 follow-up: iot.data endpoint + private hosted zone so the private-
  # subnet tasks reach IoT Core (MQTT 8883 / Device Shadow) — no internet route.
  iot_endpoint_hostname = module.iot.iot_endpoint
}

# --- M2-2/M2-3c-2: Fargate hello-world — private subnets, image from our ECR ---
# No public IP (deviation #1 closed): image pull + logs go through the VPC
# endpoints above. The image must exist in the ECR repo before the task can
# start: push nginx once via CloudShell (see infra/terraform/README.md).
module "ecs_hello" {
  source                = "../../modules/ecs"
  name_prefix           = "joppilot-${var.environment}"
  vpc_id                = module.network.vpc_id
  subnet_ids            = module.network.private_subnet_ids
  container_image       = "${module.ecr.repository_urls["joppilot/hello-world"]}:latest"
  desired_count         = var.hello_world_desired_count
  alb_security_group_id = module.alb.security_group_id
  target_group_arn      = module.alb.target_group_arn
}

# --- M2-4-2: RDS PostgreSQL — the relational database (interim for AD-14) ---
# INTERIM DEVIATION (recorded in the architecture doc): the free account plan
# only allows Aurora as a VPC-less public "express" cluster, which contradicts
# the network posture — so a free-tier db.t4g.micro Postgres runs inside the
# VPC instead; swaps back to Aurora Serverless v2 when the account upgrades.
# STATEFUL — never a destroy-billables target (permanent rule);
# deletion_protection guards the rest. Password lives in an RDS-managed
# Secrets Manager secret (free); private tasks fetch it through the
# secretsmanager VPC endpoint (module above).
module "rds" {
  source      = "../../modules/rds"
  name_prefix = "joppilot-${var.environment}"
  vpc_id      = module.network.vpc_id
  subnet_ids  = module.network.private_subnet_ids

  # DEV-6 closed (M2-4-3): PostgreSQL ingress is restricted to the three
  # service task SGs — the VPC-wide CIDR rule is gone. M3-4a adds the
  # telemetry-ingest Lambda as the fourth (and only serverless) writer.
  allowed_security_group_ids = {
    command          = module.service_command.task_security_group_id
    telemetry        = module.service_telemetry.task_security_group_id
    fleet            = module.service_fleet.task_security_group_id
    telemetry_lambda = module.telemetry_pipeline.lambda_security_group_id
  }
}

# --- M3-4a: serverless telemetry persistence (AD-14) ---------------------------
# IoT Rule (vehicles/+/telemetry) → SQS → Lambda batch → RDS telemetry_samples.
# The ECS telemetry service keeps the LIVE side (Socket.IO broadcast, link-loss)
# but no longer persists in the cloud (TELEMETRY_PERSIST=false below) — single
# writer, and persistence survives the Fargate task being scaled to 0.
# No standing cost → NOT a destroy-billables target (same rule as module.iot).
# DEV-12: probe IoT Rules + Lambda + SQS on the free plan BEFORE merging this.
module "telemetry_pipeline" {
  source        = "../../modules/telemetry-pipeline"
  name_prefix   = "joppilot-${var.environment}"
  vpc_id        = module.network.vpc_id
  subnet_ids    = module.network.private_subnet_ids
  db_host       = module.rds.db_host
  db_port       = module.rds.port
  db_name       = module.rds.database_name
  db_secret_arn = module.rds.master_user_secret_arn
}

# --- M2-4-3: ElastiCache Serverless Valkey — the fencing-lock cache (SEC-05) ---
# Ephemeral by design (locks live 6 s) → safe destroy-billables target.
# Serverless is TLS-only → the command service gets REDIS_TLS=true.
module "valkey" {
  source      = "../../modules/valkey"
  name_prefix = "joppilot-${var.environment}"
  vpc_id      = module.network.vpc_id
  subnet_ids  = module.network.private_subnet_ids

  allowed_security_group_ids = {
    command = module.service_command.task_security_group_id
    # audit-7: fleet READS the fencing lock to gate its operator workflows
    # (pre-departure confirm, mission lifecycle — SEC-05); the lock lifecycle
    # stays owned by the command service.
    fleet = module.service_fleet.task_security_group_id
  }
}

# --- M2-4-3: the three REAL services on Fargate --------------------------------
# Shared wiring: private subnets, shared cluster (ecs module), shared internal
# ALB with path-based listener rules, DB creds injected from the RDS-managed
# secret (valueFrom — never plaintext). RBAC: AUTH_TRUST_APIGW_JWT=true flips
# the RolesGuard to the cognito:groups claim of the JWT the API Gateway
# authorizer verified (closes DEV-7; trust note = DEV-15). MQTT_ENABLED=false
# until the IoT Core backbone lands (M2-5).
locals {
  db_env = {
    DB_HOST              = module.rds.db_host
    DB_PORT              = tostring(module.rds.port)
    DB_NAME              = module.rds.database_name
    MQTT_ENABLED         = "false"
    AUTH_TRUST_APIGW_JWT = "true"
  }
  db_secrets = {
    DB_USERNAME = "${module.rds.master_user_secret_arn}:username::"
    DB_PASSWORD = "${module.rds.master_user_secret_arn}:password::"
  }
  # M2-5b-2: the IoT cert bundle's fields injected as inline-PEM env vars from
  # the single service secret (valueFrom JSON-key selectors — never on disk).
  # AWS_IOT_ENDPOINT is set per-service (plain env) to flip the MQTT client to
  # mTLS/8883. Only command + telemetry connect (fleet has no MQTT client).
  iot_secrets = {
    AWS_CERT_CERT_PEM        = "${module.iot.service_cert_secret_arn}:certificatePem::"
    AWS_CERT_PRIVATE_KEY_PEM = "${module.iot.service_cert_secret_arn}:privateKey::"
    AWS_CERT_ROOT_CA_PEM     = "${module.iot.service_cert_secret_arn}:rootCa::"
  }
}

# --- M2-5: command-signing keypair (ICD §4) ------------------------------------
# Ed25519; the command service signs every envelope/zone-config, the vehicle
# verifies with the PUBLIC key (distributed with IoT provisioning, M2-5b).
# DEV-19: the private key is generated by terraform and therefore lives in the
# TF state (private S3 + DynamoDB lock) — revisit with KMS-backed generation/
# rotation before production. Delivered to the task via Secrets Manager, never
# a plain env var (SEC-02).
resource "tls_private_key" "command_signing" {
  algorithm = "ED25519"
}

resource "aws_secretsmanager_secret" "command_signing_key" {
  name                    = "joppilot-${var.environment}-command-signing-key"
  description             = "Ed25519 private key (PEM) the command service signs envelopes with (ICD §4, M2-5)."
  recovery_window_in_days = 0 # dev: allow clean re-creates
}

resource "aws_secretsmanager_secret_version" "command_signing_key" {
  secret_id     = aws_secretsmanager_secret.command_signing_key.id
  secret_string = tls_private_key.command_signing.private_key_pem
}

module "service_command" {
  source                = "../../modules/service"
  name_prefix           = "joppilot-${var.environment}"
  service_name          = "command"
  vpc_id                = module.network.vpc_id
  subnet_ids            = module.network.private_subnet_ids
  cluster_arn           = module.ecs_hello.cluster_arn
  container_image       = "${module.ecr.repository_urls["joppilot/command"]}:latest"
  container_port        = 4000
  alb_security_group_id = module.alb.security_group_id
  alb_listener_arn      = module.alb.listener_arn
  # /api/command + /api/maneuver + /healthz-command probes route here.
  listener_rule_priority = 10
  path_patterns          = ["/api/command/*", "/api/maneuver/*"]
  desired_count          = var.service_desired_count

  environment = merge(local.db_env, {
    DB_SCHEMA  = "command"
    REDIS_HOST = module.valkey.endpoint_host
    REDIS_PORT = tostring(module.valkey.endpoint_port)
    REDIS_TLS  = "true"
    # SEC-04: control authority only for ASSIGNED vehicles — enforced in the
    # cloud; the local sim runs with the check disabled (no admin bootstrap).
    ASSIGNMENT_ENFORCEMENT = "true"
    # M2-5b-2: connect to IoT Core over mTLS (overrides db_env's "false").
    MQTT_ENABLED     = "true"
    AWS_IOT_ENDPOINT = module.iot.iot_endpoint
  })
  # COMMAND_SIGNING_KEY (M2-5, ICD §4): the service is FAIL-CLOSED without it.
  # AWS_CERT_*_PEM (M2-5b-2): the IoT client cert bundle, inline from Secrets Manager.
  secrets = merge(local.db_secrets, local.iot_secrets, {
    COMMAND_SIGNING_KEY = aws_secretsmanager_secret.command_signing_key.arn
  })
  secret_arns = [module.rds.master_user_secret_arn, aws_secretsmanager_secret.command_signing_key.arn, module.iot.service_cert_secret_arn]
}

module "service_telemetry" {
  source                 = "../../modules/service"
  name_prefix            = "joppilot-${var.environment}"
  service_name           = "telemetry"
  vpc_id                 = module.network.vpc_id
  subnet_ids             = module.network.private_subnet_ids
  cluster_arn            = module.ecs_hello.cluster_arn
  container_image        = "${module.ecr.repository_urls["joppilot/telemetry"]}:latest"
  container_port         = 4001
  alb_security_group_id  = module.alb.security_group_id
  alb_listener_arn       = module.alb.listener_arn
  listener_rule_priority = 20
  path_patterns          = ["/api/telemetry/*"]
  desired_count          = var.service_desired_count

  # Telemetry writes raw pg into the default `public` schema (DEV-9). DB_SSL:
  # RDS PostgreSQL 15+ forces TLS (rds.force_ssl=1) and raw node-postgres does
  # not negotiate it on its own — Prisma (command/fleet) does, hence only
  # telemetry needs the flag (cert verification deferred — DEV-16).
  # M2-5b-2: telemetry ingest now connects to IoT Core over mTLS.
  environment = merge(local.db_env, {
    DB_SCHEMA        = "public"
    DB_SSL           = "true"
    MQTT_ENABLED     = "true"
    AWS_IOT_ENDPOINT = module.iot.iot_endpoint
    # M3-4a single-writer rule: persistence moved to the IoT Rules → SQS →
    # Lambda pipeline; this task keeps the live broadcast + link-loss only.
    TELEMETRY_PERSIST = "false"
  })
  secrets     = merge(local.db_secrets, local.iot_secrets)
  secret_arns = [module.rds.master_user_secret_arn, module.iot.service_cert_secret_arn]
}

module "service_fleet" {
  source                 = "../../modules/service"
  name_prefix            = "joppilot-${var.environment}"
  service_name           = "fleet"
  vpc_id                 = module.network.vpc_id
  subnet_ids             = module.network.private_subnet_ids
  cluster_arn            = module.ecs_hello.cluster_arn
  container_image        = "${module.ecr.repository_urls["joppilot/fleet"]}:latest"
  container_port         = 4002
  alb_security_group_id  = module.alb.security_group_id
  alb_listener_arn       = module.alb.listener_arn
  listener_rule_priority = 30
  path_patterns          = ["/api/fleet/*"]
  desired_count          = var.service_desired_count

  environment = merge(local.db_env, {
    DB_SCHEMA = "fleet"
    # audit-7: the fleet workflows are fencing-token-gated (SEC-05) — fleet
    # reads the lock the command service owns in Valkey.
    REDIS_HOST = module.valkey.endpoint_host
    REDIS_PORT = tostring(module.valkey.endpoint_port)
    REDIS_TLS  = "true"
  })
  secrets     = local.db_secrets
  secret_arns = [module.rds.master_user_secret_arn]
}

# --- M2-5b: IoT Core backbone (AD-11) — infrastructure slice ------------------
# Things + topic-scoped policies + X.509 provisioning + the ATS endpoint.
# INFRASTRUCTURE ONLY: the services stay MQTT_ENABLED=false (above) — a later
# slice mounts module.iot.service_cert_secret_arn into the tasks and flips them
# over. NO standing cost (per-message/connection billing) → deliberately NOT in
# the destroy-billables button (nothing to tear down when idle). DEV-12 probe
# confirmed IoT Core is available on the free account plan (2026-07-09).
module "iot" {
  source      = "../../modules/iot"
  name_prefix = "joppilot-${var.environment}"
  vehicle_ids = ["VEH-001"] # dev sim; grows toward the OPS-01 ~10-vehicle fleet
}

# --- M3-1: Greengrass V2 core provisioning (AD-11/AD-16) -----------------------
# Cloud side of the per-vehicle Greengrass core ('<id>-core' thing, TES role
# alias, artifacts bucket). The core software runs on the edge host — dev:
# docker on the developer machine next to CARLA (edge/greengrass/README.md).
# Idle cost ≈ $0 → NOT a destroy-billables target (same rule as module.iot).
# DEV-12: probe Greengrass on the free plan BEFORE the first apply (M3-1 day 1).
module "greengrass" {
  source      = "../../modules/greengrass"
  name_prefix = "joppilot-${var.environment}"
  vehicle_ids = ["VEH-001"]
}

# --- M3-4b: console live-telemetry identity (architecture C4: OPC → IoT WSS) ---
# Identity Pool + read-only IoT viewer role + IoT policy: the console signs a
# WSS URL with short-lived credentials from the operator's Cognito login and
# subscribes to telemetry/heartbeat/maneuver topics DIRECTLY on IoT Core.
# No publish rights — commands stay on the API Gateway → Gate 1 path.
# Free / no standing cost → NOT a destroy-billables target.
# DEV-23: the IoT policy must be attached per operator identity (manual in dev).
module "console_identity" {
  source              = "../../modules/console-identity"
  name_prefix         = "joppilot-${var.environment}"
  user_pool_id        = module.cognito.user_pool_id
  user_pool_client_id = module.cognito.client_id
}

# --- M2-3a: Cognito identity + MFA + RBAC groups (free tier, no standing cost) ---
# The API Gateway Cognito authorizer + internal ALB spine follow in later M2-3 PRs.
module "cognito" {
  source        = "../../modules/cognito"
  name_prefix   = "joppilot-${var.environment}"
  domain_prefix = "joppilot-${var.environment}-${data.aws_caller_identity.current.account_id}"
  callback_urls = var.cognito_callback_urls
  logout_urls   = var.cognito_logout_urls
}

# --- Cost guardrail: email alerts as actual spend approaches the monthly budget ---
# AWS Budgets is free. Thresholds are % of monthly_budget_usd.
resource "aws_budgets_budget" "monthly" {
  name         = "joppilot-${var.environment}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # Track GROSS usage (do not subtract the promotional credit), so alerts fire as
  # the credit is being consumed — not only after it runs out.
  cost_types {
    include_credit = false
    include_refund = false
  }

  dynamic "notification" {
    for_each = [50, 80, 100]
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.budget_alert_email]
    }
  }
}
