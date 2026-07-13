#!/usr/bin/env bash
# =============================================================================
# Joppilot — turnkey VEHICLE-SIDE launcher (PC-A, the CARLA machine).
#
# Hand this to the engineer on the CARLA machine together with:
#   - the 3 certificate files (veh.cert.pem / veh.key.pem / veh.ca.pem)
#   - a filled  edge/vehicle.env  (copy from vehicle.env.example)
#
# When they run  ./edge/run-vehicle.sh  it:
#   1. loads config from edge/vehicle.env
#   2. checks prerequisites (Rust, Python, the carla wheel, the certs)
#   3. builds the Rust safety kernel
#   4. starts the kernel (→ AWS IoT Core over mTLS) AND the CARLA bridge
#
# NO AWS account / login is needed on this machine — the kernel authenticates
# to the cloud with the vehicle certificate (mTLS), exactly like a real vehicle.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/.." && pwd)"

say()  { printf '\n\033[1;36m» %s\033[0m\n' "$*"; }
ok()   { printf '   \033[1;32m✓\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31m⛔ %s\033[0m\n' "$*" >&2; exit 1; }

# --- 1. Config ---------------------------------------------------------------
ENV_FILE="${HERE}/vehicle.env"
if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a; source "${ENV_FILE}"; set +a
  ok "loaded config from ${ENV_FILE}"
else
  echo "   (no edge/vehicle.env found — reading config from the environment)"
fi

: "${VEHICLE_ID:=VEH-001}"
: "${CARLA_HOST:=127.0.0.1}"
: "${CARLA_PORT:=2000}"
: "${CARLA_MOCK:=0}"

# EDGE_CLOUD_PUBKEY = the cloud command service's SIGNING PUBLIC key (ICD §4).
# For the deployed cloud console this MUST be the real Secrets Manager key's
# public half (see vehicle.env.example for the one-line fetch). It is NOT the
# committed dev key — a mismatch makes the kernel NACK every command.
[[ -n "${EDGE_CLOUD_PUBKEY:-}" ]] || die "EDGE_CLOUD_PUBKEY is not set (fill edge/vehicle.env)."

if [[ "${CARLA_MOCK}" != "1" ]]; then
  [[ -n "${IOT_ENDPOINT:-}" ]]  || die "IOT_ENDPOINT is not set (fill edge/vehicle.env)."
  : "${CERT_DIR:?set CERT_DIR (folder with veh.cert.pem / veh.key.pem / veh.ca.pem) in edge/vehicle.env}"
  : "${CERT_CA:=${CERT_DIR}/veh.ca.pem}"
  : "${CERT_CRT:=${CERT_DIR}/veh.cert.pem}"
  : "${CERT_KEY:=${CERT_DIR}/veh.key.pem}"
  for f in "${CERT_CA}" "${CERT_CRT}" "${CERT_KEY}"; do
    [[ -f "${f}" ]] || die "certificate file not found: ${f}"
  done
  ok "certificates present in ${CERT_DIR}"
fi

# --- 2. Prerequisites --------------------------------------------------------
say "Checking prerequisites"

# Rust / cargo
if ! command -v cargo >/dev/null 2>&1; then
  [[ -f "${HOME}/.cargo/env" ]] && source "${HOME}/.cargo/env" || true
fi
if ! command -v cargo >/dev/null 2>&1; then
  if [[ -t 0 ]]; then
    read -r -p "   Rust (cargo) not found. Install rustup now? [y/N] " reply
    if [[ "${reply}" =~ ^[Yy]$ ]]; then
      curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
      source "${HOME}/.cargo/env"
    else
      die "Rust is required. Install: https://rustup.rs  then re-run."
    fi
  else
    die "Rust (cargo) not found. Install: curl https://sh.rustup.rs -sSf | sh   then re-run."
  fi
fi
ok "cargo $(cargo --version | awk '{print $2}')"

# Python + the carla wheel (only when driving REAL CARLA)
command -v python3 >/dev/null 2>&1 || die "python3 is required for the CARLA bridge."
ok "$(python3 --version)"
if [[ "${CARLA_MOCK}" != "1" ]]; then
  if ! python3 -c 'import carla' 2>/dev/null; then
    die "The 'carla' Python module is not importable.
   Install the wheel that MATCHES your CARLA server version, e.g.:
       pip install carla==0.9.15
   (or add CARLA's PythonAPI .egg to PYTHONPATH). To prove the cloud link
   first WITHOUT CARLA, set CARLA_MOCK=1 in edge/vehicle.env and re-run."
  fi
  ok "carla Python module importable"
fi

# The kernel reads the committed contract schemas at runtime.
[[ -f "${REPO}/packages/contract/schemas/CommandEnvelope.json" ]] \
  || die "contract schemas missing at ${REPO}/packages/contract/schemas — is this the full repo checkout?"
ok "contract schemas present"

# --- 3. Build the safety kernel ---------------------------------------------
say "Building the Rust safety kernel (first build takes a few minutes)"
( cd "${REPO}/edge/sim" && cargo build --release )
KERNEL_BIN="${CARGO_TARGET_DIR:-${REPO}/edge/sim/target}/release/edge"
[[ -x "${KERNEL_BIN}" ]] || die "kernel binary not found at ${KERNEL_BIN} after build."
ok "kernel built"

# --- 4. Run both processes ---------------------------------------------------
cleanup() { echo; say "stopping vehicle processes…"; kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

wait_for_port() { # host port [tries]
  local host="$1" port="$2" tries="${3:-60}" i
  for (( i = 0; i < tries; i++ )); do
    (exec 3<>"/dev/tcp/${host}/${port}") 2>/dev/null && { exec 3>&- 3<&- 2>/dev/null; return 0; }
    sleep 1
  done
  return 1
}

say "Starting the safety kernel (thing=${VEHICLE_ID}) → ${IOT_ENDPOINT:-<mock/local>}"
(
  cd "${REPO}/edge/sim"
  if [[ "${CARLA_MOCK}" == "1" && -z "${IOT_ENDPOINT:-}" ]]; then
    EDGE_CLOUD_PUBKEY="${EDGE_CLOUD_PUBKEY}" EDGE_VEHICLE_ID="${VEHICLE_ID}" \
      EDGE_ZONE_TYPE=public_approved_route "${KERNEL_BIN}"
  else
    AWS_IOT_ENDPOINT="${IOT_ENDPOINT}" \
    AWS_CERT_ROOT_CA_PATH="${CERT_CA}" \
    AWS_CERT_CERT_PATH="${CERT_CRT}" \
    AWS_CERT_PRIVATE_KEY_PATH="${CERT_KEY}" \
    EDGE_CLOUD_PUBKEY="${EDGE_CLOUD_PUBKEY}" \
    EDGE_VEHICLE_ID="${VEHICLE_ID}" \
    EDGE_ZONE_TYPE=public_approved_route \
    "${KERNEL_BIN}"
  fi
) &

if wait_for_port 127.0.0.1 7077 30; then
  ok "kernel actuation IPC is up (127.0.0.1:7077)"
else
  die "kernel did not open its actuation IPC — check the log above (cert/endpoint/pubkey?)."
fi

say "Starting the CARLA bridge (CARLA_MOCK=${CARLA_MOCK}, ${CARLA_HOST}:${CARLA_PORT})"
(
  cd "${REPO}/edge/carla-bridge"
  CARLA_MOCK="${CARLA_MOCK}" CARLA_HOST="${CARLA_HOST}" CARLA_PORT="${CARLA_PORT}" \
  VEA_ACTUATION_ADDR=127.0.0.1:7077 \
  python3 bridge.py
) &

cat <<'BANNER'

──────────────────────────────────────────────────────────────────────────────
 Vehicle side is UP. What to look for:
   • kernel:  "Connected to MQTT Broker (AWS IoT Core ... thing = VEH-001)"
   • bridge:  "connected to VEA kernel" + "spawned vehicle.tesla.model3"
 Then the operator drives from the Joppilot browser console (Take control →
 steering). No heartbeat yet → the kernel latches a safe-stop after ~3 s; that
 is CORRECT — it clears once the operator takes control and drives.
 Press Ctrl-C here to stop both processes.
──────────────────────────────────────────────────────────────────────────────
BANNER

wait
