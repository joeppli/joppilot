# Terraform + provider version pins. Keeping these explicit means every machine
# and CI run uses the same toolchain — no "works on my laptop" surprises.
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    # M2-5: generates the Ed25519 command-signing keypair (ICD §4).
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
    # M2-5b: the iot module fetches Amazon's public Root CA for cert bundles.
    http = {
      source  = "hashicorp/http"
      version = "~> 3.4"
    }
  }
}
