#!/usr/bin/env bash
# Launch CARLA on the NVIDIA dGPU.
#
# This is a hybrid-graphics laptop whose DEFAULT GPU is the Intel iGPU — CARLA
# renders there and crawls unless the discrete RTX is forced. These three env
# vars (from `switcherooctl list`, Device 1) route CARLA's Vulkan renderer to
# the NVIDIA GPU. Also caps FPS + low quality so the GPU isn't maxed and the
# browser console stays responsive.
#
# Usage:   ./edge/carla-bridge/run-carla.sh              # 1280x720, 30 fps, Low
#          RESX=1600 RESY=900 FPS=45 ./edge/carla-bridge/run-carla.sh
#          ./edge/carla-bridge/run-carla.sh -quality-level=Epic   # extra args pass through
set -euo pipefail

CARLA_DIR="${CARLA_DIR:-$HOME/carla}"
RESX="${RESX:-1280}"
RESY="${RESY:-720}"
FPS="${FPS:-30}"

[[ -x "${CARLA_DIR}/CarlaUE4.sh" ]] || { echo "CarlaUE4.sh not found in ${CARLA_DIR} (set CARLA_DIR)"; exit 1; }

exec env \
  __NV_PRIME_RENDER_OFFLOAD=1 \
  __GLX_VENDOR_LIBRARY_NAME=nvidia \
  __VK_LAYER_NV_optimus=NVIDIA_only \
  "${CARLA_DIR}/CarlaUE4.sh" \
    -windowed -ResX="${RESX}" -ResY="${RESY}" \
    -quality-level=Low -benchmark -fps="${FPS}" "$@"
