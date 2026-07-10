output "core_thing_names" {
  description = "Provisioned Greengrass core thing names (one per vehicle id)."
  value       = { for k, v in aws_iot_thing.core : k => v.name }
}

output "core_cert_secret_arns" {
  description = "Secrets Manager ARNs of the core cert bundles (vehicle id => arn)."
  value       = { for k, s in aws_secretsmanager_secret.core_cert : k => s.arn }
}

output "tes_role_alias" {
  description = "IoT role alias the cores exchange their cert for AWS credentials with."
  value       = aws_iot_role_alias.tes.alias
}

output "artifacts_bucket" {
  description = "S3 bucket component artifacts are deployed from."
  value       = aws_s3_bucket.artifacts.bucket
}
