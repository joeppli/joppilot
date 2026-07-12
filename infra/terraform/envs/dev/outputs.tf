output "account_id" {
  description = "AWS account this environment is deployed into (sanity check)."
  value       = data.aws_caller_identity.current.account_id
}

output "region" {
  description = "Region this environment is deployed into."
  value       = data.aws_region.current.name
}

# --- M2-2 network + ECR ---
output "vpc_id" {
  description = "VPC id."
  value       = module.network.vpc_id
}

output "public_subnet_ids" {
  description = "Public subnet ids (one per AZ)."
  value       = module.network.public_subnet_ids
}

output "private_subnet_ids" {
  description = "Private subnet ids (one per AZ)."
  value       = module.network.private_subnet_ids
}

output "ecr_repository_urls" {
  description = "ECR repository URLs (image registry for pushes)."
  value       = module.ecr.repository_urls
}

# --- M2-3b ALB ---
output "alb_dns_name" {
  description = "ALB DNS name. Internal since M2-3c-1b — only answers inside the VPC; use api_endpoint (with a Cognito ID token) to test from outside."
  value       = module.alb.dns_name
}

# --- M2-3c API Gateway ---
output "api_endpoint" {
  description = "HTTP API public invoke URL. Requests need a Cognito bearer token (no token → 401)."
  value       = module.apigw.api_endpoint
}

# --- M2-2 Fargate hello-world ---
output "hello_cluster_name" {
  description = "ECS cluster name (for finding the running task)."
  value       = module.ecs_hello.cluster_name
}

output "hello_service_name" {
  description = "ECS service name."
  value       = module.ecs_hello.service_name
}

output "hello_log_group" {
  description = "CloudWatch log group for the hello-world task."
  value       = module.ecs_hello.log_group
}

# --- M2-4-2 RDS PostgreSQL (interim for AD-14 — see module comment) ---
output "db_host" {
  description = "RDS Postgres hostname (DB_HOST for the services; resolves only inside the VPC)."
  value       = module.rds.db_host
}

output "db_name" {
  description = "Initial database name (DB_NAME for the services)."
  value       = module.rds.database_name
}

output "db_master_secret_arn" {
  description = "RDS-managed Secrets Manager secret with {username, password} — task definitions reference it via valueFrom (M2-4-3)."
  value       = module.rds.master_user_secret_arn
}

# --- M2-3a Cognito ---
output "cognito_user_pool_id" {
  description = "Cognito user pool id."
  value       = module.cognito.user_pool_id
}

output "cognito_client_id" {
  description = "SPA app-client id (token audience)."
  value       = module.cognito.client_id
}

output "cognito_issuer_url" {
  description = "OIDC issuer URL (JWT iss claim; used by the future API Gateway authorizer)."
  value       = module.cognito.issuer_url
}

output "cognito_hosted_ui_domain" {
  description = "Cognito hosted-UI base domain for OAuth login/logout."
  value       = module.cognito.hosted_ui_domain
}

output "cognito_group_names" {
  description = "RBAC group names (map to roles via the cognito:groups JWT claim)."
  value       = module.cognito.group_names
}

# --- M2-4-3 real services + Valkey ---
output "service_names" {
  description = "ECS service names for the three real services (for manual scaling: aws ecs update-service --service <name> --desired-count 0|1)."
  value = {
    command   = module.service_command.service_name
    telemetry = module.service_telemetry.service_name
    fleet     = module.service_fleet.service_name
  }
}

output "service_log_groups" {
  description = "CloudWatch log groups of the three services (first stop when a task won't go healthy — the entrypoint logs `prisma migrate deploy` before the app boots)."
  value = {
    command   = module.service_command.log_group
    telemetry = module.service_telemetry.log_group
    fleet     = module.service_fleet.log_group
  }
}

output "valkey_endpoint" {
  description = "Valkey (fencing-lock cache) endpoint host — TLS-only; only the command task SG can reach it."
  value       = module.valkey.endpoint_host
}

output "command_signing_public_key_pem" {
  description = "Ed25519 PUBLIC key matching the command-signing secret (M2-5, ICD §4) — the vehicle pins this; distributed with IoT provisioning (M2-5b)."
  value       = tls_private_key.command_signing.public_key_pem
}

output "iot_endpoint" {
  description = "IoT Core ATS data endpoint (M2-5b) — AWS_IOT_ENDPOINT for the services/edge when MQTT is flipped on."
  value       = module.iot.iot_endpoint
}

output "iot_service_cert_secret_arn" {
  description = "Secrets Manager ARN of the cloud services' IoT cert bundle (mounted into ECS in a later slice)."
  value       = module.iot.service_cert_secret_arn
}

# --- M3-4b: console live WSS (fills apps/console/.env.local VITE_* vars) -------
output "console_identity_pool_id" {
  description = "VITE_IDENTITY_POOL_ID for the console's live-telemetry WSS"
  value       = module.console_identity.identity_pool_id
}

output "console_iot_policy_name" {
  description = "IoT policy to attach per operator identity (DEV-23): aws iot attach-policy --policy-name <this> --target <identityId>"
  value       = module.console_identity.iot_policy_name
}
