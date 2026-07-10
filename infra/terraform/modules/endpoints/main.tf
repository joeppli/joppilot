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
# M2-4-2 adds secretsmanager (~$8-9/mo): private tasks fetch the database
# credentials (the RDS-managed master secret) without an internet route. No KMS
# endpoint needed for that — Secrets Manager decrypts server-side; the caller
# only ever talks to the secretsmanager API. KMS / STS endpoints remain
# deferred until something inside the VPC calls them directly.
# The M2-5 follow-up adds iot.data + a private hosted zone (~$8-9/mo + $0.50/mo):
# MQTT (8883) and Device-Shadow HTTPS to IoT Core from the private subnets —
# see the dedicated block below.
# Note: public ECR (public.ecr.aws) has NO endpoint — hence the image moves to
# our private ECR repository in this step.
#
# COST posture (dev): interface endpoints sit in a SINGLE AZ (~$44/mo total
# instead of ~$88 for two) — an AZ outage would break image pulls/logs, which is
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

  ingress {
    description = "MQTT/TLS from the VPC to the iot.data endpoint"
    from_port   = 8883
    to_port     = 8883
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
  interface_services = toset(["ecr.api", "ecr.dkr", "logs", "secretsmanager"])
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

# --- IoT Core data endpoint + private DNS (M2-5 follow-up, 2026-07-10) --------
# The command/telemetry tasks speak MQTT (8883) to the account's ATS data
# endpoint, and the command service calls the Device-Shadow HTTPS API on the
# same hostname. The private subnets have no internet route, so without this
# endpoint MQTT can never connect after a clean apply (found in the M2 cloud
# E2E: the tasks sat in a reconnect loop until manually drifted to public
# subnets). Same single-AZ cost posture as the other interface endpoints.
#
# iot.data does NOT support private_dns_enabled for the account-specific ATS
# hostname, so a private hosted zone (VPC-internal only, does not affect how
# vehicles resolve the same name from the internet) aliases it to the
# endpoint's ENIs. Clients keep using the normal hostname — no config change.
resource "aws_vpc_endpoint" "iot_data" {
  vpc_id              = var.vpc_id
  service_name        = "com.amazonaws.${data.aws_region.current.name}.iot.data"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = var.subnet_ids
  security_group_ids  = [aws_security_group.endpoints.id]
  private_dns_enabled = false

  tags = { Name = "${var.name_prefix}-vpce-iot-data" }
}

resource "aws_route53_zone" "iot_data" {
  name    = var.iot_endpoint_hostname
  comment = "${var.name_prefix}: maps the IoT ATS hostname onto the iot.data VPC endpoint"

  vpc {
    vpc_id = var.vpc_id
  }
}

resource "aws_route53_record" "iot_data" {
  zone_id = aws_route53_zone.iot_data.zone_id
  name    = var.iot_endpoint_hostname
  type    = "A"

  alias {
    name                   = aws_vpc_endpoint.iot_data.dns_entry[0].dns_name
    zone_id                = aws_vpc_endpoint.iot_data.dns_entry[0].hosted_zone_id
    evaluate_target_health = false
  }
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
