# =============================================================================
# Joppilot — dev environment root module
# =============================================================================
# M2-1 is intentionally a SKELETON: this milestone proves the pipeline (Terraform
# + GitHub Actions OIDC + remote state) end to end with zero infrastructure yet.
# `terraform plan` against this file succeeds and shows "No changes".
#
# Real resources arrive in the next milestones and will be wired in here as module
# calls, e.g.:
#   module "network" { source = "../../modules/network" ... }   # M2-2 VPC, subnets, endpoints
#   module "ecr"     { source = "../../modules/ecr"     ... }   # M2-2 container registries
#   module "ecs"     { source = "../../modules/ecs"     ... }   # M2-2/4 Fargate
#   module "edge"    { source = "../../modules/iot"     ... }   # M2-5 IoT Core
#
# Until then we expose a couple of read-only data sources so plan does something
# meaningful (confirms the provider + credentials work).

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
