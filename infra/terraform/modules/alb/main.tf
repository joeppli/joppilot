# =============================================================================
# ALB module — Application Load Balancer in front of the ECS service (M2-3b)
# =============================================================================
# Introduces the load-balancing layer the real services (M2-4) will sit behind:
# a target group with health checks and an HTTP listener. For the dev interim
# the ALB is internet-facing so it is browser-testable via its DNS name — the
# same "see it work" posture as the M2-2 nginx demo.
#
# End state (M2-3c): scheme flips to internal and API Gateway (WAF + Cognito
# authorizer) → VPC Link fronts it; ECS then never faces the internet directly.
#
# Cost: an ALB has a standing hourly charge (~$16/mo) + LCUs — it cannot scale
# to zero like a Fargate task. Tear it down with `terraform destroy` when idle.

# --- ALB security group: inbound :80, all outbound to targets -----------------
resource "aws_security_group" "alb" {
  name        = "${var.name_prefix}-alb-sg"
  description = "ALB inbound HTTP; forwards to ECS targets"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP in"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = var.ingress_cidrs
  }

  egress {
    description = "To targets"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.name_prefix}-alb-sg" }
}

resource "aws_lb" "this" {
  name               = "${var.name_prefix}-alb"
  internal           = var.internal
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.subnet_ids

  tags = { Name = "${var.name_prefix}-alb" }
}

# --- Target group: Fargate tasks register by IP (awsvpc networking) -----------
resource "aws_lb_target_group" "this" {
  name        = "${var.name_prefix}-tg"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = var.health_check_path
    matcher             = "200-399"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
  }

  tags = { Name = "${var.name_prefix}-tg" }
}

# --- HTTP listener → target group ---------------------------------------------
# HTTPS/ACM will terminate at API Gateway/CloudFront in front; the ALB itself
# stays HTTP behind that private boundary.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this.arn
  }
}
