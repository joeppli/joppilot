output "cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.this.name
}

output "service_name" {
  description = "ECS service name."
  value       = aws_ecs_service.this.name
}

output "log_group" {
  description = "CloudWatch log group for the task."
  value       = aws_cloudwatch_log_group.this.name
}

output "security_group_id" {
  description = "Security group attached to the task."
  value       = aws_security_group.this.id
}

output "cluster_arn" {
  description = "ECS cluster ARN — the real service modules (M2-4-3) join this shared cluster."
  value       = aws_ecs_cluster.this.arn
}
