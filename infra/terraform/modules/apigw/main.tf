# =============================================================================
# API Gateway (HTTP API) — public front door with Cognito auth (M2-3c)
# =============================================================================
# The single public entry point (AD-19). Requests flow:
#   client → HTTP API (JWT authorizer) → VPC Link → internal ALB → ECS
# A JWT authorizer validates the Cognito access token (issuer + audience) before
# any request reaches the private integration. WAF sits on the ALB (see the alb
# module) because HTTP APIs don't support a WAF association directly.
#
# HTTP API is used (not REST) for the free VPC Link + lower cost; the trade-off
# (WAF on the ALB rather than the API) is documented in the alb module.

# --- VPC Link: gives the managed HTTP API private access into the VPC ----------
resource "aws_security_group" "vpclink" {
  name_prefix = "${var.name_prefix}-vpclink-"
  description = "API Gateway VPC Link egress to the internal ALB"
  vpc_id      = var.vpc_id

  egress {
    description = "To the ALB within the VPC"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = [var.vpc_cidr]
  }

  tags = { Name = "${var.name_prefix}-vpclink-sg" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_apigatewayv2_vpc_link" "this" {
  name               = "${var.name_prefix}-vpclink"
  security_group_ids = [aws_security_group.vpclink.id]
  subnet_ids         = var.subnet_ids
}

# --- HTTP API + JWT (Cognito) authorizer --------------------------------------
resource "aws_apigatewayv2_api" "this" {
  name          = "${var.name_prefix}-http-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.this.id
  name             = "${var.name_prefix}-cognito"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    audience = [var.cognito_client_id]
    issuer   = var.cognito_issuer_url
  }
}

# --- Private integration to the ALB via the VPC Link --------------------------
resource "aws_apigatewayv2_integration" "alb" {
  api_id             = aws_apigatewayv2_api.this.id
  integration_type   = "HTTP_PROXY"
  integration_method = "ANY"
  integration_uri    = var.alb_listener_arn
  connection_type    = "VPC_LINK"
  connection_id      = aws_apigatewayv2_vpc_link.this.id
}

# Catch-all route (matches every method + path, including "/"), protected by the
# Cognito authorizer.
resource "aws_apigatewayv2_route" "proxy" {
  api_id             = aws_apigatewayv2_api.this.id
  route_key          = "$default"
  target             = "integrations/${aws_apigatewayv2_integration.alb.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# Auto-deploying default stage → the api_endpoint is directly invokable.
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true
}
