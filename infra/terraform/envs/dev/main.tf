# =============================================================================
# Joppilot — dev environment root module
# =============================================================================
# M2-2 adds the (free) network foundation + ECR. The billable Fargate hello-world
# and any egress (NAT / VPC endpoints) come in a follow-up step. Still to come:
#   module "ecs"  { source = "../../modules/ecs"  ... }   # M2-2 Fargate hello-world
#   module "iot"  { source = "../../modules/iot"  ... }   # M2-5 IoT Core

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

# --- M2-3b: Application Load Balancer in front of the ECS service ---
# Internet-facing for the dev interim (browser-testable via its DNS name). M2-3c
# flips it to internal behind API Gateway (WAF + Cognito authorizer) + VPC Link.
module "alb" {
  source      = "../../modules/alb"
  name_prefix = "joppilot-${var.environment}"
  vpc_id      = module.network.vpc_id
  subnet_ids  = module.network.public_subnet_ids
  internal    = false
}

# --- M2-2/M2-3b: Fargate hello-world, now behind the ALB ---
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
