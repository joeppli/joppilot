output "dns_name" {
  description = "ALB DNS name. Internal since M2-3c-1b: resolves to private IPs and answers only inside the VPC — test through the API Gateway endpoint instead."
  value       = aws_lb.this.dns_name
}

output "arn" {
  description = "ALB ARN."
  value       = aws_lb.this.arn
}

output "listener_arn" {
  description = "HTTP listener ARN — API Gateway's VPC Link private integration targets this."
  value       = aws_lb_listener.http.arn
}

output "target_group_arn" {
  description = "Target group ARN the ECS service registers into."
  value       = aws_lb_target_group.this.arn

  # The consumer (ECS service) must wait for the listener: the target group is
  # only associated with the load balancer once the listener forwards to it, and
  # ECS rejects a service attachment to an unassociated target group. Sequencing
  # via this output (rather than a module-level depends_on on the ECS module)
  # keeps the ECS module's data sources readable at plan time, avoiding a
  # spurious task-definition replacement.
  depends_on = [aws_lb_listener.http]
}

output "security_group_id" {
  description = "ALB security group id — the ECS task SG allows inbound only from this."
  value       = aws_security_group.alb.id
}
