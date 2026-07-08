output "service_name" {
  description = "ECS service name (for manual scaling / logs)."
  value       = aws_ecs_service.this.name
}

output "task_security_group_id" {
  description = "Task SG id — downstream stores (RDS, Valkey) restrict ingress to this (SEC-04 / DEV-6 closure)."
  value       = aws_security_group.task.id
}

output "log_group" {
  description = "CloudWatch log group for the task."
  value       = aws_cloudwatch_log_group.this.name
}

output "target_group_arn" {
  description = "Target group the service registers into."
  value       = aws_lb_target_group.this.arn
}
