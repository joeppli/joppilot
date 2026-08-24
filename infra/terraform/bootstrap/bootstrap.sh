#!/usr/bin/env bash
# =============================================================================
# Joppilot M2-1 — one-time AWS bootstrap (run ONCE, by an account admin)
#
# WHY THIS EXISTS (chicken-and-egg):
#   Terraform stores its "state" (what it has created) in an S3 bucket and uses a
#   DynamoDB table as a lock so two runs can't clash. GitHub Actions authenticates
#   to AWS without any stored password using "OIDC" — it presents a short-lived
#   token and assumes an IAM role. But the bucket, the lock table, the OIDC trust
#   and the role must all EXIST before Terraform/GitHub can use them. So we create
#   them once here, by hand, with the admin who is already logged into AWS.
#
# WHERE TO RUN IT:
#   Easiest: AWS Console -> top bar -> "CloudShell" (the >_ icon). CloudShell is a
#   browser terminal already logged in as you, with the AWS CLI installed. No local
#   setup needed. Paste this whole script there (or upload it) and run it.
#
# WHAT IT CREATES (region eu-central-1):
#   1. S3 bucket    joppilot-tfstate-dev-<ACCOUNT_ID>   (Terraform state, versioned, encrypted, private)
#   2. DynamoDB     joppilot-tfstate-lock               (state lock)
#   3. IAM OIDC provider for token.actions.githubusercontent.com (GitHub Actions trust)
#   4. IAM role     joppilot-ci-dev                     (GitHub Actions assumes this to run Terraform)
#
# IDEMPOTENT: safe to re-run; it skips anything that already exists.
# =============================================================================
set -euo pipefail

# ---- settings you may change -------------------------------------------------
REGION="eu-central-1"
# The repository GitHub Actions runs from — by name AND by numeric id. These land
# verbatim in the role's trust policy, so they are not cosmetic:
#
#   GitHub mints an OIDC token whose `sub` claim names the repository. The plain
#   form is "repo:<owner>/<repo>:ref:...", but an organization can turn on
#   IMMUTABLE IDENTIFIERS in OIDC subject claims — joeppli has this ON — and the
#   claim then reads "repo:<owner>@<ownerId>/<repo>@<repoId>:ref:...". The trust
#   policy below allows BOTH shapes, so flipping that org toggle cannot lock CI
#   out of AWS, and the id-bearing form keeps working across renames.
#
#   A transfer (senagolcuk -> joeppli, 2026-08-24) changes the NAMES; the ids are
#   stable. A trust policy that no longer matches fails every AWS workflow at the
#   "Configure AWS credentials (OIDC)" step with:
#     "Could not assume role with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity"
#   Fix: correct the four values below and re-run this script — the bucket, lock
#   table and OIDC provider are skipped as already-existing, only the trust policy
#   is rewritten. README.md has a recipe that prints the claims a run actually
#   presents, so you match the policy against reality instead of guessing.
GITHUB_OWNER="joeppli"
GITHUB_OWNER_ID="319062959"
GITHUB_REPO_NAME="joppilot"
GITHUB_REPO_ID="1266196407"
ROLE_NAME="joppilot-ci-dev"
LOCK_TABLE="joppilot-tfstate-lock"
# DEV ONLY: the CI role gets AdministratorAccess so Terraform can create anything
# during M2 without you hitting cryptic "access denied" errors. Tighten before prod.
CI_POLICY_ARN="arn:aws:iam::aws:policy/AdministratorAccess"
# -----------------------------------------------------------------------------

echo "==> Checking AWS CLI is logged in..."
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
echo "    Account: ${ACCOUNT_ID}  Region: ${REGION}"

BUCKET="joppilot-tfstate-dev-${ACCOUNT_ID}"

# 1) ---- S3 state bucket ------------------------------------------------------
echo "==> S3 state bucket: ${BUCKET}"
if aws s3api head-bucket --bucket "${BUCKET}" 2>/dev/null; then
  echo "    already exists, skipping create"
else
  aws s3api create-bucket \
    --bucket "${BUCKET}" \
    --region "${REGION}" \
    --create-bucket-configuration LocationConstraint="${REGION}"
fi
echo "    enabling versioning + encryption + blocking all public access"
aws s3api put-bucket-versioning   --bucket "${BUCKET}" --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption   --bucket "${BUCKET}" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-public-access-block  --bucket "${BUCKET}" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# 2) ---- DynamoDB lock table --------------------------------------------------
echo "==> DynamoDB lock table: ${LOCK_TABLE}"
if aws dynamodb describe-table --table-name "${LOCK_TABLE}" --region "${REGION}" >/dev/null 2>&1; then
  echo "    already exists, skipping"
else
  aws dynamodb create-table \
    --table-name "${LOCK_TABLE}" \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST \
    --region "${REGION}" >/dev/null
  echo "    waiting for table to become ACTIVE..."
  aws dynamodb wait table-exists --table-name "${LOCK_TABLE}" --region "${REGION}"
fi

# 3) ---- GitHub OIDC provider -------------------------------------------------
OIDC_ARN="arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
echo "==> GitHub OIDC provider"
if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "${OIDC_ARN}" >/dev/null 2>&1; then
  echo "    already exists, skipping"
else
  aws iam create-open-id-connect-provider \
    --url "https://token.actions.githubusercontent.com" \
    --client-id-list "sts.amazonaws.com" \
    --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" >/dev/null
fi

# 4) ---- CI IAM role GitHub Actions will assume -------------------------------
echo "==> IAM role: ${ROLE_NAME}"
TRUST=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "${OIDC_ARN}" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike":  { "token.actions.githubusercontent.com:sub": [
        "repo:${GITHUB_OWNER}/${GITHUB_REPO_NAME}:*",
        "repo:${GITHUB_OWNER}@${GITHUB_OWNER_ID}/${GITHUB_REPO_NAME}@${GITHUB_REPO_ID}:*"
      ] }
    }
  }]
}
JSON
)
if aws iam get-role --role-name "${ROLE_NAME}" >/dev/null 2>&1; then
  echo "    exists, updating trust policy"
  aws iam update-assume-role-policy --role-name "${ROLE_NAME}" --policy-document "${TRUST}"
else
  aws iam create-role --role-name "${ROLE_NAME}" \
    --description "GitHub Actions OIDC role for Joppilot Terraform (dev)" \
    --assume-role-policy-document "${TRUST}" >/dev/null
fi
echo "    attaching policy: ${CI_POLICY_ARN}"
aws iam attach-role-policy --role-name "${ROLE_NAME}" --policy-arn "${CI_POLICY_ARN}"

ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"

# ---- done: print the values you need next -----------------------------------
cat <<DONE

=============================================================================
 BOOTSTRAP COMPLETE
=============================================================================
 Copy these two values — you will need them in the next steps:

   STATE BUCKET : ${BUCKET}
   CI ROLE ARN  : ${ROLE_ARN}

 NEXT:
  1) Put the bucket name into infra/terraform/envs/dev/backend.tf
     (replace REPLACE_WITH_STATE_BUCKET).
  2) Add a GitHub repository variable named  AWS_CI_ROLE_ARN  with the value:
        ${ROLE_ARN}
     (GitHub repo -> Settings -> Secrets and variables -> Actions -> Variables tab -> New variable)
=============================================================================
DONE
