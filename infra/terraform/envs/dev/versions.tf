# Terraform + provider version pins. Keeping these explicit means every machine
# and CI run uses the same toolchain — no "works on my laptop" surprises.
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }
}
