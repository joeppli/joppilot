# Bootstrap (run ONCE, by you)

This creates the few AWS things that must exist *before* Terraform and GitHub
Actions can run: the state bucket, the state lock table, and the GitHub OIDC trust
+ CI role. After this one-time step, all infrastructure is managed by Terraform
through CI — you won't touch the AWS console for routine changes.

> You don't need anything installed locally. Do it in **AWS CloudShell**, a browser
> terminal that is already logged in as you.

## Steps

1. Sign in to the AWS Console for the **dev account**.
2. Make sure the region (top-right) is **Europe (Frankfurt) eu-central-1**.
3. Click the **CloudShell** icon (`>_`) in the top bar. Wait for the prompt.
4. Run the script. Easiest: paste its contents, or upload the file via CloudShell's
   *Actions → Upload file* and then:
   ```bash
   bash bootstrap.sh
   ```
5. When it finishes it prints two values — **copy them**:
   - `STATE BUCKET` → put this into [`../envs/dev/backend.tf`](../envs/dev/backend.tf)
     in place of `REPLACE_WITH_STATE_BUCKET`, then commit.
   - `CI ROLE ARN` → add it as a **GitHub repository variable**:
     GitHub repo → **Settings → Secrets and variables → Actions → Variables tab →
     New repository variable**, name it `AWS_CI_ROLE_ARN`, paste the value.

That's it. From now on, opening a PR that changes `infra/terraform/**` runs a
`terraform plan`, and merging to `main` runs `terraform apply` — all via the
[`terraform` workflow](../../../.github/workflows/terraform.yml), with no stored keys.

## If the repository is transferred (owner rename / move into an org)

The CI role trusts **one exact `owner/repo`** — the trust policy matches the OIDC
token's `sub` claim against `repo:<owner>/<repo>:*`. After a transfer the token
carries the new owner, stops matching, and every AWS workflow fails at the
"Configure AWS credentials (OIDC)" step with:

```
Could not assume role with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity
```

Fix (CloudShell, ~10 seconds): update `GITHUB_REPO` at the top of
[`bootstrap.sh`](bootstrap.sh) and re-run it — everything else is skipped as
already-existing, only the trust policy is rewritten. Then re-run the failed
workflow (Actions → the run → *Re-run jobs*). The `AWS_CI_ROLE_ARN` variable does
not change: the role lives in AWS and is untouched by the transfer.

Also check after a transfer: **Settings → Pages** (source must still be *GitHub
Actions*, and the custom domain re-verified), and the DNS `CNAME` for the custom
domain, which points at `<owner>.github.io` and therefore needs the new owner.

## Notes
- The script is **idempotent** — re-running it is safe; it skips what already exists.
- The CI role is granted `AdministratorAccess` for the dev account so you don't fight
  permission errors during M2. **Tighten this before any production account.**
- Nothing here is created by Terraform on purpose: Terraform can't manage its own
  backend before that backend exists (the chicken-and-egg the script solves).
