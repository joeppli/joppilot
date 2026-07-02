# =============================================================================
# ALB module — internal Application Load Balancer behind API Gateway (M2-3b/3c)
# =============================================================================
# The load-balancing layer the real services (M2-4) will sit behind: a target
# group with health checks and an HTTP listener. INTERNAL since M2-3c-1b
# (AD-19): it lives in private subnets, resolves to private IPs, and answers
# only from inside the VPC — API Gateway (JWT authorizer) → VPC Link is the
# single public entry point.
#
# Cost: an ALB has a standing hourly charge (~$16/mo) + LCUs — it cannot scale
# to zero like a Fargate task. Tear it down with `terraform destroy` when idle.

# --- ALB security group: inbound :80 from the VPC, all outbound to targets ----
# The M2-3c-1b tightening (0.0.0.0/0 → VPC CIDR) is an IN-PLACE rule edit: the
# SG itself is deliberately NOT replaced, so its id stays known at plan time and
# no unknown value ripples into the ECS module's rules (the M2-3b
# "inconsistent final plan" trap).
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

# WHY name_prefix + create_before_destroy: the internet-facing → internal flip
# (M2-3c-1b) changes the LB scheme, which AWS cannot mutate in place — Terraform
# must REPLACE the load balancer. create_before_destroy stands the new internal
# ALB up before the old one is destroyed, so the listener/WAF/API-GW integration
# can cut over without the stack ever losing its ALB. Both ALBs briefly coexist,
# so their names must differ: name_prefix (AWS caps it at 6 chars for LBs)
# generates a unique name; the console-friendly name lives on the Name tag.
resource "aws_lb" "this" {
  name_prefix        = substr(var.name_prefix, 0, 6) # "joppil…" — 6-char AWS limit
  internal           = var.internal
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.subnet_ids

  tags = { Name = "${var.name_prefix}-alb" }

  lifecycle {
    create_before_destroy = true
  }
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

# --- WAF (regional) on the ALB (M2-3c) ----------------------------------------
# The architecture puts WAF on API Gateway, but WAF only attaches to API Gateway
# REST APIs (which would force an NLB via VPC Link). With the chosen HTTP API,
# WAF is attached to the ALB instead — every request still flows API Gateway →
# VPC Link → ALB, so the same traffic is inspected. Toggle with var.enable_waf.
resource "aws_wafv2_web_acl" "this" {
  count = var.enable_waf ? 1 : 0
  name  = "${var.name_prefix}-alb-waf"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "common-rules"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.name_prefix}-common-rules"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.name_prefix}-alb-waf"
    sampled_requests_enabled   = true
  }

  tags = { Name = "${var.name_prefix}-alb-waf" }
}

resource "aws_wafv2_web_acl_association" "this" {
  count        = var.enable_waf ? 1 : 0
  resource_arn = aws_lb.this.arn
  web_acl_arn  = aws_wafv2_web_acl.this[0].arn
}
