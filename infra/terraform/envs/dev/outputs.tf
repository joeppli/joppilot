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
  description = "ALB DNS name — browse http://<dns>/ to reach the service (dev interim)."
  value       = module.alb.dns_name
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
