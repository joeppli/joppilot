# =============================================================================
# Aurora Serverless v2 module — the relational database (M2-4-2, AD-14)
# =============================================================================
# One Aurora PostgreSQL cluster, shared by the command and fleet services with
# SEPARATE Postgres schemas (?schema=command / ?schema=fleet in each service's
# DSN) — one cluster to pay for, no cross-service table collisions.
#
# STATEFUL — PERMANENT RULE: this module is NEVER added to the
# terraform-destroy-billables targets. Destroying it deletes operational data;
# the saving is handled by Serverless v2 auto-pause instead (min 0 ACU: after
# `seconds_until_auto_pause` with no connections the cluster suspends and bills
# STORAGE ONLY — cents/month at dev size). Resume on first connection takes
# ~15s; clients must tolerate/retry that first hit (Prisma retries connect).
# Two belt-and-suspenders guards against accidental deletion:
#   - deletion_protection = true (the RDS API refuses a delete until flipped)
#   - the destroy workflow simply never targets module.aurora
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
resource "aws_kms_key" "aurora" {
  description         = "${var.name_prefix}-aurora storage encryption (SEC-02)"
  enable_key_rotation = true

  tags = { Name = "${var.name_prefix}-aurora-kms" }
}

resource "aws_kms_alias" "aurora" {
  name          = "alias/${var.name_prefix}-aurora"
  target_key_id = aws_kms_key.aurora.key_id
}

# --- Placement: private subnets only, PostgreSQL reachable from the VPC ------
resource "aws_db_subnet_group" "aurora" {
  name       = "${var.name_prefix}-aurora"
  subnet_ids = var.subnet_ids

  tags = { Name = "${var.name_prefix}-aurora-subnets" }
}

resource "aws_security_group" "aurora" {
  name_prefix = "${var.name_prefix}-aurora-"
  description = "Aurora: PostgreSQL from inside the VPC"
  vpc_id      = var.vpc_id

  # Dev posture: any VPC-internal caller. M2-4-3 tightens this to the service
  # task SGs once the real services (and their SGs) exist.
  ingress {
    description = "PostgreSQL from the VPC"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  tags = { Name = "${var.name_prefix}-aurora-sg" }

  lifecycle {
    create_before_destroy = true
  }
}

# --- The cluster ---------------------------------------------------------------
resource "aws_rds_cluster" "aurora" {
  cluster_identifier = "${var.name_prefix}-aurora"
  engine             = "aurora-postgresql"
  engine_mode        = "provisioned" # Serverless v2 runs under provisioned mode
  engine_version     = var.engine_version
  database_name      = var.database_name

  master_username             = var.master_username
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.aurora.name
  vpc_security_group_ids = [aws_security_group.aurora.id]

  storage_encrypted = true
  kms_key_id        = aws_kms_key.aurora.arn

  # min 0 ACU requires aurora-postgresql >= 15.7 / 16.3.
  serverlessv2_scaling_configuration {
    min_capacity             = var.min_acu
    max_capacity             = var.max_acu
    seconds_until_auto_pause = var.seconds_until_auto_pause
  }

  backup_retention_period = var.backup_retention_days
  deletion_protection     = true
  # deletion_protection above is the real guard; skipping the final snapshot
  # only takes effect after someone deliberately flips protection off first.
  skip_final_snapshot = true
  apply_immediately   = true

  tags = { Name = "${var.name_prefix}-aurora" }
}

# Single serverless writer — dev scale (OPS-01). The Zurich DR replica
# (architecture §8) is a later, deliberate step.
resource "aws_rds_cluster_instance" "writer" {
  identifier          = "${var.name_prefix}-aurora-1"
  cluster_identifier  = aws_rds_cluster.aurora.id
  instance_class      = "db.serverless"
  engine              = aws_rds_cluster.aurora.engine
  engine_version      = aws_rds_cluster.aurora.engine_version
  publicly_accessible = false

  tags = { Name = "${var.name_prefix}-aurora-1" }
}
