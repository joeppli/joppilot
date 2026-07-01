# =============================================================================
# Cognito module — identity, MFA, RBAC groups (M2-3a)
# =============================================================================
# Amazon Cognito is the managed identity provider (AD-13, SEC-03). This is the
# cheap, free-tier-first slice of M2-3: it has NO standing cost (Cognito free
# tier covers 50k MAU; the hosted-UI domain, groups and TOTP MFA are all free),
# and it is independent of the ALB / API Gateway networking spine that follows.
#
# Policy realised here:
#   - Invite-only: operators cannot self-register; a Super Admin creates them.
#   - MFA required (SEC-03) via TOTP software token — no SMS, so no SNS cost.
#   - group -> role: the pool has one group per ICD/architecture role. Cognito
#     stamps the user's groups into the `cognito:groups` JWT claim; the backend
#     RBAC guard maps that claim to a role. No pre-token Lambda needed (AD-10).
#
# The API Gateway Cognito authorizer (later M2-3 PR) validates tokens against
# this pool's issuer URL + the app-client id (the token audience).

data "aws_region" "current" {}

resource "aws_cognito_user_pool" "this" {
  name = "${var.name_prefix}-users"

  # Sign in with email; email is auto-verified and used for account recovery.
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # Invite-only: only an admin (Super Admin) can create users. This disables
  # public self sign-up entirely.
  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  # MFA required for everyone (SEC-03), TOTP only — no SMS/SNS spend.
  mfa_configuration = var.mfa_configuration
  software_token_mfa_configuration {
    enabled = true
  }

  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # ACTIVE blocks deletion of the pool (and every user in it). dev defaults to
  # INACTIVE for easy teardown; set the variable to ACTIVE in prod.
  deletion_protection = var.deletion_protection

  # Threat protection: compromised-credential detection + adaptive/risk-based
  # auth. Billed per MAU when AUDIT/ENFORCED, so dev defaults to OFF; flipping
  # the variable to ENFORCED in prod is the only change needed.
  user_pool_add_ons {
    advanced_security_mode = var.advanced_security_mode
  }

  tags = { Name = "${var.name_prefix}-users" }
}

# --- Hosted-UI domain (free) — enables the OAuth login page for the SPA --------
resource "aws_cognito_user_pool_domain" "this" {
  domain       = var.domain_prefix
  user_pool_id = aws_cognito_user_pool.this.id
}

# --- RBAC groups: the two operator personas from architecture C4-L1 -----------
# Lower precedence = higher priority when a user is in several groups. `admin`
# folds in the Super Admin duties (full authority); `operator` covers live
# monitoring, Mode 1 supervision, Mode 2 remote driving (permitted zones) and
# diagnostics. Groups are stamped into the `cognito:groups` JWT claim.
locals {
  groups = {
    "admin"    = { precedence = 0, description = "Full authority: user/vehicle/role management, emergency control." }
    "operator" = { precedence = 10, description = "Live monitoring, Mode 1 supervision, Mode 2 remote driving (permitted zones), diagnostics." }
  }
}

resource "aws_cognito_user_group" "roles" {
  for_each = local.groups

  name         = each.key
  user_pool_id = aws_cognito_user_pool.this.id
  precedence   = each.value.precedence
  description  = each.value.description
}

# --- App client: the SPA (public client, no secret) ---------------------------
resource "aws_cognito_user_pool_client" "spa" {
  name         = "${var.name_prefix}-console"
  user_pool_id = aws_cognito_user_pool.this.id

  # SPA is a public client — it cannot keep a secret.
  generate_secret = false

  # SRP for programmatic login; refresh for silent token renewal. No flow that
  # sends the raw password over the wire (no USER_PASSWORD_AUTH).
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  # Hosted-UI OAuth (authorization-code flow) as an alternative to SRP.
  supported_identity_providers         = ["COGNITO"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  callback_urls                        = var.callback_urls
  logout_urls                          = var.logout_urls

  # Don't reveal whether an email exists on failed login.
  prevent_user_existence_errors = "ENABLED"

  access_token_validity  = var.access_token_validity_minutes
  id_token_validity      = var.id_token_validity_minutes
  refresh_token_validity = var.refresh_token_validity_days
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}
