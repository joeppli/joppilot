variable "aws_region" {
  description = "AWS region for all resources in this environment."
  type        = string
  default     = "eu-central-1" # Frankfurt — primary region (AD-17; IoT Core/KVS not in Zurich)
}

variable "environment" {
  description = "Environment name, used in tags and resource names."
  type        = string
  default     = "dev"
}

variable "monthly_budget_usd" {
  description = "Monthly cost budget (USD). Email alerts fire as actual spend crosses thresholds."
  type        = number
  default     = 80
}

variable "budget_alert_email" {
  description = "Email address that receives the budget alerts."
  type        = string
}

variable "hello_world_desired_count" {
  description = "INITIAL Fargate hello-world task count on create. After that, start/stop manually via AWS CLI/console (count is ignored by Terraform)."
  type        = number
  default     = 1
}

variable "cognito_callback_urls" {
  description = "Allowed OAuth redirect URLs for the console SPA. Add the CloudFront URL once the SPA is deployed; localhost:3000 matches the console dev server port (apps/console/vite.config.ts)."
  type        = list(string)
  default     = ["http://localhost:3000"]
}

variable "cognito_logout_urls" {
  description = "Allowed sign-out redirect URLs for the console SPA (port must match the console dev server, see cognito_callback_urls)."
  type        = list(string)
  default     = ["http://localhost:3000"]
}

variable "enable_waf" {
  description = "Attach the WAF WebACL to the ALB (~$6/mo). Set false to save cost while the dev stack is idle."
  type        = bool
  default     = true
}

variable "service_desired_count" {
  description = "INITIAL task count for each real service (command/telemetry/fleet) on create. After that, start/stop manually — Terraform ignores the count (same rule as hello-world)."
  type        = number
  default     = 1
}
