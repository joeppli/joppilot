# =============================================================================
# IoT module — AWS IoT Core backbone (M2-5b, AD-11)
# =============================================================================
# Stands up the managed MQTT broker + X.509 provisioning that the A-boundary
# (cloud ↔ vehicle) runs over (ICD §2/§3). This slice is INFRASTRUCTURE ONLY:
# things, topic-scoped policies, per-principal certificates and the endpoint.
# The services stay MQTT_ENABLED=false until a later slice mounts the certs and
# flips them over — so provisioning this changes no runtime behaviour and moves
# no message traffic.
#
# COST / DESTROY-BUTTON: IoT Core has NO standing hourly cost (billed per
# message + per connection-minute), so there is nothing to tear down when idle
# — this module is deliberately NOT a destroy-billables target (STANDING RULE
# satisfied). Idle cost ≈ $0; message volume counts against the $80 budget alarm.
#
# DEV-12 probe (2026-07-09) confirmed IoT Core is available on the free account
# plan before this was built.

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

# The account's ATS data endpoint — the host the services/edge connect to
# (matches AWS_IOT_ENDPOINT in the service/edge MQTT clients).
data "aws_iot_endpoint" "ats" {
  endpoint_type = "iot:Data-ATS"
}

# Amazon's public Root CA 1 — the client verifies the broker's server cert
# against this (the services/edge read it as AWS_CERT_ROOT_CA_PATH). Public,
# well-known material; bundled into each principal's secret for convenience.
data "http" "amazon_root_ca1" {
  url = "https://www.amazontrust.com/repository/AmazonRootCA1.pem"
}

locals {
  region  = data.aws_region.current.name
  account = data.aws_caller_identity.current.account_id
  # Per-vehicle topic prefix, e.g. joppilot/v1/vehicles/VEH-001
  # (built in each policy below via the thing-name policy variable).
}

# -----------------------------------------------------------------------------
# Thing registry
# -----------------------------------------------------------------------------
resource "aws_iot_thing_type" "vehicle" {
  name = "${var.name_prefix}-vehicle"

  properties {
    description = "Jöppli autonomous recycling vehicle (VEA edge principal)"
  }
}

resource "aws_iot_thing" "vehicle" {
  for_each        = toset(var.vehicle_ids)
  name            = each.value
  thing_type_name = aws_iot_thing_type.vehicle.name
}

# -----------------------------------------------------------------------------
# Vehicle policy (ONE reusable policy, per-thing scoped via policy variables)
# -----------------------------------------------------------------------------
# ${iot:Connection.Thing.ThingName} resolves to the thing whose name equals the
# MQTT client id used to connect — so a vehicle cert can only touch ITS OWN
# vehicle's topics (SEC-04: authority scoped to the assigned vehicle; prevents
# a compromised cert from commanding the fleet). REQUIREMENT this imposes when
# the edge connects (a later slice / M3): the edge's MQTT client id MUST equal
# its thing name (e.g. VEH-001), not the current sim's "edge-vehicle-001".
data "aws_iam_policy_document" "vehicle" {
  # Connect only as its own thing.
  statement {
    actions   = ["iot:Connect"]
    resources = ["arn:aws:iot:${local.region}:${local.account}:client/$${iot:Connection.Thing.ThingName}"]
  }

  # PUBLISH — vehicle → cloud channels (ICD §3): telemetry, heartbeat, ACK,
  # maneuver proposal/status.
  statement {
    actions = ["iot:Publish"]
    resources = [
      "arn:aws:iot:${local.region}:${local.account}:topic/${var.topic_root}/vehicles/$${iot:Connection.Thing.ThingName}/telemetry",
      "arn:aws:iot:${local.region}:${local.account}:topic/${var.topic_root}/vehicles/$${iot:Connection.Thing.ThingName}/heartbeat",
      "arn:aws:iot:${local.region}:${local.account}:topic/${var.topic_root}/vehicles/$${iot:Connection.Thing.ThingName}/command/ack",
      "arn:aws:iot:${local.region}:${local.account}:topic/${var.topic_root}/vehicles/$${iot:Connection.Thing.ThingName}/maneuver/proposal",
      "arn:aws:iot:${local.region}:${local.account}:topic/${var.topic_root}/vehicles/$${iot:Connection.Thing.ThingName}/maneuver/status",
      # Device Shadow (zone-config): the vehicle publishes get/update to read it.
      "arn:aws:iot:${local.region}:${local.account}:topic/$aws/things/$${iot:Connection.Thing.ThingName}/shadow/name/zone-config/get",
      "arn:aws:iot:${local.region}:${local.account}:topic/$aws/things/$${iot:Connection.Thing.ThingName}/shadow/name/zone-config/update",
    ]
  }

  # SUBSCRIBE — cloud → vehicle channels: command, estop, deadman, zone-config,
  # plus the shadow delta/get responses.
  statement {
    actions = ["iot:Subscribe"]
    resources = [
      "arn:aws:iot:${local.region}:${local.account}:topicfilter/${var.topic_root}/vehicles/$${iot:Connection.Thing.ThingName}/command",
      "arn:aws:iot:${local.region}:${local.account}:topicfilter/${var.topic_root}/vehicles/$${iot:Connection.Thing.ThingName}/estop",
      "arn:aws:iot:${local.region}:${local.account}:topicfilter/${var.topic_root}/vehicles/$${iot:Connection.Thing.ThingName}/deadman",
      "arn:aws:iot:${local.region}:${local.account}:topicfilter/${var.topic_root}/vehicles/$${iot:Connection.Thing.ThingName}/zone-config",
      "arn:aws:iot:${local.region}:${local.account}:topicfilter/$aws/things/$${iot:Connection.Thing.ThingName}/shadow/name/zone-config/update/delta",
      "arn:aws:iot:${local.region}:${local.account}:topicfilter/$aws/things/$${iot:Connection.Thing.ThingName}/shadow/name/zone-config/get/accepted",
    ]
  }

  # RECEIVE — the topics the vehicle is allowed to actually receive on.
  statement {
    actions = ["iot:Receive"]
    resources = [
      "arn:aws:iot:${local.region}:${local.account}:topic/${var.topic_root}/vehicles/$${iot:Connection.Thing.ThingName}/command",
      "arn:aws:iot:${local.region}:${local.account}:topic/${var.topic_root}/vehicles/$${iot:Connection.Thing.ThingName}/estop",
      "arn:aws:iot:${local.region}:${local.account}:topic/${var.topic_root}/vehicles/$${iot:Connection.Thing.ThingName}/deadman",
      "arn:aws:iot:${local.region}:${local.account}:topic/${var.topic_root}/vehicles/$${iot:Connection.Thing.ThingName}/zone-config",
      "arn:aws:iot:${local.region}:${local.account}:topic/$aws/things/$${iot:Connection.Thing.ThingName}/shadow/name/zone-config/update/delta",
      "arn:aws:iot:${local.region}:${local.account}:topic/$aws/things/$${iot:Connection.Thing.ThingName}/shadow/name/zone-config/get/accepted",
    ]
  }
}

resource "aws_iot_policy" "vehicle" {
  name   = "${var.name_prefix}-vehicle"
  policy = data.aws_iam_policy_document.vehicle.json
}

# -----------------------------------------------------------------------------
# Service (backend) policy — the trusted cloud side (command/telemetry)
# -----------------------------------------------------------------------------
# Broad across the vehicle namespace (the backend fans out to the whole fleet);
# per-vehicle authority is enforced in the app (fencing token) + the vehicle
# policy above, which is where split-brain actually matters.
data "aws_iam_policy_document" "service" {
  statement {
    actions   = ["iot:Connect"]
    resources = ["arn:aws:iot:${local.region}:${local.account}:client/joppilot-*"]
  }
  statement {
    actions = ["iot:Publish", "iot:Receive"]
    resources = [
      "arn:aws:iot:${local.region}:${local.account}:topic/${var.topic_root}/vehicles/*",
      "arn:aws:iot:${local.region}:${local.account}:topic/$aws/things/*/shadow/name/zone-config/*",
    ]
  }
  statement {
    actions = ["iot:Subscribe"]
    resources = [
      "arn:aws:iot:${local.region}:${local.account}:topicfilter/${var.topic_root}/vehicles/*",
      "arn:aws:iot:${local.region}:${local.account}:topicfilter/$aws/things/*/shadow/name/zone-config/*",
    ]
  }
}

resource "aws_iot_policy" "service" {
  name   = "${var.name_prefix}-service"
  policy = data.aws_iam_policy_document.service.json
}

# -----------------------------------------------------------------------------
# Certificates + attachments + Secrets Manager
# -----------------------------------------------------------------------------
# AWS generates the keypair (active=true, no CSR). DEV-20: the private keys land
# in the TF state (private S3 + DynamoDB lock) and in Secrets Manager — same
# class as the DEV-19 signing key; revisit with a CSR flow / fleet provisioning
# where the private key never leaves the device before production.

# --- Vehicle certs (one per thing) ---
resource "aws_iot_certificate" "vehicle" {
  for_each = toset(var.vehicle_ids)
  active   = true
}

resource "aws_iot_policy_attachment" "vehicle" {
  for_each = toset(var.vehicle_ids)
  policy   = aws_iot_policy.vehicle.name
  target   = aws_iot_certificate.vehicle[each.key].arn
}

resource "aws_iot_thing_principal_attachment" "vehicle" {
  for_each  = toset(var.vehicle_ids)
  thing     = aws_iot_thing.vehicle[each.key].name
  principal = aws_iot_certificate.vehicle[each.key].arn
}

resource "aws_secretsmanager_secret" "vehicle_cert" {
  for_each                = toset(var.vehicle_ids)
  name                    = "${var.name_prefix}-iot-vehicle-${each.key}"
  description             = "IoT X.509 cert bundle for vehicle ${each.key} (provisioned onto the VEA edge — M2-5b)."
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "vehicle_cert" {
  for_each  = toset(var.vehicle_ids)
  secret_id = aws_secretsmanager_secret.vehicle_cert[each.key].id
  secret_string = jsonencode({
    certificatePem = aws_iot_certificate.vehicle[each.key].certificate_pem
    privateKey     = aws_iot_certificate.vehicle[each.key].private_key
    rootCa         = data.http.amazon_root_ca1.response_body
    iotEndpoint    = data.aws_iot_endpoint.ats.endpoint_address
  })
}

# --- Service cert (one bundle the backend services share) ---
resource "aws_iot_certificate" "service" {
  active = true
}

resource "aws_iot_policy_attachment" "service" {
  policy = aws_iot_policy.service.name
  target = aws_iot_certificate.service.arn
}

resource "aws_secretsmanager_secret" "service_cert" {
  name                    = "${var.name_prefix}-iot-service"
  description             = "IoT X.509 cert bundle for the cloud services (command/telemetry) — mounted into ECS in a later slice (M2-5b)."
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "service_cert" {
  secret_id = aws_secretsmanager_secret.service_cert.id
  secret_string = jsonencode({
    certificatePem = aws_iot_certificate.service.certificate_pem
    privateKey     = aws_iot_certificate.service.private_key
    rootCa         = data.http.amazon_root_ca1.response_body
    iotEndpoint    = data.aws_iot_endpoint.ats.endpoint_address
  })
}
