# The AWS provider. Region comes from a variable so we never hardcode it twice.
# default_tags are stamped onto every resource that supports tags — this makes
# cost reports and "what is this thing?" investigations far easier later.
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "joppilot"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
