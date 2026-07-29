#!/usr/bin/env python3
"""Live CARLA ground-truth speed monitor for the joppilot vehicle.

Reads the vehicle's velocity STRAIGHT from CARLA (the same source the bridge
samples) and prints speed in km/h at ~2 Hz, so you can eyeball it against the
speed shown in the operator console. They should match closely — any gap is
telemetry-pipeline lag/rounding, not a different measurement.

Run (CARLA must be up):
    ~/carla-venv/bin/python edge/carla-bridge/carla_speed.py
"""
import math
import time

import carla

client = carla.Client("127.0.0.1", 2000)
client.set_timeout(10.0)
world = client.get_world()


def find_joppilot():
    for a in world.get_actors().filter("vehicle.*"):
        if a.attributes.get("role_name") == "joppilot":
            return a
    return None


veh = find_joppilot()
if veh is None:
    raise SystemExit("joppilot vehicle not found in CARLA — is run-vehicle.sh up?")

print(f"watching actor {veh.id} (role=joppilot) — Ctrl-C to stop\n")
try:
    while True:
        # actor may be re-spawned by the bridge on reconnect; re-acquire if gone
        if not veh.is_alive:
            veh = find_joppilot()
            if veh is None:
                print("… joppilot vehicle gone, waiting")
                time.sleep(1.0)
                continue
        v = veh.get_velocity()
        speed_kmh = 3.6 * math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2)
        loc = veh.get_location()
        print(f"CARLA speed = {speed_kmh:6.2f} km/h   "
              f"(pos x={loc.x:7.1f} y={loc.y:7.1f})", flush=True)
        time.sleep(0.5)
except KeyboardInterrupt:
    print("\nstopped")
