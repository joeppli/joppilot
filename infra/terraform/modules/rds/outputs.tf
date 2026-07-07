output "db_host" {
  description = "Instance hostname without port (DB_HOST for the services)"
  value       = aws_db_instance.db.address
}

output "port" {
  description = "PostgreSQL port"
  value       = aws_db_instance.db.port
}

output "database_name" {
  description = "Initial database name (DB_NAME for the services)"
  value       = aws_db_instance.db.db_name
}

output "master_user_secret_arn" {
  description = "ARN of the RDS-managed Secrets Manager secret holding {username, password}"
  value       = aws_db_instance.db.master_user_secret[0].secret_arn
}

output "security_group_id" {
  description = "DB security group (M2-4-3 narrows its ingress to task SGs)"
  value       = aws_security_group.db.id
}

output "instance_arn" {
  description = "Instance ARN"
  value       = aws_db_instance.db.arn
}

output "kms_key_arn" {
  description = "CMK encrypting the instance storage"
  value       = aws_kms_key.db.arn
}
