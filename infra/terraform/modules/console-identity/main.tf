# =============================================================================
# console-identity module — M3-4b (live WSS → console, architecture C4-L2)
# =============================================================================
# The operator console subscribes to live telemetry DIRECTLY from IoT Core over
# MQTT/WSS (the `OPC → IoT` edge in the container diagram): a Cognito Identity
# Pool exchanges the operator's User-Pool login (invite-only + MFA, SEC-03) for
# short-lived AWS credentials that SigV4-sign the WebSocket URL.
#
# READ-ONLY BY CONSTRUCTION: the role can Subscribe/Receive on the vehicle
# telemetry/heartbeat/maneuver topics and can NOT publish anywhere — commands
# keep flowing exclusively through API Gateway → Gate 1 (fencing token, zone
# filter, signing, EDR). A compromised console credential can therefore watch,
# never drive (SEC-04 least privilege; the two-gate command integrity holds).
#
# Authorization is the INTERSECTION of two policies:
#   1. the IAM role policy below (scoped per-identity via the
#      ${cognito-identity.amazonaws.com:sub} policy variable), and
#   2. an IoT policy ATTACHED TO THE COGNITO IDENTITY (AWS requirement for
#      authenticated identities): DEV-23 — attached manually per operator
#      identity in dev (one CloudShell command, see the register/README);
#      automate with a post-auth hook before real operator onboarding.
#
# COST: Cognito Identity Pools are free; no standing cost → NOT a
# destroy-billables target (same rule as module.iot).

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  region  = data.aws_region.current.name
  account = data.aws_caller_identity.current.account_id
}

# -----------------------------------------------------------------------------
# Identity Pool: User-Pool logins only, no guests
# -----------------------------------------------------------------------------
resource "aws_cognito_identity_pool" "console" {
  identity_pool_name               = "${var.name_prefix}-console"
  allow_unauthenticated_identities = false # invite-only stays invite-only

  cognito_identity_providers {
    client_id               = var.user_pool_client_id
    provider_name           = "cognito-idp.${local.region}.amazonaws.com/${var.user_pool_id}"
    server_side_token_check = false
  }
}

# -----------------------------------------------------------------------------
# Authenticated role — read-only IoT viewer
# -----------------------------------------------------------------------------
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = ["cognito-identity.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "cognito-identity.amazonaws.com:aud"
      values   = [aws_cognito_identity_pool.console.id]
    }
    condition {
      test     = "ForAnyValue:StringLike"
      variable = "cognito-identity.amazonaws.com:amr"
      values   = ["authenticated"]
    }
  }
}

resource "aws_iam_role" "console_viewer" {
  name               = "${var.name_prefix}-console-viewer"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

# Down-path topics only (vehicle → cloud). $${...} escapes Terraform
# interpolation so the literal IAM policy variable reaches AWS.
locals {
  topic_arn  = "arn:aws:iot:${local.region}:${local.account}:topic/${var.topic_root}/vehicles/*"
  filter_arn = "arn:aws:iot:${local.region}:${local.account}:topicfilter/${var.topic_root}/vehicles/*"
  down_paths = ["telemetry", "heartbeat", "maneuver/proposal", "maneuver/status"]
}

resource "aws_iam_role_policy" "console_viewer" {
  name = "iot-readonly-viewer"
  role = aws_iam_role.console_viewer.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Each console session connects with its OWN identity id as the MQTT
        # client id — two operators can never kick each other's connection.
        Effect   = "Allow"
        Action   = ["iot:Connect"]
        Resource = "arn:aws:iot:${local.region}:${local.account}:client/$${cognito-identity.amazonaws.com:sub}"
      },
      {
        Effect   = "Allow"
        Action   = ["iot:Subscribe"]
        Resource = [for p in local.down_paths : "${local.filter_arn}/${p}"]
      },
      {
        Effect   = "Allow"
        Action   = ["iot:Receive"]
        Resource = [for p in local.down_paths : "${local.topic_arn}/${p}"]
      },
      # NO iot:Publish — the console watches; commands go through Gate 1.
    ]
  })
}

resource "aws_cognito_identity_pool_roles_attachment" "console" {
  identity_pool_id = aws_cognito_identity_pool.console.id
  roles = {
    authenticated = aws_iam_role.console_viewer.arn
  }
}

# -----------------------------------------------------------------------------
# IoT policy — the second half of the intersection (attached per identity)
# -----------------------------------------------------------------------------
# Mirrors the IAM scoping; client id left wildcard here because the IAM policy
# already pins it to the caller's own identity id. DEV-23: attach per operator
# identity (aws iot attach-policy --policy-name <this> --target <identityId>).
data "aws_iam_policy_document" "iot_console" {
  statement {
    actions   = ["iot:Connect"]
    resources = ["arn:aws:iot:${local.region}:${local.account}:client/*"]
  }
  statement {
    actions   = ["iot:Subscribe"]
    resources = [for p in local.down_paths : "${local.filter_arn}/${p}"]
  }
  statement {
    actions   = ["iot:Receive"]
    resources = [for p in local.down_paths : "${local.topic_arn}/${p}"]
  }
}

resource "aws_iot_policy" "console_viewer" {
  name   = "${var.name_prefix}-console-viewer"
  policy = data.aws_iam_policy_document.iot_console.json
}
