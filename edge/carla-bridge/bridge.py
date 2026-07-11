#!/usr/bin/env python3
"""Joppilot CARLA bridge - sim ADS adapter (M1-5 / M3-1, NON-safety).

Connects to the VEA safety kernel's local actuation IPC (TCP, NDJSON) and:
  - applies `command` events (already Gate-2-verified by the kernel) to the
    CARLA vehicle via the CARLA Python API;
  - fail-safes on `state` events: latched -> full brake + hand brake until an
    authorized CLEAR_SAFE_STOP releases the latch;
  - feeds the vehicle's ground-truth pose (lat/lng/speedKmh) back to the
    kernel so geofence + telemetry reflect where the vehicle REALLY is.

Safety lives in the kernel, not here: the bridge never receives a command the
kernel refused, and losing the bridge just stops actuation. If the SOCKET
drops, the bridge brakes on its own - it can no longer hear a latch, so the
only safe assumption is that one may be pending.

CARLA_MOCK=1 swaps the CARLA client for a small kinematic mock so the whole
edge chain is smoke-testable without a simulator (CI / dev laptops).

Env:
  VEA_ACTUATION_ADDR  kernel IPC address        (default 127.0.0.1:7077)
  CARLA_HOST          CARLA simulator host      (default 127.0.0.1)
  CARLA_PORT          CARLA simulator port      (default 2000)
  CARLA_MOCK          "1" -> kinematic mock, no carla import (default "0")
  BRIDGE_POSE_HZ      pose feedback rate        (default 10)
"""

import json
import math
import os
import socket
import sys
import threading
import time

VEA_ADDR = os.environ.get("VEA_ACTUATION_ADDR", "127.0.0.1:7077")
CARLA_HOST = os.environ.get("CARLA_HOST", "127.0.0.1")
CARLA_PORT = int(os.environ.get("CARLA_PORT", "2000"))
CARLA_MOCK = os.environ.get("CARLA_MOCK", "0") == "1"
POSE_HZ = float(os.environ.get("BRIDGE_POSE_HZ", "10"))

# Geo anchor: CARLA maps use local metric coordinates; the kernel's approved
# territory is a WGS84 rectangle around Zurich (see is_in_approved_territory
# in the kernel). The map origin is pinned to the rectangle's center so a
# freshly spawned vehicle starts INSIDE approved territory; driving a few
# hundred meters out exercises the geofence latch for real.
ANCHOR_LAT = 47.3750
ANCHOR_LNG = 8.5400
M_PER_DEG_LAT = 111_320.0


def xy_to_latlng(x_east, y_north):
    lat = ANCHOR_LAT + y_north / M_PER_DEG_LAT
    lng = ANCHOR_LNG + x_east / (M_PER_DEG_LAT * math.cos(math.radians(ANCHOR_LAT)))
    return lat, lng


class ControlState:
    """Last commanded control, merged with the kernel latch (latch wins)."""

    def __init__(self):
        self.lock = threading.Lock()
        self.throttle = 0.0  # 0..1
        self.brake = 0.0     # 0..1
        self.steer = 0.0     # -1..1
        self.reverse = False
        self.hand_brake = False
        self.latched = True  # fail-safe default until the kernel says otherwise

    def stop(self, hand_brake=True):
        self.throttle = 0.0
        self.brake = 1.0
        self.hand_brake = hand_brake

    def effective(self):
        """(throttle, brake, steer, reverse, hand_brake) with the latch applied."""
        with self.lock:
            if self.latched:
                return (0.0, 1.0, 0.0, self.reverse, True)
            return (self.throttle, self.brake, self.steer, self.reverse, self.hand_brake)


def apply_command(ctl, action, payload):
    """Map a verified ICD §4 command onto vehicle control (contract schemas)."""
    with ctl.lock:
        if action != "CREEP":
            ctl.creep_target = None  # a new command supersedes the creep governor
        if action in ("E_STOP", "SAFE_STOP"):
            ctl.stop()  # the latch in the state events keeps it braked
        elif action == "CLEAR_SAFE_STOP":
            ctl.brake = 0.0
            ctl.hand_brake = False
            ctl.throttle = 0.0  # released, but not moving until told to
        elif action == "DRIVE":
            ctl.throttle = max(0.0, min(1.0, payload.get("throttle", 0) / 100.0))
            ctl.brake = max(0.0, min(1.0, payload.get("brake", 0) / 100.0))
            ctl.hand_brake = False
        elif action == "STEER":
            ctl.steer = max(-1.0, min(1.0, payload.get("angle", 0) / 45.0))
        elif action == "SELECT_DIRECTION":
            direction = payload.get("direction", "FORWARD")
            ctl.reverse = direction == "REVERSE"
            if direction == "NEUTRAL":
                ctl.throttle = 0.0
        elif action == "CREEP":
            # Crude creep: light throttle; the pose loop's governor brakes
            # above the target speed (good enough for a sim adapter).
            ctl.creep_target = payload.get("speedKmh", 3)
            ctl.throttle = 0.15
            ctl.brake = 0.0
            ctl.hand_brake = False
        elif action == "TURN":
            direction = payload.get("direction", "STRAIGHT")
            ctl.steer = {"LEFT": -0.5, "RIGHT": 0.5}.get(direction, 0.0)
        elif action == "PARK":
            if payload.get("engage", True):
                ctl.stop()
            else:
                ctl.hand_brake = False
                ctl.brake = 0.0
        else:
            # Signaling / recycling / mission actions have no actuation in the
            # sim; visible in the log so smoke tests can assert arrival.
            print(f"[bridge] no actuation for '{action}' (logged only)")
    print(f"[bridge] applied {action}: {payload}")


# ---------------------------------------------------------------------------
# Vehicle backends
# ---------------------------------------------------------------------------
class MockVehicle:
    """Kinematic stand-in for a CARLA vehicle (CARLA_MOCK=1)."""

    def __init__(self):
        self.x = 0.0        # meters east of anchor
        self.y = 0.0        # meters north of anchor
        self.yaw = 0.0      # rad, 0 = north
        self.speed_ms = 0.0
        self._t = time.monotonic()

    def apply(self, throttle, brake, steer, reverse, hand_brake):
        now = time.monotonic()
        dt = min(now - self._t, 0.5)
        self._t = now
        accel = throttle * 3.0 - brake * 8.0 - 0.4  # drag
        if hand_brake:
            accel = -10.0
        self.speed_ms = max(0.0, self.speed_ms + accel * dt)
        self.yaw += steer * math.radians(35.0) * dt * (1.0 if self.speed_ms > 0.1 else 0.0)
        dist = self.speed_ms * dt * (-1.0 if reverse else 1.0)
        self.x += math.sin(self.yaw) * dist
        self.y += math.cos(self.yaw) * dist

    def pose(self):
        lat, lng = xy_to_latlng(self.x, self.y)
        return lat, lng, self.speed_ms * 3.6


class CarlaVehicle:
    """Real CARLA backend: attach to (or spawn) the Joppilot vehicle."""

    def __init__(self, host, port):
        import carla  # imported here so mock mode needs no carla wheel

        self._carla = carla
        client = carla.Client(host, port)
        client.set_timeout(10.0)
        self.world = client.get_world()

        self.actor = None
        for actor in self.world.get_actors().filter("vehicle.*"):
            if actor.attributes.get("role_name") == "joppilot":
                self.actor = actor
                break
        if self.actor is None:
            bp_lib = self.world.get_blueprint_library()
            bp = (bp_lib.filter("vehicle.tesla.model3") or bp_lib.filter("vehicle.*"))[0]
            bp.set_attribute("role_name", "joppilot")
            spawn = self.world.get_map().get_spawn_points()[0]
            self.actor = self.world.spawn_actor(bp, spawn)
            print(f"[bridge] spawned {bp.id} at {spawn.location}")
        # Pin the geo anchor to the spawn point: the vehicle starts at the
        # center of the kernel's approved rectangle wherever the map put it.
        loc = self.actor.get_location()
        self.origin_x, self.origin_y = loc.x, loc.y

    def apply(self, throttle, brake, steer, reverse, hand_brake):
        self.actor.apply_control(self._carla.VehicleControl(
            throttle=throttle, brake=brake, steer=steer,
            reverse=reverse, hand_brake=hand_brake,
        ))

    def pose(self):
        loc = self.actor.get_location()
        vel = self.actor.get_velocity()
        # CARLA (Unreal) is left-handed: x east, y SOUTH -> north = -dy.
        x_east = loc.x - self.origin_x
        y_north = -(loc.y - self.origin_y)
        lat, lng = xy_to_latlng(x_east, y_north)
        speed_kmh = 3.6 * math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2)
        return lat, lng, speed_kmh


# ---------------------------------------------------------------------------
# Kernel IPC
# ---------------------------------------------------------------------------
def reader_loop(sock_file, ctl):
    """Consume NDJSON events from the kernel until the socket dies."""
    for line in sock_file:
        try:
            event = json.loads(line)
        except ValueError:
            continue
        etype = event.get("type")
        if etype == "state":
            latched = bool(event.get("latched"))
            with ctl.lock:
                if latched and not ctl.latched:
                    print("[bridge] kernel latch ENGAGED -> full brake")
                    ctl.stop()
                elif not latched and ctl.latched:
                    print("[bridge] kernel latch released")
                ctl.latched = latched
        elif etype == "command":
            apply_command(ctl, event.get("action", ""), event.get("payload") or {})


def main():
    host, port = VEA_ADDR.rsplit(":", 1)
    vehicle = MockVehicle() if CARLA_MOCK else CarlaVehicle(CARLA_HOST, CARLA_PORT)
    print(f"[bridge] backend: {'mock' if CARLA_MOCK else f'CARLA {CARLA_HOST}:{CARLA_PORT}'}")

    ctl = ControlState()
    pose_period = 1.0 / POSE_HZ

    while True:  # reconnect loop
        try:
            sock = socket.create_connection((host, int(port)), timeout=5)
        except OSError as e:
            print(f"[bridge] kernel not reachable at {VEA_ADDR} ({e}) - retrying in 2s")
            time.sleep(2)
            continue

        sock.settimeout(None)
        print(f"[bridge] connected to VEA kernel at {VEA_ADDR}")
        reader = threading.Thread(
            target=reader_loop, args=(sock.makefile("r"), ctl), daemon=True)
        reader.start()

        try:
            while reader.is_alive():
                throttle, brake, steer, reverse, hand_brake = ctl.effective()
                # Creep governor: brake gently above the commanded creep speed.
                target = getattr(ctl, "creep_target", None)
                if target is not None and throttle > 0:
                    if vehicle.pose()[2] > target:
                        brake = max(brake, 0.3)
                        throttle = 0.0
                vehicle.apply(throttle, brake, steer, reverse, hand_brake)

                lat, lng, speed_kmh = vehicle.pose()
                pose = {"type": "pose", "lat": lat, "lng": lng,
                        "speedKmh": round(speed_kmh, 2)}
                sock.sendall((json.dumps(pose) + "\n").encode())
                time.sleep(pose_period)
        except OSError as e:
            print(f"[bridge] kernel socket lost ({e})")
        finally:
            sock.close()

        # FAIL-SAFE: without the kernel we cannot hear a latch, so assume one.
        with ctl.lock:
            ctl.latched = True
            ctl.stop()
        vehicle.apply(*ctl.effective())
        print("[bridge] kernel link down -> braked (fail-safe); reconnecting")
        time.sleep(2)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
