# Values for this environment. Defaults in variables.tf already match dev, so this
# file is mostly here as the place to override per-environment settings later.
aws_region  = "eu-central-1"
environment = "dev"

# Cost guardrail — alerts emailed at 50% / 80% / 100% of this monthly spend.
monthly_budget_usd = 80
budget_alert_email = "senarmm@gmail.com"

# Start the hello-world service STOPPED whenever it is (re)created — e.g. after
# the weekend destroy-billables workflow + Monday restore apply. Terraform only
# uses this on create (desired_count is in ignore_changes); scale up manually
# for tests: aws ecs update-service ... --desired-count 1
hello_world_desired_count = 0
