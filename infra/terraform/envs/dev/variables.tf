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
