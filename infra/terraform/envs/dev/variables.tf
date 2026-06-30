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
  description = "Fargate hello-world task count. Set to 0 to stop it (no compute cost)."
  type        = number
  default     = 1
}
