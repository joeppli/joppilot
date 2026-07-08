variable "name_prefix" {
  description = "Prefix for resource names (e.g. joppilot-dev)."
  type        = string
}

variable "vpc_id" {
  description = "VPC the cache lives in."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet ids (serverless caches want at least two, in different AZs)."
  type        = list(string)
}

variable "allowed_security_group_ids" {
  description = "Map of label → SG id allowed to reach Valkey on 6379 (the service task SGs)."
  type        = map(string)
  default     = {}
}
