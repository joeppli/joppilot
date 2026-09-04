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

# --- Live console origin (C1) -------------------------------------------------
# The console SPA is served from GitHub Pages at the custom domain
# pilot.joeppli.ch (DEV-27). Three separate allow-lists have to name it, and
# each one fails differently if it does not:
#
#   cognito_callback_urls  the Hosted UI refuses the redirect outright
#                          ("redirect_mismatch") — sign-in cannot even start.
#   cognito_logout_urls    sign-out dead-ends on a Cognito error page instead
#                          of returning the operator to the entry gate.
#   console_origins        CORS: sign-in works, telemetry works, and then every
#                          command is blocked by the browser — the worst of the
#                          three, because it looks like a backend outage.
#
# The value is the ORIGIN exactly as the browser reports it (apps/console
# src/aws/auth.ts uses window.location.origin): scheme + host, no trailing
# slash, no path. localhost:3000 stays for `pnpm dev` (vite.config.ts port).
cognito_callback_urls = ["https://pilot.joeppli.ch", "http://localhost:3000"]
cognito_logout_urls   = ["https://pilot.joeppli.ch", "http://localhost:3000"]
console_origins       = ["https://pilot.joeppli.ch", "http://localhost:3000"]
