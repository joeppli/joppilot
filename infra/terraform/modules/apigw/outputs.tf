output "api_endpoint" {
  description = "Public invoke URL for the HTTP API ($default stage). Calls need a valid Cognito bearer token."
  value       = aws_apigatewayv2_api.this.api_endpoint
}

output "api_id" {
  description = "HTTP API id."
  value       = aws_apigatewayv2_api.this.id
}

output "vpc_link_id" {
  description = "VPC Link id."
  value       = aws_apigatewayv2_vpc_link.this.id
}
