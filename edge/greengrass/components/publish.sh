#!/usr/bin/env bash
# Publish the Joppilot Greengrass components (M3-1): build the VEA kernel
# binary, upload artifacts to the gg-artifacts bucket, register the component
# versions from the recipe templates in this directory.
#
# Needs: docker + an AWS-credentialed shell on the SAME machine (CloudShell
# cannot build the binary). Component versions are immutable — pass a fresh
# version to re-publish changed code.
#
# Usage:
#   ./publish.sh <version> [vea|carla-bridge]
# Env overrides:
#   AWS_REGION (eu-central-1) · NAME_PREFIX (joppilot-dev) · ARTIFACTS_BUCKET
set -euo pipefail

VERSION="${1:?usage: publish.sh <version> [vea|carla-bridge]}"
ONLY="${2:-}"
REGION="${AWS_REGION:-eu-central-1}"
PREFIX="${NAME_PREFIX:-joppilot-dev}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET="${ARTIFACTS_BUCKET:-${PREFIX}-gg-artifacts-${ACCOUNT}}"
echo "Artifacts bucket: s3://$BUCKET (region $REGION)"

render() { # recipe template -> stdout
  sed -e "s/{{ARTIFACTS_BUCKET}}/$BUCKET/g" -e "s/{{COMPONENT_VERSION}}/$VERSION/g" "$1"
}

register() { # component name, recipe template path
  local name="$1" recipe="$2" rendered
  rendered=$(mktemp --suffix=.yaml)
  render "$recipe" > "$rendered"
  echo "Registering $name@$VERSION ..."
  aws greengrassv2 create-component-version \
    --inline-recipe "fileb://$rendered" --region "$REGION" \
    --query '{arn: arn, state: status.componentState}' --output table
  rm -f "$rendered"
}

# ---------------------------------------------------------------- VEA kernel
if [ -z "$ONLY" ] || [ "$ONLY" = "vea" ]; then
  # musl static build: one binary that runs on any linux nucleus base image
  # (AL2023 today) regardless of glibc version. rumqttc uses rustls, so the
  # whole dependency tree is pure Rust + ring (built by build-base).
  echo "Building VEA kernel (x86_64-unknown-linux-musl, release) ..."
  docker run --rm -v "$ROOT":/w -w /w/edge/sim rust:1-alpine sh -c \
    'apk add --no-cache build-base >/dev/null && cargo build --release --target x86_64-unknown-linux-musl'
  BIN="$ROOT/edge/sim/target/x86_64-unknown-linux-musl/release/edge"

  aws s3 cp "$BIN" "s3://$BUCKET/ch.joppilot.vea/$VERSION/vea" --region "$REGION"
  # Schemas are runtime artifacts of the kernel (fail-closed without them).
  aws s3 cp "$ROOT/packages/contract/schemas/CommandEnvelope.json" \
    "s3://$BUCKET/ch.joppilot.vea/$VERSION/CommandEnvelope.json" --region "$REGION"
  aws s3 cp "$ROOT/packages/contract/schemas/ZoneConfig.json" \
    "s3://$BUCKET/ch.joppilot.vea/$VERSION/ZoneConfig.json" --region "$REGION"

  register ch.joppilot.vea "$HERE/vea/recipe.yaml"
fi

# -------------------------------------------------------------- CARLA bridge
if [ -z "$ONLY" ] || [ "$ONLY" = "carla-bridge" ]; then
  aws s3 cp "$ROOT/edge/carla-bridge/bridge.py" \
    "s3://$BUCKET/ch.joppilot.carla-bridge/$VERSION/bridge.py" --region "$REGION"
  aws s3 cp "$ROOT/edge/carla-bridge/requirements.txt" \
    "s3://$BUCKET/ch.joppilot.carla-bridge/$VERSION/requirements.txt" --region "$REGION"

  register ch.joppilot.carla-bridge "$HERE/carla-bridge/recipe.yaml"
fi

echo "Done. Deploy with: ./deploy.sh $VERSION"
