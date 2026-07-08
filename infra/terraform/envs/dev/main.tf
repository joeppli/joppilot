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
  # service task SGs — the VPC-wide CIDR rule is gone.
  allowed_security_group_ids = {
    command   = module.service_command.task_security_group_id
    telemetry = module.service_telemetry.task_security_group_id
    fleet     = module.service_fleet.task_security_group_id
  }
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
    DB_HOST   = module.rds.db_host
    DB_PORT   = tostring(module.rds.port)
    DB_NAME   = module.rds.database_name
    MQTT_ENABLED = "false"
    AUTH_TRUST_APIGW_JWT = "true"
  }
  db_secrets = {
    DB_USERNAME = "${module.rds.master_user_secret_arn}:username::"
    DB_PASSWORD = "${module.rds.master_user_secret_arn}:password::"
  }
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
  })
  secrets     = local.db_secrets
  secret_arns = [module.rds.master_user_secret_arn]
}

module "service_telemetry" {
  source                = "../../modules/service"
  name_prefix           = "joppilot-${var.environment}"
  service_name          = "telemetry"
  vpc_id                = module.network.vpc_id
  subnet_ids            = module.network.private_subnet_ids
  cluster_arn           = module.ecs_hello.cluster_arn
  container_image       = "${module.ecr.repository_urls["joppilot/telemetry"]}:latest"
  container_port        = 4001
  alb_security_group_id = module.alb.security_group_id
  alb_listener_arn      = module.alb.listener_arn
  listener_rule_priority = 20
  path_patterns          = ["/api/telemetry/*"]
  desired_count          = var.service_desired_count

  # Telemetry writes raw pg into the default `public` schema (DEV-9); it has
  # no MQTT source until IoT Core (M2-5) — the task is deployed dormant so the
  # M2-5 wiring lands on running plumbing.
  environment = merge(local.db_env, { DB_SCHEMA = "public" })
  secrets     = local.db_secrets
  secret_arns = [module.rds.master_user_secret_arn]
}

module "service_fleet" {
  source                = "../../modules/service"
  name_prefix           = "joppilot-${var.environment}"
  service_name          = "fleet"
  vpc_id                = module.network.vpc_id
  subnet_ids            = module.network.private_subnet_ids
  cluster_arn           = module.ecs_hello.cluster_arn
  container_image       = "${module.ecr.repository_urls["joppilot/fleet"]}:latest"
  container_port        = 4002
  alb_security_group_id = module.alb.security_group_id
  alb_listener_arn      = module.alb.listener_arn
  listener_rule_priority = 30
  path_patterns          = ["/api/fleet/*"]
  desired_count          = var.service_desired_count

  environment = merge(local.db_env, { DB_SCHEMA = "fleet" })
  secrets     = local.db_secrets
  secret_arns = [module.rds.master_user_secret_arn]
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
