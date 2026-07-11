#!/usr/bin/env bash
# Create a Greengrass deployment that puts the VEA kernel + CARLA bridge on a
# vehicle's core device (default VEH-001-core).
#
# CLOUD_PUBKEY is REQUIRED: the kernel is fail-closed and refuses to start
# without the pinned Ed25519 cloud public key (ICD §4). Derivation from the
# signing key is documented in the root README (COMMAND_SIGNING_KEY section).
#
# Usage:
#   CLOUD_PUBKEY=<b64 raw ed25519 pubkey> ./deploy.sh <version> [vehicle-id]
# Env overrides:
#   AWS_REGION (eu-central-1) · AWS_IOT_ENDPOINT (auto-discovered)
#   CARLA_MOCK (0) — set 1 to run the bridge without a CARLA simulator
set -euo pipefail

VERSION="${1:?usage: deploy.sh <version> [vehicle-id]}"
VEHICLE="${2:-VEH-001}"
REGION="${AWS_REGION:-eu-central-1}"
: "${CLOUD_PUBKEY:?CLOUD_PUBKEY (base64 raw Ed25519 public key) is required — the kernel is fail-closed without it}"
CARLA_MOCK="${CARLA_MOCK:-0}"

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
IOT_ENDPOINT="${AWS_IOT_ENDPOINT:-$(aws iot describe-endpoint --endpoint-type iot:Data-ATS \
  --query endpointAddress --output text --region "$REGION")}"
TARGET_ARN="arn:aws:iot:$REGION:$ACCOUNT:thing/${VEHICLE}-core"

DOC=$(mktemp --suffix=.json)
cat > "$DOC" <<EOF
{
  "targetArn": "$TARGET_ARN",
  "deploymentName": "joppilot-edge-$VERSION",
  "components": {
    "ch.joppilot.vea": {
      "componentVersion": "$VERSION",
      "configurationUpdate": {
        "merge": "{\"vehicleId\":\"$VEHICLE\",\"cloudPubkey\":\"$CLOUD_PUBKEY\",\"awsIotEndpoint\":\"$IOT_ENDPOINT\"}"
      }
    },
    "ch.joppilot.carla-bridge": {
      "componentVersion": "$VERSION",
      "configurationUpdate": {
        "merge": "{\"carlaMock\":\"$CARLA_MOCK\"}"
      }
    }
  }
}
EOF

echo "Deploying joppilot-edge-$VERSION to $TARGET_ARN (CARLA_MOCK=$CARLA_MOCK) ..."
aws greengrassv2 create-deployment --cli-input-json "file://$DOC" --region "$REGION" --output table
rm -f "$DOC"

echo "Follow progress: aws greengrassv2 list-effective-deployments --core-device-thing-name ${VEHICLE}-core --region $REGION"
