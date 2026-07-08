# =============================================================================
# Valkey module — ElastiCache Serverless Valkey (M2-4-3, AD "cache/session/lock")
# =============================================================================
# Backs the single-operator fencing lock (SEC-05) for the command service.
#
# WHY serverless (vs a cache.t4g.micro node): lowest entry cost for Valkey
# (100 MB storage floor ≈ $6/mo vs ~$12/mo for the smallest node), no
# node/AZ management, and — unlike RDS — the cache is EPHEMERAL by design
# (locks live 6 s), so it is safe to put in the destroy-billables button and
# recreate at will. NOTE (DEV-12 pattern): if the free account plan refuses
# serverless ElastiCache at apply time, fall back to a node-based
# aws_elasticache_cluster (cache.t4g.micro) — the services only need
# REDIS_HOST/REDIS_PORT/REDIS_TLS either way.
#
# TLS: serverless caches are TLS-ONLY. The services already support this via
# REDIS_TLS=true (SEC-02 in-transit encryption comes for free here).
#
# COST GUARDRAILS: usage limits cap the bill — 1 GB storage and 3000 ECPU/s
# are far above what 6-second locks for ~10 vehicles can consume, but they
# put a ceiling under any runaway/bug scenario.

resource "aws_security_group" "valkey" {
  name_prefix = "${var.name_prefix}-valkey-"
  description = "Valkey: inbound only from allowed task SGs"
  vpc_id      = var.vpc_id

  egress {
    description = "None needed, but keep SG semantics simple"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.name_prefix}-valkey-sg" }

  lifecycle {
    create_before_destroy = true
  }
}

# Standalone ingress rules (not inline): the allowed SGs are created in the
# same run, and standalone rule resources tolerate plan-time-unknown SG ids —
# inline rules were the source of the M2-3b "inconsistent final plan" trap.
resource "aws_vpc_security_group_ingress_rule" "from_tasks" {
  for_each = var.allowed_security_group_ids

  security_group_id            = aws_security_group.valkey.id
  description                  = "Valkey TLS from ${each.key}"
  from_port                    = 6379
  to_port                      = 6379
  ip_protocol                  = "tcp"
  referenced_security_group_id = each.value
}

resource "aws_elasticache_serverless_cache" "this" {
  name   = "${var.name_prefix}-valkey"
  engine = "valkey"

  major_engine_version = "8"
  security_group_ids   = [aws_security_group.valkey.id]
  subnet_ids           = var.subnet_ids

  cache_usage_limits {
    data_storage {
      maximum = 1
      unit    = "GB"
    }
    ecpu_per_second {
      maximum = 3000
    }
  }

  description = "Joppilot fencing-lock cache (SEC-05); ephemeral, destroy-billables-safe"

  tags = { Name = "${var.name_prefix}-valkey" }
}
