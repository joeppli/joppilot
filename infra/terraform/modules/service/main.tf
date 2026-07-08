# =============================================================================
# Service module — one real Joppilot service on Fargate (M2-4-3)
# =============================================================================
# Generic per-service unit: task definition + service in the PRIVATE subnets
# (same posture the hello-world proved in M2-3c-2), its own target group and a
# path-based listener rule on the shared internal ALB, and a task SG that
# accepts traffic ONLY from the ALB SG (possible now, cross-run — the
# "unknown SG at plan time" trap only applied to same-run references, see the
# ecs module comment).
#
# Secrets: DB credentials are injected via valueFrom JSON-key selectors from
# the RDS-managed Secrets Manager secret — never plaintext in the task
# definition or Terraform state. The execution role gets GetSecretValue on
# exactly that one secret (KMS decrypt not needed: the secret uses the
# aws/secretsmanager service key and decryption happens server-side).
#
# Cost: a task is billed while desired_count > 0. Terraform only sets the
# INITIAL count (lifecycle.ignore_changes) — scale to 0 by hand when idle,
# same as hello-world. The destroy-billables workflow targets these modules.

data "aws_region" "current" {}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${var.name_prefix}-${var.service_name}"
  retention_in_days = 7
}

# --- Task execution role: image pull + logs + read the DB secret --------------
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${var.name_prefix}-${var.service_name}-exec"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "secrets" {
  count = length(var.secret_arns) > 0 ? 1 : 0
  name  = "${var.name_prefix}-${var.service_name}-secrets"
  role  = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = var.secret_arns
    }]
  })
}

# --- Task security group: inbound ONLY from the ALB ---------------------------
resource "aws_security_group" "task" {
  name_prefix = "${var.name_prefix}-${var.service_name}-"
  description = "${var.service_name} task: inbound only from the ALB"
  vpc_id      = var.vpc_id

  ingress {
    description     = "Container port from the ALB SG"
    from_port       = var.container_port
    to_port         = var.container_port
    protocol        = "tcp"
    security_groups = [var.alb_security_group_id]
  }

  egress {
    description = "All outbound (VPC endpoints, RDS, Valkey)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.name_prefix}-${var.service_name}-sg" }

  lifecycle {
    create_before_destroy = true
  }
}

# --- Target group + path-based listener rule on the shared internal ALB -------
resource "aws_lb_target_group" "this" {
  # AWS caps TG names at 32 chars; keep it tight.
  name        = "${var.name_prefix}-${var.service_name}"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/healthz"
    matcher             = "200"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
  }

  tags = { Name = "${var.name_prefix}-${var.service_name}-tg" }
}

resource "aws_lb_listener_rule" "this" {
  listener_arn = var.alb_listener_arn
  priority     = var.listener_rule_priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }

  condition {
    path_pattern {
      values = var.path_patterns # max 5 per condition (AWS limit)
    }
  }

  tags = { Name = "${var.name_prefix}-${var.service_name}-rule" }
}

# --- Task definition + service -------------------------------------------------
resource "aws_ecs_task_definition" "this" {
  family                   = "${var.name_prefix}-${var.service_name}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.cpu)
  memory                   = tostring(var.memory)
  execution_role_arn       = aws_iam_role.execution.arn

  container_definitions = jsonencode([{
    name         = var.service_name
    image        = var.container_image
    essential    = true
    portMappings = [{ containerPort = var.container_port, protocol = "tcp" }]
    environment  = [for k, v in var.environment : { name = k, value = v }]
    secrets      = [for k, v in var.secrets : { name = k, valueFrom = v }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.this.name
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = var.service_name
      }
    }
  }])
}

resource "aws_ecs_service" "this" {
  name            = "${var.name_prefix}-${var.service_name}"
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = false # private subnets; AWS APIs via VPC endpoints
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.this.arn
    container_name   = var.service_name
    container_port   = var.container_port
  }

  # Container boot includes `prisma migrate deploy` (entrypoint) — give it
  # room before the ALB health check starts counting failures.
  health_check_grace_period_seconds = 60

  # Terraform sets the INITIAL count, then ignores it: scale to 0/1 by hand
  # (AWS CLI/console) without a code change or PR — same as hello-world.
  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [aws_lb_listener_rule.this]
}
