# =============================================================================
# RDS PostgreSQL module — the relational database (M2-4-2, interim for AD-14)
# =============================================================================
# INTERIM DEVIATION FROM AD-14 (recorded in the architecture doc): the account
# is on the AWS FREE PLAN, which only allows Aurora as an "express
# configuration" cluster — VPC-less, public-internet-gateway-only, IAM-auth-
# only. That contradicts the entire network posture (nothing public but API
# Gateway) and SEC-02 (no CMK), so instead of Aurora we run a single free-tier
# RDS PostgreSQL instance (db.t4g.micro) INSIDE the VPC with the same security
# properties. CLOSURE: when the account upgrades to a paid plan, this module is
# replaced by the Aurora Serverless v2 module (kept in git history, PR #23) —
# data is reproducible from the committed Prisma migrations, so the swap is
# cheap. Everything the services see (private Postgres endpoint + RDS-managed
# Secrets Manager secret) is identical between the two.
#
# One database, shared by command and fleet with SEPARATE Postgres schemas
# (?schema=command / ?schema=fleet in each service's DSN).
#
# STATEFUL — PERMANENT RULE: never added to the terraform-destroy-billables
# targets. db.t4g.micro is inside the free plan's RDS allowance (750 h/mo,
# 20 GB) so there is little to save anyway; if needed the instance can be
# stopped by hand for up to 7 days (`aws rds stop-db-instance`), after which
# AWS restarts it automatically. Guards against accidental deletion:
#   - deletion_protection = true (the RDS API refuses a delete until flipped)
#   - the destroy workflow simply never targets module.rds
#
# Credentials: manage_master_user_password = true hands the master password to
# an RDS-MANAGED Secrets Manager secret — free (unlike self-created secrets),
# never in Terraform state as plaintext, rotatable by RDS. ECS task definitions
# (M2-4-3) inject username/password from it via valueFrom JSON-key selectors;
# tasks reach Secrets Manager through the secretsmanager VPC endpoint
# (modules/endpoints).
#
# Encryption (SEC-02): storage encrypted with a dedicated customer-managed KMS
# key (~$1/mo) — rotatable and auditable, unlike the shared aws/rds default.

# --- KMS CMK: storage encryption key (SEC-02 — managed and rotatable) --------
resource "aws_kms_key" "db" {
  description         = "${var.name_prefix}-db storage encryption (SEC-02)"
  enable_key_rotation = true

  tags = { Name = "${var.name_prefix}-db-kms" }
}

resource "aws_kms_alias" "db" {
  name          = "alias/${var.name_prefix}-db"
  target_key_id = aws_kms_key.db.key_id
}

# --- Placement: private subnets only, PostgreSQL reachable from the VPC ------
resource "aws_db_subnet_group" "db" {
  name       = "${var.name_prefix}-db"
  subnet_ids = var.subnet_ids

  tags = { Name = "${var.name_prefix}-db-subnets" }
}

resource "aws_security_group" "db" {
  name_prefix = "${var.name_prefix}-db-"
  description = "RDS PostgreSQL: access only from the service task SGs"
  vpc_id      = var.vpc_id

  # DEV-6 CLOSED (M2-4-3): no inline VPC-wide ingress anymore. Ingress rules
  # live as STANDALONE resources below, one per allowed task SG — standalone
  # rules tolerate plan-time-unknown SG ids (the service SGs are created in
  # the same run), which inline rules famously don't ("inconsistent final
  # plan", see the ecs module comment). Never mix inline and standalone rules
  # on the same SG.

  tags = { Name = "${var.name_prefix}-db-sg" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "from_tasks" {
  for_each = var.allowed_security_group_ids

  security_group_id            = aws_security_group.db.id
  description                  = "PostgreSQL from ${each.key}"
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  referenced_security_group_id = each.value
}

# --- The instance ---------------------------------------------------------------
resource "aws_db_instance" "db" {
  identifier     = "${var.name_prefix}-db"
  engine         = "postgres"
  engine_version = var.engine_version
  # Must stay enabled for the major-version-prefix engine_version above to be
  # valid (see the variable comment); also keeps retired minors from piling up.
  auto_minor_version_upgrade = true
  instance_class             = var.instance_class
  db_name                    = var.database_name

  username                    = var.master_username
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.db.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = false # free-plan / dev posture; multi-AZ is a paid-plan concern

  # Free-plan RDS allowance: 20 GB gp3. Autoscaling stays off so storage can
  # never silently grow past the free allowance.
  allocated_storage = var.allocated_storage_gb
  storage_type      = "gp3"

  storage_encrypted = true
  kms_key_id        = aws_kms_key.db.arn

  backup_retention_period      = var.backup_retention_days
  deletion_protection          = true
  performance_insights_enabled = false
  # deletion_protection above is the real guard; skipping the final snapshot
  # only takes effect after someone deliberately flips protection off first.
  skip_final_snapshot = true
  apply_immediately   = true

  tags = { Name = "${var.name_prefix}-db" }
}
