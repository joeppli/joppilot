# =============================================================================
# Greengrass module — Greengrass V2 core provisioning (M3-1, AD-11/AD-16)
# =============================================================================
# Provisions the CLOUD side of a Greengrass V2 core device per vehicle: core
# thing + X.509 cert, the core's IoT policy, the Token-Exchange-Service (TES)
# role alias + IAM role, and the S3 bucket component artifacts deploy from.
# The core software itself runs on the edge host (dev: docker on the developer
# machine, next to CARLA — see edge/greengrass/README.md) using the cert bundle
# this module writes to Secrets Manager (same manual-download flow as the
# vehicle cert, DEV-20 class).
#
# DESIGN (M3-1 decision): the Rust safety kernel KEEPS its direct mTLS MQTT
# connection as thing <vehicle-id>; the core connects as a SEPARATE thing
# '<vehicle-id>-core' so the two client ids never collide. Greengrass therefore
# starts as the deployment/lifecycle (OTA) layer only; moving the kernel onto
# Greengrass IPC is a later slice (no official Rust IPC SDK — revisit in M4).
#
# COST / DESTROY-BUTTON: like the iot module, idle cost ≈ $0 (per-device charge
# only in months the core actually connects, artifacts bucket is pennies) —
# deliberately NOT a destroy-billables target.
#
# DEV-12 RULE: verify Greengrass availability on the free account plan in the
# console BEFORE the first apply of this module (probe pending — 2026-07-13).

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# The credentials-provider endpoint — the installer config needs it alongside
# the data endpoint (TES exchanges the core's cert for AWS credentials here).
data "aws_iot_endpoint" "credentials" {
  endpoint_type = "iot:CredentialProvider"
}

data "aws_iot_endpoint" "ats" {
  endpoint_type = "iot:Data-ATS"
}

data "http" "amazon_root_ca1" {
  url = "https://www.amazontrust.com/repository/AmazonRootCA1.pem"
}

locals {
  region  = data.aws_region.current.name
  account = data.aws_caller_identity.current.account_id
  cores   = { for id in var.vehicle_ids : id => "${id}-core" }
}

# -----------------------------------------------------------------------------
# Core thing registry
# -----------------------------------------------------------------------------
resource "aws_iot_thing_type" "core" {
  name = "${var.name_prefix}-greengrass-core"

  properties {
    # ASCII only — IoT rejects non-[\p{Graph}\x20] descriptions.
    description = "Greengrass V2 core device hosting the vehicle edge components (M3-1)"
  }
}

resource "aws_iot_thing" "core" {
  for_each        = local.cores
  name            = each.value
  thing_type_name = aws_iot_thing_type.core.name
}

# -----------------------------------------------------------------------------
# TES: IAM role the core exchanges its cert for + the role alias pointing at it
# -----------------------------------------------------------------------------
# This is how components get AWS credentials without stored keys: nucleus
# presents the X.509 cert to the credentials endpoint, receives short-lived
# credentials for this role. Kept minimal: ship logs + fetch component
# artifacts from OUR bucket only.
resource "aws_iam_role" "tes" {
  name = "${var.name_prefix}-greengrass-tes"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "credentials.iot.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "tes" {
  name = "greengrass-tes"
  role = aws_iam_role.tes.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ShipComponentAndSystemLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"]
        Resource = "arn:aws:logs:${local.region}:${local.account}:log-group:/aws/greengrass/*"
      },
      {
        Sid      = "FetchComponentArtifacts"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.artifacts.arn}/*"
      }
    ]
  })
}

resource "aws_iot_role_alias" "tes" {
  alias    = "${var.name_prefix}-greengrass-tes"
  role_arn = aws_iam_role.tes.arn
}

# -----------------------------------------------------------------------------
# Core device IoT policy (per-thing scoped via policy variables, 2048 limit)
# -----------------------------------------------------------------------------
# Same scoping idea as the iot module's vehicle policy: a core cert can only
# act as ITS OWN core thing. Greengrass needs, beyond the usual MQTT set:
#   - greengrass:* (data plane: resolve/fetch component versions, deployments)
#   - iot:AssumeRoleWithCertificate on the TES role alias
# MQTT resources collapse to the core's own reserved namespaces ($aws/things/
# <core>*/…) + the vehicle namespace root for future bridge/relay components.
locals {
  core_client   = "arn:aws:iot:${local.region}:${local.account}:client/$${iot:Connection.Thing.ThingName}"
  core_things_t = "arn:aws:iot:${local.region}:${local.account}:topic/$aws/things/$${iot:Connection.Thing.ThingName}*/*"
  core_things_f = "arn:aws:iot:${local.region}:${local.account}:topicfilter/$aws/things/$${iot:Connection.Thing.ThingName}*/*"
  veh_ns_t      = "arn:aws:iot:${local.region}:${local.account}:topic/${var.topic_root}/vehicles/*"
  veh_ns_f      = "arn:aws:iot:${local.region}:${local.account}:topicfilter/${var.topic_root}/vehicles/*"
}

data "aws_iam_policy_document" "core" {
  statement {
    actions   = ["iot:Connect"]
    resources = [local.core_client]
  }
  statement {
    actions   = ["iot:Publish", "iot:Receive"]
    resources = [local.core_things_t, local.veh_ns_t]
  }
  statement {
    actions   = ["iot:Subscribe"]
    resources = [local.core_things_f, local.veh_ns_f]
  }
  statement {
    actions   = ["iot:AssumeRoleWithCertificate"]
    resources = [aws_iot_role_alias.tes.arn]
  }
  # Greengrass data-plane calls are not resource-scoped by core (the service
  # authorizes by the connected thing) — '*' here is the documented shape.
  statement {
    actions   = ["greengrass:*"]
    resources = ["*"]
  }
}

resource "aws_iot_policy" "core" {
  name   = "${var.name_prefix}-greengrass-core"
  policy = data.aws_iam_policy_document.core.json
}

# -----------------------------------------------------------------------------
# Certificates + attachments + Secrets Manager (DEV-20 class, same as iot mod.)
# -----------------------------------------------------------------------------
resource "aws_iot_certificate" "core" {
  for_each = local.cores
  active   = true
}

resource "aws_iot_policy_attachment" "core" {
  for_each = local.cores
  policy   = aws_iot_policy.core.name
  target   = aws_iot_certificate.core[each.key].arn
}

resource "aws_iot_thing_principal_attachment" "core" {
  for_each  = local.cores
  thing     = aws_iot_thing.core[each.key].name
  principal = aws_iot_certificate.core[each.key].arn
}

resource "aws_secretsmanager_secret" "core_cert" {
  for_each                = local.cores
  name                    = "${var.name_prefix}-greengrass-core-${each.key}"
  description             = "Greengrass core cert bundle + installer endpoints for ${each.value} (M3-1)."
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "core_cert" {
  for_each  = local.cores
  secret_id = aws_secretsmanager_secret.core_cert[each.key].id
  secret_string = jsonencode({
    certificatePem      = aws_iot_certificate.core[each.key].certificate_pem
    privateKey          = aws_iot_certificate.core[each.key].private_key
    rootCa              = data.http.amazon_root_ca1.response_body
    thingName           = each.value
    iotDataEndpoint     = data.aws_iot_endpoint.ats.endpoint_address
    iotCredEndpoint     = data.aws_iot_endpoint.credentials.endpoint_address
    roleAlias           = aws_iot_role_alias.tes.alias
    artifactsBucketName = aws_s3_bucket.artifacts.bucket
  })
}

# -----------------------------------------------------------------------------
# Component artifacts bucket (private; recipes point deployments here)
# -----------------------------------------------------------------------------
resource "aws_s3_bucket" "artifacts" {
  # Account id suffix — bucket names are global.
  bucket        = "${var.name_prefix}-gg-artifacts-${local.account}"
  force_destroy = true # dev: artifacts are rebuildable build outputs
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
