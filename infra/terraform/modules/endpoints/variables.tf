variable "name_prefix" {
  description = "Prefix for resource names (e.g. joppilot-dev)."
  type        = string
}

variable "vpc_id" {
  description = "VPC the endpoints live in."
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR — interface-endpoint SG allows :443 from here."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnets for the interface-endpoint ENIs. dev passes ONE subnet (cost — each endpoint bills hourly per AZ); production should pass one per AZ."
  type        = list(string)
}

variable "route_table_ids" {
  description = "Private route tables that get the S3 gateway-endpoint route (image layers)."
  type        = list(string)
}
