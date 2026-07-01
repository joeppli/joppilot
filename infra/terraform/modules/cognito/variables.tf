variable "name_prefix" {
  description = "Prefix for resource names (e.g. joppilot-dev)."
  type        = string
}

variable "domain_prefix" {
  description = "Globally-unique prefix for the Cognito hosted-UI domain (e.g. joppilot-dev-<account_id>). Lowercase letters, numbers and hyphens only."
  type        = string
}

variable "callback_urls" {
  description = "Allowed OAuth redirect URLs for the SPA (hosted-UI login returns here). localhost is allowed over http; everything else must be https."
  type        = list(string)
  default     = ["http://localhost:5173"]
}

variable "logout_urls" {
  description = "Allowed sign-out redirect URLs for the SPA."
  type        = list(string)
  default     = ["http://localhost:5173"]
}

variable "mfa_configuration" {
  description = "MFA enforcement: ON (required, SEC-03), OPTIONAL, or OFF. Only ON/OPTIONAL are meaningful with the software-token (TOTP) factor enabled below."
  type        = string
  default     = "ON"
}

variable "advanced_security_mode" {
  description = "Cognito threat protection: OFF (free), AUDIT (log risk, no action), or ENFORCED (block / step-up MFA). AUDIT and ENFORCED bill per MAU. dev = OFF; prod should be ENFORCED (SEC)."
  type        = string
  default     = "OFF"
}

variable "deletion_protection" {
  description = "ACTIVE prevents the user pool (and all its users) from being deleted. dev = INACTIVE for easy teardown; prod should be ACTIVE."
  type        = string
  default     = "INACTIVE"
}

variable "access_token_validity_minutes" {
  description = "Access token lifetime in minutes."
  type        = number
  default     = 60
}

variable "id_token_validity_minutes" {
  description = "ID token lifetime in minutes."
  type        = number
  default     = 60
}

variable "refresh_token_validity_days" {
  description = "Refresh token lifetime in days."
  type        = number
  default     = 30
}
