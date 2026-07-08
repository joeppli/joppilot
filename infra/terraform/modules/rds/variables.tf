variable "name_prefix" {
  description = "Prefix for resource names, e.g. joppilot-dev"
  type        = string
}

variable "vpc_id" {
  description = "VPC to place the instance in"
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet ids for the DB subnet group (>= 2 AZs required by RDS)"
  type        = list(string)
}

variable "engine_version" {
  # Major version only, on purpose: RDS retires old Postgres minors for new
  # instances (pinning 16.6 failed with "Cannot find version"), and with
  # auto_minor_version_upgrade enabled the provider officially supports a
  # version prefix — AWS picks the current default minor and later minor
  # bumps don't churn the plan.
  description = "RDS PostgreSQL engine version (major-version prefix, e.g. \"16\")"
  type        = string
  default     = "16"
}

variable "instance_class" {
  description = "Instance class (db.t4g.micro / db.t3.micro are inside the free-plan allowance)"
  type        = string
  default     = "db.t4g.micro"
}

variable "allocated_storage_gb" {
  description = "Allocated storage in GB (free-plan allowance: 20)"
  type        = number
  default     = 20
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

variable "backup_retention_days" {
  # AWS FREE-PLAN LIMIT: accounts on the free account plan cap RDS backup
  # retention at 1 day (create fails with FreeTierRestrictionError above
  # that). Raise to 7+ when the account moves to a paid plan — dev data is
  # reproducible from migrations, so 1 day is acceptable for now.
  description = "Automated backup retention in days (max 1 on the AWS free account plan)"
  type        = number
  default     = 1
}

variable "allowed_security_group_ids" {
  description = "Map of label → SG id allowed to reach PostgreSQL on 5432 (the service task SGs — DEV-6 closure, SEC-04)."
  type        = map(string)
  default     = {}
}
