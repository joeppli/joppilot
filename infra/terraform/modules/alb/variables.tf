variable "name_prefix" {
  description = "Prefix for resource names (e.g. joppilot-dev)."
  type        = string
}

variable "vpc_id" {
  description = "VPC the load balancer and target group live in."
  type        = string
}

variable "subnet_ids" {
  description = "Subnets for the ALB (>= 2 AZs). Public subnets for an internet-facing ALB; private subnets when internal."
  type        = list(string)
}

variable "internal" {
  description = "false = internet-facing (dev interim, browser-testable). Flip to true in M2-3c when API Gateway + VPC Link front it."
  type        = bool
  default     = false
}

variable "container_port" {
  description = "Port the target containers listen on (target group + health-check port)."
  type        = number
  default     = 80
}

variable "health_check_path" {
  description = "HTTP path the ALB probes for target health."
  type        = string
  default     = "/"
}

variable "ingress_cidrs" {
  description = "Source CIDRs allowed to reach the ALB on :80. Open for the dev interim; tightened to the VPC/VPC-Link surface once API Gateway fronts it."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "enable_waf" {
  description = "Attach an AWS WAF (regional) WebACL to the ALB. Bills ~$6/mo (WebACL + one managed rule group); toggle off to save cost in idle dev."
  type        = bool
  default     = true
}
