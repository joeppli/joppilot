variable "name_prefix" {
  description = "Prefix for resource names (e.g. joppilot-dev)."
  type        = string
}

variable "vehicle_ids" {
  description = "Vehicle ids that get a Greengrass core (thing name = '<id>-core'). Kept separate from the direct-connect vehicle thing so the nucleus and the safety kernel never fight over one MQTT client id."
  type        = list(string)
}

variable "topic_root" {
  description = "MQTT namespace root (must match the iot module, e.g. joppilot/v1)."
  type        = string
  default     = "joppilot/v1"
}
