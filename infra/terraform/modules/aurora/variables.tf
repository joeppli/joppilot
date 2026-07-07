variable "name_prefix" {
  description = "Prefix for resource names, e.g. joppilot-dev"
  type        = string
}

variable "vpc_id" {
  description = "VPC to place the cluster in"
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR allowed to reach PostgreSQL (tightened to task SGs in M2-4-3)"
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet ids for the DB subnet group (>= 2 AZs required by RDS)"
  type        = list(string)
}

variable "engine_version" {
  description = "Aurora PostgreSQL engine version (must be >= 15.7 / 16.3 for min 0 ACU auto-pause)"
  type        = string
  default     = "16.6"
}

variable "database_name" {
  description = "Initial database name"
  type        = string
  default     = "joppilot"
}

variable "master_username" {
  description = "Master username (password is RDS-managed in Secrets Manager)"
  type        = string
  default     = "joppilot_admin"
}

variable "min_acu" {
  description = "Serverless v2 minimum capacity. 0 enables auto-pause (idle = storage cost only)"
  type        = number
  default     = 0
}

variable "max_acu" {
  description = "Serverless v2 maximum capacity (1 ACU covers the ~10-vehicle dev scale, OPS-01)"
  type        = number
  default     = 1
}

variable "seconds_until_auto_pause" {
  description = "Idle seconds (no connections) before the cluster auto-pauses (300-86400)"
  type        = number
  default     = 300
}

variable "backup_retention_days" {
  description = "Automated backup retention in days"
  type        = number
  default     = 7
}
