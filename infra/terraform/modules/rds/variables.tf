variable "name_prefix" {
  description = "Prefix for resource names, e.g. joppilot-dev"
  type        = string
}

variable "vpc_id" {
  description = "VPC to place the instance in"
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
  description = "RDS PostgreSQL engine version"
  type        = string
  default     = "16.6"
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
