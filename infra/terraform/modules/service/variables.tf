variable "name_prefix" {
  description = "Prefix for resource names (e.g. joppilot-dev)."
  type        = string
}

variable "service_name" {
  description = "Short service name (command | telemetry | fleet) — used in resource names, container name and log stream prefix."
  type        = string
}

variable "vpc_id" {
  description = "VPC the service runs in."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnet ids for the task (no public IP; AWS APIs via VPC endpoints)."
  type        = list(string)
}

variable "cluster_arn" {
  description = "ECS cluster the service joins (shared cluster from the ecs module)."
  type        = string
}

variable "container_image" {
  description = "Image URI — must be our private ECR (pullable through the VPC endpoints; public registries are unreachable from the private subnets)."
  type        = string
}

variable "container_port" {
  description = "Port the service listens on (command 4000, telemetry 4001, fleet 4002 — fixed in each main.ts)."
  type        = number
}

variable "alb_security_group_id" {
  description = "ALB security group id — task ingress is restricted to it (least privilege, SEC-04)."
  type        = string
}

variable "alb_listener_arn" {
  description = "Shared internal ALB HTTP listener the path rule attaches to."
  type        = string
}

variable "listener_rule_priority" {
  description = "Listener rule priority (unique per rule on the listener)."
  type        = number
}

variable "path_patterns" {
  description = "Path patterns routed to this service (max 5 — AWS condition limit)."
  type        = list(string)
}

variable "environment" {
  description = "Plain environment variables for the container (NEVER secrets — those go via var.secrets)."
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Secret env vars: name → Secrets Manager valueFrom selector (e.g. <secret-arn>:username::)."
  type        = map(string)
  default     = {}
}

variable "secret_arns" {
  description = "Secret ARNs the execution role may read (the ARNs referenced by var.secrets)."
  type        = list(string)
  default     = []
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
  description = "INITIAL task count on create; afterwards ignored by Terraform (scale by hand, see module header)."
  type        = number
  default     = 1
}
