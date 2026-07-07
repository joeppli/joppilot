# Joppilot Infrastructure (Terraform)

Infrastructure-as-Code for the AWS migration (milestone **M2**). Region:
**eu-central-1 (Frankfurt)** — primary per architecture AD-17 (IoT Core / KVS
WebRTC are not available in the Zurich region; Zurich is DR only).

Apply runs through **GitHub Actions with OIDC** — there are no AWS keys stored in
the repo or on any laptop. See [`../../.github/workflows/terraform.yml`](../../.github/workflows/terraform.yml).

## Layout

```
infra/terraform/
  bootstrap/        # run ONCE by hand (state backend + GitHub OIDC + CI role) — see bootstrap/README.md
  envs/
    dev/            # the dev environment root module (terraform runs here)
  modules/          # reusable building blocks: network, ecr, ecs, alb, cognito, apigw, endpoints, aurora
```

## First-time setup

1. Run the bootstrap once → [`bootstrap/README.md`](bootstrap/README.md).
2. Put the printed bucket name into [`envs/dev/backend.tf`](envs/dev/backend.tf).
3. Add the printed role ARN as the GitHub repo variable `AWS_CI_ROLE_ARN`.
4. Open a PR changing anything under `infra/terraform/` → CI posts a `plan`.
5. Merge to `main` → CI runs `apply`.

## What's here now (M2-4-2 complete)

The deployed dev stack: VPC (multi-AZ public/private subnets) + ECR + ECS Fargate
hello-world (nginx from our private ECR, **private subnets, no public IP**) +
VPC endpoints (ecr.api / ecr.dkr / logs / secretsmanager + free S3 gateway) +
Cognito (invite-only, MFA/TOTP, `admin`/`operator` groups) + HTTP API Gateway
(Cognito JWT authorizer → VPC Link) + **internal ALB** (with WAF) + **Aurora
Serverless v2** (PostgreSQL, min 0 ACU auto-pause, KMS CMK, deletion-protected,
master password in an RDS-managed Secrets Manager secret). API Gateway is the
only public entry point; no interim deviations remain (see the header of
[`envs/dev/main.tf`](envs/dev/main.tf)). Still to come:

- **M2-4-3** — real services (command/telemetry/fleet) on Fargate wired to
  Aurora + API Gateway (RBAC to verified `cognito:groups`).
- **M2-5** — IoT Core (topics, X.509/mTLS, Device Shadow).

**One-time image push:** the hello-world task pulls `joppilot/hello-world:latest`
from our ECR — private subnets cannot reach public registries. Seed it once from
CloudShell (Docker is preinstalled there):

```bash
aws ecr get-login-password --region eu-central-1 | docker login --username AWS \
  --password-stdin 325657596328.dkr.ecr.eu-central-1.amazonaws.com
docker pull public.ecr.aws/nginx/nginx:1.27-alpine
docker tag public.ecr.aws/nginx/nginx:1.27-alpine \
  325657596328.dkr.ecr.eu-central-1.amazonaws.com/joppilot/hello-world:latest
docker push 325657596328.dkr.ecr.eu-central-1.amazonaws.com/joppilot/hello-world:latest
```

**Cost control:** the billable pieces (ALB+WAF+VPC endpoints, ~$57/mo) tear down
with the `terraform-destroy-billables` workflow (Actions tab) and come back by
re-running the `terraform` workflow — details in the root README's cost-control
section. Pushed ECR images survive the destroy. **Aurora is never a destroy
target** (stateful — permanent rule): min 0 ACU auto-pause already reduces the
idle cluster to storage-only pennies, and `deletion_protection` blocks deletion.

## Running locally (optional)

CI is the source of truth; you normally won't run Terraform locally. If you do, you
need the AWS CLI authenticated to the dev account and Terraform ≥ 1.6, then:

```bash
cd infra/terraform/envs/dev
terraform init
terraform plan
```
