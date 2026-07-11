# Greengrass V2 core — dev edge host (M3-1)

The vehicle's target runtime (AD-11/AD-16): a Greengrass V2 **core device**
hosting the edge components. In dev the core runs in docker on the developer
machine, next to CARLA. M3-1 design decision: the Rust safety kernel keeps its
own direct mTLS MQTT connection as thing `VEH-001`; the core connects as the
separate thing `VEH-001-core` (no client-id collision) and starts life as the
deployment/lifecycle layer. Moving the kernel onto Greengrass IPC is a later
slice (no official Rust IPC SDK — revisit in M4).

Cloud side (thing, cert, TES role alias, artifacts bucket) is provisioned by
`infra/terraform/modules/greengrass` — apply must be green before step 2.

> **DEV-12 rule:** before the FIRST terraform apply of the greengrass module,
> open Console → IoT Core → Greengrass devices and confirm the free account
> plan doesn't wall it off (like Aurora's express-only wall).

## 1. Prerequisites (once)

- docker + docker compose on the edge host (already used for the sim edge).
- The terraform apply that created `joppilot-dev-greengrass-core-VEH-001` in
  Secrets Manager is green.

## 2. Pull the core's identity bundle (CloudShell → download)

```bash
SEC=$(aws secretsmanager get-secret-value \
  --secret-id joppilot-dev-greengrass-core-VEH-001 \
  --query SecretString --output text --region eu-central-1)
mkdir -p gg && cd gg
echo "$SEC" | jq -r .certificatePem > device.pem.crt
echo "$SEC" | jq -r .privateKey     > private.pem.key
echo "$SEC" | jq -r .rootCa         > AmazonRootCA1.pem
echo "$SEC" | jq -r '{thingName, roleAlias, iotDataEndpoint, iotCredEndpoint}'  # -> config values
tar czf ../gg-core.tgz . && realpath ../gg-core.tgz
```

CloudShell → Actions → Download file → the printed path. On the edge host:

```bash
cd edge/greengrass
mkdir -p gg-certs gg-config
tar xzf ~/İndirilenler/gg-core.tgz -C gg-certs
cp config.yaml.tpl gg-config/config.yaml
# fill the four <...> placeholders with the jq output above
```

(`gg-certs/` and `gg-config/` are gitignored — key material never lands in git.)

## 3. Build the official image (once)

AWS ships no maintained prebuilt v2 image — build it from the official
Dockerfile:

```bash
git clone https://github.com/aws-greengrass/aws-greengrass-docker /tmp/gg-docker
cd /tmp/gg-docker && docker build -t aws-iot-greengrass:latest .
```

(The official Dockerfile defaults to `GREENGRASS_RELEASE_VERSION=latest` — it
downloads whatever the newest nucleus is at build time, so the tag says
`latest` rather than claiming a specific version. To pin a version instead,
pass `--build-arg GREENGRASS_RELEASE_VERSION=<x.y.z>`, tag the image with that
version, and update the `image:` tag in docker-compose.yml to match.)

## 4. Start the core + verify

```bash
cd edge/greengrass
docker compose up -d
docker compose logs -f   # expect: "Launched Nucleus successfully"
```

Cloud-side proof (CloudShell):

```bash
aws greengrassv2 list-core-devices --region eu-central-1
# expect: VEH-001-core with status HEALTHY
```

## 5. Next (M3-1 continued)

- VEA component: package the Rust kernel binary as a custom component
  (recipe + artifact in the `joppilot-dev-gg-artifacts-*` bucket).
- CARLA bridge component (Python, official SDK) — CARLA localhost:2000 ↔ kernel.
