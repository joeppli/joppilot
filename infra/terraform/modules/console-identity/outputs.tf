output "identity_pool_id" {
  description = "Cognito Identity Pool id — the console's VITE_IDENTITY_POOL_ID"
  value       = aws_cognito_identity_pool.console.id
}

output "iot_policy_name" {
  description = "IoT policy to attach per operator identity (DEV-23)"
  value       = aws_iot_policy.console_viewer.name
}

output "viewer_role_arn" {
  description = "IAM role authenticated console identities assume"
  value       = aws_iam_role.console_viewer.arn
}
