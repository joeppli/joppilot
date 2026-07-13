variable "name_prefix" {
  description = "Prefix for resource names (e.g. joppilot-dev)."
  type        = string
}

variable "vpc_id" {
  description = "VPC the VPC Link security group lives in."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnets for the VPC Link ENIs (>= 2 AZs)."
  type        = list(string)
}

variable "vpc_cidr" {
  description = "VPC CIDR — the VPC Link is allowed to egress to the ALB anywhere in the VPC."
  type        = string
}

variable "alb_listener_arn" {
  description = "ALB HTTP listener ARN that the private (VPC Link) integration forwards to."
  type        = string
}

variable "cognito_issuer_url" {
  description = "Cognito OIDC issuer URL — the JWT authorizer validates the token's `iss` against this."
  type        = string
}

variable "cognito_client_id" {
  description = "Cognito app-client id — the JWT authorizer validates it as the token audience."
  type        = string
}

variable "cors_allow_origins" {
  description = "Browser origins allowed to call the API with CORS (the operator console SPA). Dev: [\"http://localhost:3000\"]; add the CloudFront domain when the SPA is hosted. Empty = no CORS."
  type        = list(string)
  default     = []
}
