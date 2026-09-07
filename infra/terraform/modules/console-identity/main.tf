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
#      authenticated identities) — attached automatically on the operator's
#      first sign-in by the attach Lambda at the bottom of this file (C3).
#      It used to be one manual CloudShell command per operator (DEV-23).
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
# already pins it to the caller's own identity id. Attached per operator
# identity by the attach Lambda below (C3) — equivalent to the manual
# `aws iot attach-policy --policy-name <this> --target <identityId>`.
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

# -----------------------------------------------------------------------------
# C3 — the attach, automated (closes DEV-23)
# -----------------------------------------------------------------------------
# The policy above is inert until it is attached to a Cognito IDENTITY, and an
# identity only exists once the SPA has called GetId. A Cognito post-auth
# trigger therefore cannot do this — at that moment there is nothing to attach
# to. Instead the console calls this function (behind the API Gateway Cognito
# authorizer, see module.apigw) right before opening its MQTT socket.
#
# LIVES HERE, NOT IN module.apigw, ON PURPOSE: this module is not a
# destroy-billables target, so the function and its role survive the weekend
# teardown. Only the route in front of it is recreated with the API. The
# function is also independent of ECS/ALB — the attach keeps working in exactly
# the window (IoT + Cognito up, compute down) where the console is view-only.
# Lambda has no standing cost, so surviving the teardown costs nothing.
data "archive_file" "attach_lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../../../lambda/iot-policy-attach"
  output_path = "${path.module}/.build/iot-policy-attach.zip"
  excludes    = ["package-lock.json", ".build"]
}

data "aws_iam_policy_document" "attach_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "attach_lambda" {
  name               = "${var.name_prefix}-iot-attach-lambda"
  assume_role_policy = data.aws_iam_policy_document.attach_assume.json
}

# iot:AttachPolicy authorizes on the TARGET, not on the policy being attached,
# and a Cognito identity id ("eu-central-1:4bd2b491-…") is not an ARN — so no
# resource pattern can match it and "*" is the only value that works. Measured,
# not assumed: with the policy ARN here, the call was denied naming the identity
# id as the resource.
#
# What still bounds this function, since IAM cannot:
#   - the policy it attaches is fixed at DEPLOY time (IOT_POLICY_NAME below),
#     never read from the request, so a caller cannot choose it;
#   - the target can only be an identity of OUR pool, because the handler
#     derives it from GetId and that call IS restricted, to this pool's ARN.
# Both arguments are therefore out of a caller's reach; only a code change
# could widen this, which is a weaker guarantee than an IAM boundary and is
# the reason it is spelled out here.
data "aws_iam_policy_document" "attach_lambda" {
  statement {
    sid       = "AttachPolicyAuthorizesOnTheTargetWhichHasNoArn"
    actions   = ["iot:AttachPolicy"]
    resources = ["*"]
  }
  statement {
    sid       = "DeriveCallerIdentityFromTheirToken"
    actions   = ["cognito-identity:GetId"]
    resources = [aws_cognito_identity_pool.console.arn]
  }
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${local.region}:${local.account}:*"]
  }
}

resource "aws_iam_role_policy" "attach_lambda" {
  name   = "${var.name_prefix}-iot-attach"
  role   = aws_iam_role.attach_lambda.id
  policy = data.aws_iam_policy_document.attach_lambda.json
}

# No VPC config: the function talks only to the public Cognito and IoT control
# planes. Putting it in the VPC would make it depend on the NAT/endpoints that
# destroy-billables removes — the exact coupling this design avoids.
resource "aws_lambda_function" "attach" {
  function_name    = "${var.name_prefix}-iot-policy-attach"
  role             = aws_iam_role.attach_lambda.arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = data.archive_file.attach_lambda.output_path
  source_code_hash = data.archive_file.attach_lambda.output_base64sha256
  timeout          = 10 # two control-plane calls
  memory_size      = 256

  environment {
    variables = {
      IDENTITY_POOL_ID = aws_cognito_identity_pool.console.id
      USER_POOL_ID     = var.user_pool_id
      IOT_POLICY_NAME  = aws_iot_policy.console_viewer.name
    }
  }
}

# 14 days: this log is for diagnosing a failed first sign-in, not an audit trail
# (the EDR/WORM evidence path is separate).
resource "aws_cloudwatch_log_group" "attach_lambda" {
  name              = "/aws/lambda/${aws_lambda_function.attach.function_name}"
  retention_in_days = 14
}
