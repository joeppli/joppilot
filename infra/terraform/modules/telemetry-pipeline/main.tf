# =============================================================================
# telemetry-pipeline module — M3-4a (AD-14, RTP-02/03)
# =============================================================================
# Serverless telemetry persistence:
#   IoT Topic Rule (joppilot/v1/vehicles/+/telemetry) → SQS → Lambda (BATCH)
#   → RDS telemetry_samples (raw multi-row INSERT, ORM bypassed per AD-14).
#
# Why SQS in the middle: an IoT Rule invokes a Lambda once PER MESSAGE; the
# queue + event-source mapping is what turns a 10 Hz stream into the "Lambda
# batch" the timeline (M3-4) prescribes — up to `batch_size` samples per
# invoke, one INSERT per invoke, and a DLQ so a poisoned message can never
# wedge the stream.
#
# Single-writer rule: with this pipeline live, the ECS telemetry service runs
# TELEMETRY_PERSIST=false (envs/dev) — it keeps the live Socket.IO broadcast +
# link-loss monitoring, the Lambda owns persistence. Persistence therefore
# survives the Fargate task being scaled to 0 (the overnight cost posture).
#
# COST / DESTROY-BUTTON: no standing cost — SQS + Lambda + IoT Rules bill per
# request/invoke (free tier: 1M SQS requests, 1M Lambda invokes / month; IoT
# Rules ~$0.15/M evaluated). Idle ≈ $0 → NOT a destroy-billables target (same
# rule as module.iot). The VPC-attached Lambda ENI is free.
# DEV-12: probe IoT Rules + Lambda + SQS availability on the free account plan
# BEFORE the first apply (same drill as IoT Core / Greengrass).

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  region  = data.aws_region.current.name
  account = data.aws_caller_identity.current.account_id
  name    = "${var.name_prefix}-telemetry-ingest"
}

# -----------------------------------------------------------------------------
# SQS: ingest queue + DLQ
# -----------------------------------------------------------------------------
resource "aws_sqs_queue" "dlq" {
  name = "${local.name}-dlq"
  # Poisoned samples stay inspectable for two weeks, then age out.
  message_retention_seconds = 14 * 24 * 3600
}

resource "aws_sqs_queue" "ingest" {
  name = local.name
  # Telemetry is only useful fresh (RTP-08: no buffer-and-replay for live
  # control); an hour of retention covers a Lambda outage without hoarding.
  message_retention_seconds  = 3600
  visibility_timeout_seconds = 60 # ≥ 6× the Lambda timeout below (AWS guidance)

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 3
  })
}

# -----------------------------------------------------------------------------
# IoT Topic Rule → SQS (+ CloudWatch error action)
# -----------------------------------------------------------------------------
data "aws_iam_policy_document" "iot_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["iot.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "rule" {
  name               = "${local.name}-rule"
  assume_role_policy = data.aws_iam_policy_document.iot_assume.json
}

resource "aws_iam_role_policy" "rule_sqs" {
  name = "sqs-send"
  role = aws_iam_role.rule.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.ingest.arn
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.rule_errors.arn}:*"
      },
    ]
  })
}

resource "aws_cloudwatch_log_group" "rule_errors" {
  name              = "/iot/${local.name}-rule-errors"
  retention_in_days = 14
}

# Rule names only allow [a-zA-Z0-9_] — hence the replace().
resource "aws_iot_topic_rule" "telemetry" {
  name        = replace("${local.name}-rule", "-", "_")
  enabled     = true
  sql         = "SELECT * FROM '${var.topic_root}/vehicles/+/telemetry'"
  sql_version = "2016-03-23"

  sqs {
    queue_url  = aws_sqs_queue.ingest.id
    role_arn   = aws_iam_role.rule.arn
    use_base64 = false
  }

  # A rule that cannot deliver must not fail silently (same honesty rule as
  # the command path, audit-7): errors land in CloudWatch.
  error_action {
    cloudwatch_logs {
      log_group_name = aws_cloudwatch_log_group.rule_errors.name
      role_arn       = aws_iam_role.rule.arn
    }
  }
}

# -----------------------------------------------------------------------------
# Lambda: VPC-attached batch writer
# -----------------------------------------------------------------------------
# Private subnets: reaches RDS in-VPC and Secrets Manager via the existing VPC
# endpoint — no NAT, no internet route (network posture preserved). The event-
# source polling happens on the Lambda service side, so no egress is needed.
resource "aws_security_group" "lambda" {
  name_prefix = "${local.name}-"
  description = "telemetry-ingest Lambda (egress only; RDS ingress references this SG)"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  lifecycle {
    create_before_destroy = true
  }
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = local.name
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy" "lambda" {
  name = "ingest"
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = aws_sqs_queue.ingest.arn
      },
      {
        # DB credentials — the RDS-managed master secret (aws/secretsmanager
        # managed key: GetSecretValue alone suffices, decryption is server-side
        # — same pattern as the ECS task execution roles).
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = var.db_secret_arn
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${local.region}:${local.account}:log-group:/aws/lambda/${local.name}*"
      },
      {
        # VPC attachment (ENI lifecycle) — the managed-policy equivalent, inline.
        Effect   = "Allow"
        Action   = ["ec2:CreateNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DeleteNetworkInterface"]
        Resource = "*"
      },
    ]
  })
}

# The zip is built from the committed source; `npm ci` runs in the terraform
# workflow first so node_modules exists at plan time (pg is the only dep).
data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = "${path.module}/../../../lambda/telemetry-ingest"
  output_path = "${path.module}/.build/telemetry-ingest.zip"
  excludes    = ["package-lock.json", ".build"]
}

resource "aws_lambda_function" "ingest" {
  function_name    = local.name
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = 10  # one multi-row INSERT; visibility timeout is 6× this
  memory_size      = 192 # pg + a 100-row batch: small

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      DB_HOST       = var.db_host
      DB_PORT       = tostring(var.db_port)
      DB_NAME       = var.db_name
      DB_SECRET_ARN = var.db_secret_arn
    }
  }
}

resource "aws_lambda_event_source_mapping" "sqs" {
  event_source_arn = aws_sqs_queue.ingest.arn
  function_name    = aws_lambda_function.ingest.arn
  # The BATCH (timeline M3-4): up to 100 samples or 5 s of gathering per
  # invoke — at the sim's 10 Hz that is ~2 invokes/s worst case, one INSERT each.
  batch_size                         = 100
  maximum_batching_window_in_seconds = 5
  function_response_types            = ["ReportBatchItemFailures"]

  # db.t4g.micro protection: at most 2 concurrent writers from this path
  # (matches the ECS writer's pool discipline).
  scaling_config {
    maximum_concurrency = 2
  }
}
