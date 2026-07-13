#!/usr/bin/env bash
# =============================================================================
# Joppilot — one-shot VEHICLE-SIDE launcher (PC-A, the CARLA machine).
#
# Runs the two on-vehicle processes against AWS IoT Core:
#   1. the Rust safety kernel (edge/sim) — connects to IoT Core over mTLS
#   2. the CARLA bridge (edge/carla-bridge) — drives CARLA + feeds pose back
#
# You do NOT need an AWS account/login on this machine — only the three vehicle
# certificate files + the IoT endpoint (someone fetches them once from AWS and
# sends them to you). See edge/README-vehicle.md.
#
# Prereqs on this machine:
#   - CARLA simulator running (default localhost:2000)
#   - Rust toolchain (rustup stable) and Python 3 with the matching `carla` wheel
#   - this repo checked out (the kernel reads packages/contract/schemas/*.json)
#
# Usage:
#   export IOT_ENDPOINT=xxxx-ats.iot.eu-central-1.amazonaws.com
#   export CERT_DIR=/path/to/certs          # holds veh.cert.pem / veh.key.pem / veh.ca.pem
#   ./edge/run-vehicle.sh
#
# Optional env: VEHICLE_ID (default VEH-001), CARLA_HOST, CARLA_PORT (2000),
#   CARLA_MOCK (1 = kinematic mock, no CARLA needed — handy to smoke-test the
#   link before wiring the real simulator).
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The cloud's signing PUBLIC key the vehicle pins (ICD §4). This DEV value
# matches the committed dev signing key the local command service uses. If the
# cloud command service runs with the real Secrets Manager signing key, override
# EDGE_CLOUD_PUBKEY with its public half (see README-vehicle.md).
: "${EDGE_CLOUD_PUBKEY:=MtCOj41fShxsJ6haPWkaNOWXIqPp9PBRmbZ6caosNpM=}"
: "${VEHICLE_ID:=VEH-001}"
: "${CARLA_HOST:=127.0.0.1}"
: "${CARLA_PORT:=2000}"
: "${CARLA_MOCK:=0}"

if [[ "${CARLA_MOCK}" != "1" ]]; then
  : "${IOT_ENDPOINT:?set IOT_ENDPOINT to the AWS IoT ATS endpoint}"
  : "${CERT_DIR:?set CERT_DIR to the folder holding veh.cert.pem / veh.key.pem / veh.ca.pem}"
fi

cleanup() { echo; echo "[run-vehicle] stopping…"; kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "[run-vehicle] 1/2 starting safety kernel (thing=${VEHICLE_ID}) → IoT Core ${IOT_ENDPOINT:-<mock>}"
(
  cd "${HERE}/sim"
  if [[ -n "${IOT_ENDPOINT:-}" ]]; then
    AWS_IOT_ENDPOINT="${IOT_ENDPOINT}" \
    AWS_CERT_ROOT_CA_PATH="${CERT_DIR}/veh.ca.pem" \
    AWS_CERT_CERT_PATH="${CERT_DIR}/veh.cert.pem" \
    AWS_CERT_PRIVATE_KEY_PATH="${CERT_DIR}/veh.key.pem" \
    EDGE_CLOUD_PUBKEY="${EDGE_CLOUD_PUBKEY}" \
    EDGE_VEHICLE_ID="${VEHICLE_ID}" \
    EDGE_ZONE_TYPE=public_approved_route \
    cargo run --release
  else
    # Link smoke test without AWS: local broker + mock CARLA.
    EDGE_CLOUD_PUBKEY="${EDGE_CLOUD_PUBKEY}" EDGE_VEHICLE_ID="${VEHICLE_ID}" cargo run --release
  fi
) &

# Give the kernel a moment to bind the actuation IPC (127.0.0.1:7077).
sleep 5

echo "[run-vehicle] 2/2 starting CARLA bridge (CARLA_MOCK=${CARLA_MOCK}, ${CARLA_HOST}:${CARLA_PORT})"
(
  cd "${HERE}/carla-bridge"
  CARLA_MOCK="${CARLA_MOCK}" CARLA_HOST="${CARLA_HOST}" CARLA_PORT="${CARLA_PORT}" \
  VEA_ACTUATION_ADDR=127.0.0.1:7077 \
  python3 bridge.py
) &

wait
