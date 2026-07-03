# =============================================================================
# Joppilot — dev environment root module
# =============================================================================
# Composes the dev stack: network + ECR + internal ALB + Fargate hello-world +
# Cognito + API Gateway.
#
# KNOWN INTERIM DEVIATIONS from the target architecture — M2-3b scaffolding,
# being closed step by step in M2-3c (ref: .claude/joppilot_software_architecture.md AD-19):
#   1. STILL OPEN — ECS runs in a PUBLIC subnet with a public IP (target:
#      private). M2-3c-2 moves it to private subnets + VPC endpoints (ECR/logs),
#      not a NAT gateway. Its SG allows :80 only from inside the VPC, so the
#      public IP is not internet-reachable on the app port.
#   2. CLOSED in M2-3c-1b — the ALB is now INTERNAL: private subnets, SG
#      restricted to the VPC CIDR. API Gateway (Cognito JWT authorizer; WAF
#      attached on the ALB) → VPC Link is the ONLY public entry point (AD-19).
#   ==> Do NOT place real services (M2-4) behind this stack until M2-3c-2 has
#       closed deviation 1. The ALB currently fronts only the nginx hello-world.
#
# Still to come: private ECS + VPC endpoints (M2-3c-2), Aurora + real services
# (M2-4), IoT Core (M2-5), and — with the SPA's cloud deployment (post M2-5) —
# S3+CloudFront in front of everything, at which point the WAF moves from the
# ALB to CloudFront (AD-19; see the WAF-placement note in the architecture doc).

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# --- M2-2: network foundation (VPC, multi-AZ public/private subnets) — free ---
module "network" {
  source      = "../../modules/network"
  name_prefix = "joppilot-${var.environment}"
  vpc_cidr    = "10.0.0.0/16"
  az_count    = 2
}

# --- M2-2: container registry ---
module "ecr" {
  source           = "../../modules/ecr"
  repository_names = ["joppilot/hello-world"]
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

# --- M2-2/M2-3b: Fargate hello-world, now behind the ALB ---
# INTERIM (deviation #1 up top): runs in a PUBLIC subnet with a public IP;
# M2-3c-2 moves it to private subnets + VPC endpoints. The task SG restricts :80
# to the VPC CIDR, so the public IP is not internet-reachable on the app port.
module "ecs_hello" {
  source                = "../../modules/ecs"
  name_prefix           = "joppilot-${var.environment}"
  vpc_id                = module.network.vpc_id
  subnet_ids            = module.network.public_subnet_ids
  desired_count         = var.hello_world_desired_count
  alb_security_group_id = module.alb.security_group_id
  target_group_arn      = module.alb.target_group_arn
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
