# Values for this environment. Defaults in variables.tf already match dev, so this
# file is mostly here as the place to override per-environment settings later.
aws_region  = "eu-central-1"
environment = "dev"

# Cost guardrail — alerts emailed at 50% / 80% / 100% of this monthly spend.
monthly_budget_usd = 80
budget_alert_email = "senarmm@gmail.com"
