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

  # Browser CORS (M3-4c): the operator console is a cross-origin SPA that calls
  # the command/maneuver/fleet routes with a Cognito Bearer token. HTTP APIs
  # answer the preflight OPTIONS themselves (the JWT authorizer is NOT invoked
  # for preflight), so the console can send Authorization on the real request.
  # allow_credentials stays false — auth rides in the header, not cookies.
  # Origins are passed in (dev: http://localhost:3000; add the CloudFront domain
  # when the SPA is hosted — AD-19). No CORS is emitted when the list is empty.
  cors_configuration {
    allow_origins = var.cors_allow_origins
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 300
  }
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

# Catch-all route protected by the Cognito authorizer. Deliberately NOT
# "$default": the automatic CORS preflight response skips routing EXCEPT for
# $default, where the OPTIONS request would reach the JWT authorizer and 401 —
# blocking every browser call. "ANY /{proxy+}" matches everything but "/".
resource "aws_apigatewayv2_route" "proxy" {
  api_id             = aws_apigatewayv2_api.this.id
  route_key          = "ANY /{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.alb.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# AWS-documented CORS fix (verified live 2026-07-14): the JWT-protected
# catch-all above also catches preflight OPTIONS and 401s them before the
# API-level cors_configuration can answer. This higher-priority OPTIONS route
# WITHOUT auth lets preflights through; API Gateway's CORS config then answers
# valid ones automatically (a non-preflight OPTIONS falls through to the ALB).
resource "aws_apigatewayv2_route" "cors_preflight" {
  api_id             = aws_apigatewayv2_api.this.id
  route_key          = "OPTIONS /{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.alb.id}"
  authorization_type = "NONE"
}

# Auto-deploying default stage → the api_endpoint is directly invokable.
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true
}

# --- C3: the DEV-23 IoT-policy attach route (closes DEV-23) --------------------
# A Lambda integration sitting behind the SAME Cognito authorizer as everything
# else, but NOT behind the VPC Link — so it does not touch the ALB or ECS. That
# matters: destroy-billables removes ALB/ECS while IoT and Cognito stay up, and
# an operator signing in during that window still gets a working attach (and
# therefore live telemetry) even though commands are disabled.
#
# ROUTING: "POST /api/iot/attach-policy" is more specific than the catch-all
# "ANY /{proxy+}", and API Gateway picks the most specific match, so this route
# wins without touching the proxy route. The OPTIONS preflight keeps falling
# through to the existing unauthenticated OPTIONS route.
#
# The function lives in module.console_identity so it survives the teardown;
# only this route is recreated with the API. Both inputs are required: gating
# these resources on `invoke_arn != ""` would put an apply-time value in a
# count, which Terraform refuses to plan.
resource "aws_apigatewayv2_integration" "iot_attach" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.iot_attach_lambda_invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "iot_attach" {
  api_id             = aws_apigatewayv2_api.this.id
  route_key          = "POST /api/iot/attach-policy"
  target             = "integrations/${aws_apigatewayv2_integration.iot_attach.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

# The preflight needs its OWN route. "POST /api/iot/attach-policy" does not
# match an OPTIONS request, so the preflight falls to "OPTIONS /{proxy+}" above,
# which targets the ALB — and the ALB has no backend for this path, so it
# answers 503 and the browser rejects the preflight before sending the POST.
# Pointing it at the same Lambda (which returns 204 for OPTIONS) keeps the
# preflight off the ECS path entirely, so it also works while ECS is torn down.
# NONE, like the catch-all preflight route: a preflight carries no Authorization
# header, so requiring JWT here would 401 every browser call.
resource "aws_apigatewayv2_route" "iot_attach_preflight" {
  api_id             = aws_apigatewayv2_api.this.id
  route_key          = "OPTIONS /api/iot/attach-policy"
  target             = "integrations/${aws_apigatewayv2_integration.iot_attach.id}"
  authorization_type = "NONE"
}

# Scoped to this API's execution ARN so no other API can invoke the function.
# The method wildcard covers both the POST and the OPTIONS route above.
resource "aws_lambda_permission" "iot_attach" {
  statement_id  = "AllowInvokeFromHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = var.iot_attach_lambda_function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*/api/iot/attach-policy"
}
