variable "name_prefix" {
  description = "Prefix for resource Name tags (e.g. joppilot-dev)."
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "az_count" {
  description = "Number of Availability Zones to spread subnets across (multi-AZ)."
  type        = number
  default     = 2
}
