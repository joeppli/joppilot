variable "name_prefix" {
  description = "Prefix for resource names (e.g. joppilot-dev)."
  type        = string
}

variable "vehicle_ids" {
  description = "Vehicle/thing ids to provision (each gets a thing + X.509 cert). OPS-01 scale is ~10; the dev sim is VEH-001."
  type        = list(string)
  default     = ["VEH-001"]
}

variable "topic_root" {
  description = "MQTT topic namespace root the policies scope to (matches the services/edge: joppilot/v1)."
  type        = string
  default     = "joppilot/v1"
}
