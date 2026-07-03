# =============================================================================
# VPC endpoints module — private AWS API access for private-subnet tasks (M2-3c-2)
# =============================================================================
# ECS tasks in PRIVATE subnets have no internet route, so they cannot reach the
# AWS APIs they need (pull the image from ECR, write CloudWatch logs) unless
# those APIs get a private doorway inside the VPC. Two options existed:
#   - NAT gateway (~$32/mo + $/GB): full internet egress. REJECTED — costs more
#     and the architecture prescribes endpoints (§6.1 "VPC endpoints") precisely
#     to control NAT data-processing costs.
#   - VPC endpoints (this module): per-service private doorways.
#
# The set a Fargate task needs to pull a private ECR image and ship awslogs:
#   ecr.api (auth) + ecr.dkr (registry) + logs (interface, ~$8-9/mo each)
#   + s3 gateway (image layers live in S3 — FREE).
# Secrets Manager / KMS / STS endpoints are deferred to M2-4 (no secrets yet).
# Note: public ECR (public.ecr.aws) has NO endpoint — hence the image moves to
# our private ECR repository in this step.
#
# COST posture (dev): interface endpoints sit in a SINGLE AZ (~$26/mo total
# instead of ~$52 for two) — an AZ outage would break image pulls/logs, which is
# acceptable in dev; production places one per AZ. The destroy-billables
# workflow targets this module (independent standing cost).

data "aws_region" "current" {}

# --- Endpoint security group: the ENIs accept HTTPS from inside the VPC -------
resource "aws_security_group" "endpoints" {
  name_prefix = "${var.name_prefix}-vpce-"
  description = "Interface VPC endpoints: HTTPS from inside the VPC"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTPS from the VPC"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  tags = { Name = "${var.name_prefix}-vpce-sg" }

  lifecycle {
    create_before_destroy = true
  }
}

locals {
  # Interface-type endpoints to create (each bills hourly per AZ).
  interface_services = toset(["ecr.api", "ecr.dkr", "logs"])
}

resource "aws_vpc_endpoint" "interface" {
  for_each = local.interface_services

  vpc_id             = var.vpc_id
  service_name       = "com.amazonaws.${data.aws_region.current.name}.${each.value}"
  vpc_endpoint_type  = "Interface"
  subnet_ids         = var.subnet_ids
  security_group_ids = [aws_security_group.endpoints.id]
  # Private DNS makes the normal AWS hostnames (e.g. *.dkr.ecr...amazonaws.com)
  # resolve to the endpoint's private IPs inside the VPC — no client config.
  private_dns_enabled = true

  tags = { Name = "${var.name_prefix}-vpce-${each.value}" }
}

# --- S3 gateway endpoint (FREE) ------------------------------------------------
# ECR stores image layers in S3; the pull fetches them over this route-table
# entry. Gateway endpoints have no ENI, no SG and no hourly charge.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = var.vpc_id
  service_name      = "com.amazonaws.${data.aws_region.current.name}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = var.route_table_ids

  tags = { Name = "${var.name_prefix}-vpce-s3" }
}
