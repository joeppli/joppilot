# =============================================================================
# ECS module — Fargate hello-world (M2-2, hardened in M2-3c-2)
# =============================================================================
# Proves Fargate works end to end. Since M2-3c-2 the task runs in PRIVATE
# subnets with NO public IP; the image comes from our private ECR and image
# pull / log delivery flow through the VPC endpoints (see the endpoints
# module). This is the same network posture the real services (M2-4) will use.
#
# Stop the task any time with desired_count = 0 (keeps the definition, drops cost).

data "aws_region" "current" {}

resource "aws_ecs_cluster" "this" {
  name = "${var.name_prefix}-cluster"
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "/ecs/${var.name_prefix}-hello"
  retention_in_days = 7
}

# --- Task execution role: lets ECS pull the image + write logs ---------------
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
  name               = "${var.name_prefix}-ecs-exec"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# --- Security group: inbound to the container port ----------------------------
# Behind an ALB (M2-3b) the task accepts HTTP only from inside the VPC (where the
# ALB lives); the standalone M2-2 demo (no ALB) stays world-open.
#
# WHY name_prefix + create_before_destroy: a SG attached to a running task's ENI
# cannot be deleted in place, and the repeated M2-3b applies left the original
# SG's rules in a tangled state (in-place rule edits hit NotFound / Duplicate).
# Standing up a FRESH SG and moving the service onto it before deleting the old
# one is a clean create with no rule reconciliation, which sidesteps all of that.
# name_prefix gives the new SG a unique name (create_before_destroy needs it).
#
# Rules are INLINE and use only values known at plan time: ingress is scoped to
# the VPC CIDR (data source below), NOT the ALB SG id (created in the same run,
# unknown at plan — an unknown SG reference trips a provider "inconsistent final
# plan" bug). Real service modules (M2-4) will scope ingress to the ALB SG
# directly, once those SGs exist across runs.
resource "aws_security_group" "this" {
  name_prefix = "${var.name_prefix}-hello-"
  description = "Hello-world container inbound"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP in (VPC-internal when behind the ALB)"
    from_port   = var.container_port
    to_port     = var.container_port
    protocol    = "tcp"
    cidr_blocks = [var.alb_security_group_id != null ? data.aws_vpc.this.cidr_block : "0.0.0.0/0"]
  }

  egress {
    description = "All outbound (image pull, logs)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.name_prefix}-hello-sg" }

  lifecycle {
    create_before_destroy = true
  }
}

data "aws_vpc" "this" {
  id = var.vpc_id
}

# --- Task definition + service ------------------------------------------------
resource "aws_ecs_task_definition" "this" {
  family                   = "${var.name_prefix}-hello"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.cpu)
  memory                   = tostring(var.memory)
  execution_role_arn       = aws_iam_role.execution.arn

  container_definitions = jsonencode([{
    name         = "hello"
    image        = var.container_image
    essential    = true
    portMappings = [{ containerPort = var.container_port, protocol = "tcp" }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.this.name
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "hello"
      }
    }
  }])
}

resource "aws_ecs_service" "this" {
  name            = "${var.name_prefix}-hello"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.subnet_ids
    security_groups = [aws_security_group.this.id]
    # Private subnets, no public IP (M2-3c-2). The task's only egress need is
    # the AWS APIs (ECR image pull, CloudWatch logs), reached through the VPC
    # endpoints — see the endpoints module.
    assign_public_ip = false
  }

  # Register into the ALB target group when one is provided (M2-3b).
  dynamic "load_balancer" {
    for_each = var.target_group_arn != null ? [1] : []
    content {
      target_group_arn = var.target_group_arn
      container_name   = "hello"
      container_port   = var.container_port
    }
  }

  # Give the container time to boot before the ALB starts failing it (LB only).
  health_check_grace_period_seconds = var.target_group_arn != null ? 30 : null

  # Start/stop the task manually (AWS CLI / console) without a code change or PR.
  # Terraform sets the INITIAL count on create, then ignores it — it won't revert
  # your manual scaling. Same pattern will apply to the real services in M2-4.
  lifecycle {
    ignore_changes = [desired_count]
  }
}
