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
