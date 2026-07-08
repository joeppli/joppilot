output "endpoint_host" {
  description = "Valkey endpoint hostname (REDIS_HOST for the command service)."
  value       = aws_elasticache_serverless_cache.this.endpoint[0].address
}

output "endpoint_port" {
  description = "Valkey endpoint port (REDIS_PORT; serverless is TLS-only → REDIS_TLS=true)."
  value       = aws_elasticache_serverless_cache.this.endpoint[0].port
}
