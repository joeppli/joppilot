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
  description = "Number of running tasks. Set to 0 to stop the task (no compute cost) without destroying the service."
  type        = number
  default     = 1
}
