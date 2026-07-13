# Running the vehicle side (PC-A / the CARLA machine)

This is everything the person on the **CARLA machine** needs. They do **not**
need an AWS account or `aws` CLI — only three certificate files someone sends
them once, plus the IoT endpoint. Authentication to the cloud is entirely by
the vehicle's X.509 certificate (mTLS), exactly like a real vehicle.

## What you receive (once, from the Joppilot operator)

Three files + one hostname:

- `veh.cert.pem`, `veh.key.pem`, `veh.ca.pem`  — the vehicle certificate bundle
- `IOT_ENDPOINT` — e.g. `xxxx-ats.iot.eu-central-1.amazonaws.com`

Put the three files in one folder (e.g. `~/joppilot-certs/`).

## Prerequisites on this machine

- **CARLA** simulator installed and running (default `localhost:2000`).
- **Rust** toolchain — `rustup` stable (`curl https://sh.rustup.rs -sSf | sh`).
- **Python 3** with the `carla` wheel that matches your CARLA version
  (`pip install carla==<your-carla-version>`).
- This repo checked out (the kernel reads `packages/contract/schemas/*.json`).

## Run it (one command)

```bash
# 1. start CARLA (your usual way), then:
export IOT_ENDPOINT=xxxx-ats.iot.eu-central-1.amazonaws.com
export CERT_DIR=~/joppilot-certs
./edge/run-vehicle.sh
```

That launches both on-vehicle processes:
1. the **Rust safety kernel** → connects to AWS IoT Core over mTLS (client id =
   `VEH-001`), and
2. the **CARLA bridge** → attaches to (or spawns) the Joppilot vehicle in CARLA,
   applies commands, and streams the vehicle's pose back.

The vehicle spawns **inside** the approved area (the bridge pins CARLA's origin
to it), so telemetry starts flowing to Joppilot immediately.

### Test the link WITHOUT CARLA first (optional)

```bash
export IOT_ENDPOINT=... CERT_DIR=~/joppilot-certs CARLA_MOCK=1
./edge/run-vehicle.sh          # kinematic mock vehicle — proves the cloud link
```

## What you should see

- `Connected to MQTT Broker (AWS IoT Core (client id / thing = VEH-001))`
- `[bridge] connected to VEA kernel` + `[bridge] spawned vehicle.tesla.model3`
- When the operator drives from Joppilot: `[bridge] applied TURN: {...}` and the
  car steers in CARLA.

## Notes

- No operator heartbeat → the kernel latches a safe-stop after ~3 s (correct
  fail-safe, not a bug). It moves again once the operator is in control from
  Joppilot and driving.
- Drive too far and you leave the approved area → geofence safe-stop latch
  (also correct). The operator releases it from Joppilot ("Clear safe-stop").

---

## Operator one-time setup (Joppilot side, NOT this machine)

For the browser console to drive this vehicle, an **admin** does this once
(the cloud runs with assignment + identity binding on):

```bash
API=<api_endpoint>                       # terraform output api_endpoint
ADMIN_TOKEN=<an admin user's Cognito ID token>
OPERATOR=<the operator's Cognito username>

# 1. Assign the operator to the vehicle (SEC-04):
curl -X POST "$API/api/command/VEH-001/assign" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"operatorId\":\"$OPERATOR\"}"

# 2. Open Mode 2 on the vehicle's zone so steering is allowed (ICD §1):
curl -X POST "$API/api/command/VEH-001/zone" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"zone\":\"depot\",\"permitId\":\"SITE-01\",\"validUntil\":$(( ($(date +%s)+7200)*1000 ))}"
```

Then the operator opens the console (with `VITE_AWS_API_ENDPOINT` set), signs
in, **Take control**, and the steering buttons drive the CARLA vehicle.
