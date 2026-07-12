variable "name_prefix" {
  description = "Resource name prefix, e.g. joppilot-dev"
  type        = string
}

variable "topic_root" {
  description = "MQTT topic root (matches the iot module), e.g. joppilot/v1"
  type        = string
  default     = "joppilot/v1"
}

variable "vpc_id" {
  description = "VPC the Lambda attaches to (reaches RDS + the secretsmanager endpoint)"
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet ids for the Lambda ENIs"
  type        = list(string)
}

variable "db_host" {
  description = "PostgreSQL host (RDS endpoint)"
  type        = string
}

variable "db_port" {
  description = "PostgreSQL port"
  type        = number
  default     = 5432
}

variable "db_name" {
  description = "PostgreSQL database name"
  type        = string
}

variable "db_secret_arn" {
  description = "Secrets Manager ARN of the RDS-managed master credentials"
  type        = string
}
