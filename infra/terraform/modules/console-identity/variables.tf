variable "name_prefix" {
  description = "Resource name prefix, e.g. joppilot-dev"
  type        = string
}

variable "user_pool_id" {
  description = "Cognito User Pool id the identity pool federates (module.cognito)"
  type        = string
}

variable "user_pool_client_id" {
  description = "SPA app-client id of the user pool (module.cognito)"
  type        = string
}

variable "topic_root" {
  description = "MQTT topic namespace root (matches the iot module), e.g. joppilot/v1"
  type        = string
  default     = "joppilot/v1"
}
