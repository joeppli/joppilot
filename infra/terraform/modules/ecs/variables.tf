variable "name_prefix" {
  description = "Prefix for resource names (e.g. joppilot-dev)."
  type        = string
}

variable "vpc_id" {
  description = "VPC the service runs in."
  type        = string
}

variable "subnet_ids" {
  description = "Public subnet ids the task runs in (assign_public_ip = true, no NAT)."
  type        = list(string)
}

variable "container_image" {
  description = "Container image for the hello-world task."
  type        = string
  default     = "public.ecr.aws/nginx/nginx:1.27-alpine"
}

variable "container_port" {
  description = "Port the container listens on."
  type        = number
  default     = 80
}

variable "cpu" {
  description = "Fargate task CPU units (256 = 0.25 vCPU)."
  type        = number
  default     = 256
}

variable "memory" {
  description = "Fargate task memory (MiB)."
  type        = number
  default     = 512
}

variable "desired_count" {
  description = "INITIAL number of running tasks on create. After creation the count is ignored by Terraform (lifecycle.ignore_changes) — start/stop the task manually via AWS CLI/console."
  type        = number
  default     = 1
}

variable "alb_security_group_id" {
  description = "When set, the task accepts inbound only from this ALB security group (M2-3b). When null, the port is open to the world (standalone M2-2 demo)."
  type        = string
  default     = null
}

variable "target_group_arn" {
  description = "When set, the service registers tasks into this ALB target group (M2-3b). When null, the service runs without a load balancer."
  type        = string
  default     = null
}
