output "user_pool_id" {
  description = "Cognito user pool id."
  value       = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  description = "Cognito user pool ARN (used by the future API Gateway authorizer)."
  value       = aws_cognito_user_pool.this.arn
}

output "client_id" {
  description = "SPA app-client id (the token audience the authorizer checks)."
  value       = aws_cognito_user_pool_client.spa.id
}

output "issuer_url" {
  description = "OIDC issuer URL — JWTs are validated against this (iss claim)."
  value       = "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com/${aws_cognito_user_pool.this.id}"
}

output "hosted_ui_domain" {
  description = "Cognito hosted-UI base domain for OAuth login/logout."
  value       = "https://${aws_cognito_user_pool_domain.this.domain}.auth.${data.aws_region.current.name}.amazoncognito.com"
}

output "group_names" {
  description = "RBAC group names created in the pool (map to roles via cognito:groups)."
  value       = sort(keys(local.groups))
}
