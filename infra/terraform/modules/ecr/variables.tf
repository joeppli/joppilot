variable "repository_names" {
  description = "ECR repository names to create."
  type        = list(string)
}

variable "image_tag_mutability" {
  description = "MUTABLE or IMMUTABLE image tags."
  type        = string
  default     = "MUTABLE"
}

variable "scan_on_push" {
  description = "Run a vulnerability scan automatically on image push."
  type        = bool
  default     = true
}

variable "untagged_expiry_days" {
  description = "Expire untagged images after this many days (storage cost control)."
  type        = number
  default     = 14
}
