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
