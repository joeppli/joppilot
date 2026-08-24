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

## If the repository is transferred, renamed, or the org changes its OIDC settings

The CI role trusts **one exact repository**, matched against the OIDC token's `sub`
claim. Anything that changes the shape of that claim breaks every AWS workflow at
the "Configure AWS credentials (OIDC)" step with:

```
Could not assume role with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity
```

Two things change it:

- **A transfer or rename** changes the owner/repo *names* in the claim
  (`senagolcuk` → `joeppli`, 2026-08-24).
- **Immutable identifiers in OIDC subject claims**, an organization-level Actions
  setting that is **ON for `joeppli`**. It appends numeric ids to both segments, so
  the claim is `repo:joeppli@319062959/joppilot@1266196407:ref:...` — not the
  `repo:joeppli/joppilot:ref:...` that every GitHub-OIDC tutorial assumes. Keep it
  on: an id cannot be re-registered by someone else if a name is ever freed up.

`bootstrap.sh` therefore trusts **both shapes** of the claim, and re-running it
rewrites only the trust policy (bucket, lock table and provider are skipped as
already-existing). `AWS_CI_ROLE_ARN` never changes — the role lives in AWS and a
transfer does not touch it.

### Read the claims instead of guessing them

Never infer the `sub`; print what a run actually presents. Add this step to any
workflow with `permissions: id-token: write`, run it, then delete the step. It
prints the claims, never the token itself (that one is a bearer credential):

```yaml
      - name: Print OIDC token claims
        run: |
          token=$(curl -sS \
            -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
            "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=sts.amazonaws.com" | jq -r .value)
          payload=$(printf '%s' "$token" | cut -d. -f2 | tr '_-' '/+')
          case $(( ${#payload} % 4 )) in
            2) payload="${payload}==" ;;
            3) payload="${payload}=" ;;
          esac
          printf '%s' "$payload" | base64 -d \
            | jq '{iss, aud, sub, repository, repository_owner, repository_id}'
```

Compare it against the role, and check the provider exists:

```bash
aws iam get-role --role-name joppilot-ci-dev --query 'Role.AssumeRolePolicyDocument.Statement[0]'
aws iam list-open-id-connect-providers
```

`iss` must equal the provider's URL. A GitHub Enterprise with "unique token URLs"
appends an enterprise slug there — a *different* issuer, which needs its own IAM
OIDC provider, not just a trust-policy edit.

Also check after a transfer: **Settings → Pages** (source still *GitHub Actions*,
custom domain re-verified) and the DNS `CNAME` for `pilot.joeppli.ch`, which points
at `<owner>.github.io` and therefore needs the new owner.

## Notes
- The script is **idempotent** — re-running it is safe; it skips what already exists.
- The CI role is granted `AdministratorAccess` for the dev account so you don't fight
  permission errors during M2. **Tighten this before any production account.**
- Nothing here is created by Terraform on purpose: Terraform can't manage its own
  backend before that backend exists (the chicken-and-egg the script solves).
