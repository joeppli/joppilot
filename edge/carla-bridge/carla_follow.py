#!/usr/bin/env python3
"""Chase camera — lock the CARLA spectator behind the joppilot vehicle.

Continuously moves the spectator to sit behind + above the vehicle and look
where it looks, so it stays framed while you drive from the console/gamepad.
Runs until Ctrl-C. Leave it in its own terminal.

Optional args:  distance (m, default 8)   height (m, default 4)
    ~/carla-venv/bin/python edge/carla-bridge/carla_follow.py 10 5
"""
import sys
import time

import carla

DISTANCE = float(sys.argv[1]) if len(sys.argv) > 1 else 8.0
HEIGHT = float(sys.argv[2]) if len(sys.argv) > 2 else 4.0
PITCH = -15.0
SMOOTH = 0.25  # 0..1 — higher snaps faster, lower glides more

client = carla.Client("127.0.0.1", 2000)
client.set_timeout(10.0)
world = client.get_world()
spectator = world.get_spectator()


def find_joppilot():
    for a in world.get_actors().filter("vehicle.*"):
        if a.attributes.get("role_name") == "joppilot":
            return a
    return None


def lerp(a, b, t):
    return a + (b - a) * t


veh = find_joppilot()
if veh is None:
    raise SystemExit("joppilot vehicle not found in CARLA — is run-vehicle.sh up?")

print(f"following actor {veh.id} (dist={DISTANCE}m, height={HEIGHT}m) — Ctrl-C to stop")
try:
    while True:
        if not veh.is_alive:
            veh = find_joppilot()
            if veh is None:
                time.sleep(0.5)
                continue

        vt = veh.get_transform()
        fwd = vt.get_forward_vector()
        # target camera location: behind the car along its heading, lifted up
        target = carla.Location(
            x=vt.location.x - fwd.x * DISTANCE,
            y=vt.location.y - fwd.y * DISTANCE,
            z=vt.location.z + HEIGHT,
        )
        cur = spectator.get_transform().location
        smoothed = carla.Location(
            x=lerp(cur.x, target.x, SMOOTH),
            y=lerp(cur.y, target.y, SMOOTH),
            z=lerp(cur.z, target.z, SMOOTH),
        )
        spectator.set_transform(
            carla.Transform(smoothed, carla.Rotation(pitch=PITCH, yaw=vt.rotation.yaw))
        )
        time.sleep(1.0 / 60.0)
except KeyboardInterrupt:
    print("\nstopped following")
