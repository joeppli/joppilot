#!/usr/bin/env python3
"""Teleport the joppilot vehicle back to a spawn point and stop it dead.

Resets position + zeroes linear/angular velocity so the vehicle is at a clean
starting pose. Pass an optional spawn-point index (default 0).

IMPORTANT: the CARLA bridge re-applies the LAST operator control every ~0.1 s.
So reset while the vehicle is HELD STILL, otherwise it drives off again:
  - press "Safe stop" in the console first (latch → bridge holds full brake),
  - run this reset,
  - then "Clear safe-stop latch" and drive again.

Run (CARLA must be up):
    ~/carla-venv/bin/python edge/carla-bridge/carla_reset.py [spawn_index]
"""
import sys

import carla

idx = int(sys.argv[1]) if len(sys.argv) > 1 else 0

client = carla.Client("127.0.0.1", 2000)
client.set_timeout(10.0)
world = client.get_world()

veh = next((a for a in world.get_actors().filter("vehicle.*")
            if a.attributes.get("role_name") == "joppilot"), None)
if veh is None:
    raise SystemExit("joppilot vehicle not found in CARLA — is run-vehicle.sh up?")

spawns = world.get_map().get_spawn_points()
if not spawns:
    raise SystemExit("map has no spawn points")
target = spawns[idx % len(spawns)]
# lift slightly so wheels don't clip into the ground on teleport
target.location.z += 0.3

zero = carla.Vector3D(0, 0, 0)
veh.set_target_velocity(zero)
veh.set_target_angular_velocity(zero)
veh.apply_control(carla.VehicleControl(throttle=0.0, brake=1.0, hand_brake=True))
veh.set_transform(target)

print(f"reset actor {veh.id} → spawn[{idx}] at {target.location}")
print("velocity zeroed + handbrake applied. Now 'Clear safe-stop latch' in the "
      "console to drive again.")
