# Remote state: Terraform records what it has created in this S3 bucket, and uses
# the DynamoDB table to lock the state during a run. Both are created ONCE by
# infra/terraform/bootstrap/bootstrap.sh — run that first.
#
# The bucket name below is what bootstrap.sh printed for this dev account.
terraform {
  backend "s3" {
    bucket         = "joppilot-tfstate-dev-325657596328"
    key            = "envs/dev/terraform.tfstate"
    region         = "eu-central-1"
    dynamodb_table = "joppilot-tfstate-lock"
    encrypt        = true
  }
}
