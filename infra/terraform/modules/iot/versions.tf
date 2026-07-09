terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    # Fetches Amazon's public Root CA 1 for the client cert bundles.
    http = {
      source  = "hashicorp/http"
      version = "~> 3.4"
    }
  }
}
