output "cluster_endpoint" {
  description = "Writer endpoint hostname (DB_HOST for the services)"
  value       = aws_rds_cluster.aurora.endpoint
}

output "port" {
  description = "PostgreSQL port"
  value       = aws_rds_cluster.aurora.port
}

output "database_name" {
  description = "Initial database name (DB_NAME for the services)"
  value       = aws_rds_cluster.aurora.database_name
}

output "master_user_secret_arn" {
  description = "ARN of the RDS-managed Secrets Manager secret holding {username, password}"
  value       = aws_rds_cluster.aurora.master_user_secret[0].secret_arn
}

output "security_group_id" {
  description = "Cluster security group (M2-4-3 narrows its ingress to task SGs)"
  value       = aws_security_group.aurora.id
}

output "cluster_arn" {
  description = "Cluster ARN"
  value       = aws_rds_cluster.aurora.arn
}

output "kms_key_arn" {
  description = "CMK encrypting the cluster storage (execution roles need kms:Decrypt only for the secret, not this key)"
  value       = aws_kms_key.aurora.arn
}
