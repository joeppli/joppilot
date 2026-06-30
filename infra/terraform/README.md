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
  modules/          # reusable building blocks (network, ecr, ecs, iot, ...) — added from M2-2
```

## First-time setup

1. Run the bootstrap once → [`bootstrap/README.md`](bootstrap/README.md).
2. Put the printed bucket name into [`envs/dev/backend.tf`](envs/dev/backend.tf).
3. Add the printed role ARN as the GitHub repo variable `AWS_CI_ROLE_ARN`.
4. Open a PR changing anything under `infra/terraform/` → CI posts a `plan`.
5. Merge to `main` → CI runs `apply`.

## What's here now (M2-1)

A **skeleton** that proves the whole pipeline works end-to-end with no real
infrastructure yet: `terraform plan` succeeds and reports "No changes". The dev
root module only reads back the account id + region so a plan confirms credentials
and the backend are wired correctly. Real resources land in:

- **M2-2** — VPC (multi-AZ), ECR, VPC endpoints, an ECS Fargate hello-world.
- **M2-3** — Cognito + API Gateway (WAF + authorizer) → VPC Link → internal ALB.
- **M2-4** — services on Fargate + Aurora PostgreSQL.
- **M2-5** — IoT Core (topics, X.509/mTLS, Device Shadow).

## Running locally (optional)

CI is the source of truth; you normally won't run Terraform locally. If you do, you
need the AWS CLI authenticated to the dev account and Terraform ≥ 1.6, then:

```bash
cd infra/terraform/envs/dev
terraform init
terraform plan
```
