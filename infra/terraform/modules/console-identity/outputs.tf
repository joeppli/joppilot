output "identity_pool_id" {
  description = "Cognito Identity Pool id — the console's VITE_IDENTITY_POOL_ID"
  value       = aws_cognito_identity_pool.console.id
}

output "iot_policy_name" {
  description = "IoT policy attached to each operator identity on first sign-in (see aws_lambda_function.attach)"
  value       = aws_iot_policy.console_viewer.name
}

output "viewer_role_arn" {
  description = "IAM role authenticated console identities assume"
  value       = aws_iam_role.console_viewer.arn
}

output "attach_lambda_invoke_arn" {
  description = "Invoke ARN of the DEV-23 attach function, for the API Gateway integration"
  value       = aws_lambda_function.attach.invoke_arn
}

output "attach_lambda_function_name" {
  description = "Name of the DEV-23 attach function, for the API Gateway invoke permission"
  value       = aws_lambda_function.attach.function_name
}
