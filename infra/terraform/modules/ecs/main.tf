# =============================================================================
# ECS module — Fargate hello-world (M2-2)
# =============================================================================
# Proves Fargate works end to end. Cheapest posture: the task runs in a PUBLIC
# subnet with a public IP (no NAT, no VPC endpoints) and pulls a public image.
# Real services (M2-4) will instead run in private subnets behind the ALB (M2-3).
#
# Inbound :80 is open to the world for the demo only — there is no ALB yet.
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

# --- Security group: allow inbound to the container port (demo only) ----------
resource "aws_security_group" "this" {
  name        = "${var.name_prefix}-hello-sg"
  description = "Hello-world container inbound (demo only, no ALB yet)"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP demo"
    from_port   = var.container_port
    to_port     = var.container_port
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "All outbound (image pull, logs)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.name_prefix}-hello-sg" }
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
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.this.id]
    assign_public_ip = true
  }
}
