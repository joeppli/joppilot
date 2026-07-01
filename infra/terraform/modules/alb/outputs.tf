output "dns_name" {
  description = "ALB DNS name — hit this to reach the service (dev: http://<dns>/)."
  value       = aws_lb.this.dns_name
}

output "arn" {
  description = "ALB ARN."
  value       = aws_lb.this.arn
}

output "target_group_arn" {
  description = "Target group ARN the ECS service registers into."
  value       = aws_lb_target_group.this.arn
}

output "security_group_id" {
  description = "ALB security group id — the ECS task SG allows inbound only from this."
  value       = aws_security_group.alb.id
}
