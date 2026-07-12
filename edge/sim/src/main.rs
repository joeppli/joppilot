use rumqttc::{AsyncClient, MqttOptions, QoS, Event, Incoming, TlsConfiguration, Transport};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;
use tokio::sync::broadcast;
use tokio::time;
use std::sync::{Arc, Mutex};
use std::collections::{HashMap, VecDeque};
use std::env;
use std::fs;
use jsonschema::JSONSchema;
use serde_json::Value;
use uuid::Uuid;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use base64::Engine as _;

// ------------------------------------------------------------------
// Wire types (mirror @joppilot/contract)
// ------------------------------------------------------------------
#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[allow(non_camel_case_types)]
enum OperationMode {
    MODE1,
    MODE2,
    DIAG,
}

#[derive(Serialize, Deserialize, Debug)]
struct TelemetryPayload {
    #[serde(rename = "vehicleId")]
    vehicle_id: String,
    timestamp: u64,
    location: Location,
    #[serde(rename = "speedKmh")]
    speed_kmh: f32,
    #[serde(rename = "vehicleState")]
    vehicle_state: String,
    mode: OperationMode,
    battery: BatteryTelemetry,
    sensors: Vec<SensorStatus>,
    #[serde(rename = "computeHealth")]
    compute_health: ComputeHealth,
    connection: ConnectionQuality,
    #[serde(rename = "currentZone")]
    current_zone: String,
}

// Vehicle → cloud heartbeat (ICD §3/§9). "I'm here, I'm healthy" + latch state.
#[derive(Serialize, Debug)]
struct Heartbeat {
    #[serde(rename = "vehicleId")]
    vehicle_id: String,
    timestamp: u64,
    seq: u64,
    healthy: bool,
    #[serde(rename = "vehicleState")]
    vehicle_state: String,
    #[serde(rename = "currentZone")]
    current_zone: String,
    latched: bool,
}

// ------------------------------------------------------------------
// Maneuver Proposal (ICD §6) — edge generates, cloud presents to operator
// ------------------------------------------------------------------
#[derive(Serialize, Debug, Clone)]
struct ManeuverOption {
    #[serde(rename = "optionId")]
    option_id: String,
    description: String,
    #[serde(rename = "expectedResult")]
    expected_result: String,
}

#[derive(Serialize, Debug)]
struct ManeuverProposal {
    #[serde(rename = "proposalId")]
    proposal_id: String,
    #[serde(rename = "vehicleId")]
    vehicle_id: String,
    #[serde(rename = "reasonCode")]
    reason_code: String,
    context: ManeuverContext,
    options: Vec<ManeuverOption>,
    #[serde(rename = "validityWindowMs")]
    validity_window_ms: u64,
    #[serde(rename = "defaultOnTimeout")]
    default_on_timeout: String,
    timestamp: u64,
}

#[derive(Serialize, Debug)]
struct ManeuverContext {
    #[serde(rename = "sceneSummary")]
    scene_summary: String,
    #[serde(rename = "sensorRefs")]
    sensor_refs: Vec<String>,
}

#[derive(Serialize, Debug)]
struct ManeuverStatusUpdate {
    #[serde(rename = "proposalId")]
    proposal_id: String,
    #[serde(rename = "vehicleId")]
    vehicle_id: String,
    status: String,
    #[serde(rename = "selectedOptionId", skip_serializing_if = "Option::is_none")]
    selected_option_id: Option<String>,
    timestamp: u64,
}

#[derive(Debug, Clone)]
struct ActiveProposal {
    proposal_id: String,
    default_on_timeout: String,
    deadline_ms: u64,
}

#[derive(Serialize, Deserialize, Debug)]
struct BatteryTelemetry {
    #[serde(rename = "voltageV")]
    voltage_v: f32,
    #[serde(rename = "currentA")]
    current_a: f32,
    #[serde(rename = "temperatureC")]
    temperature_c: f32,
    percent: f32,
}

#[derive(Serialize, Deserialize, Debug)]
struct SensorStatus {
    id: String,
    #[serde(rename = "type")]
    sensor_type: String,
    status: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct ComputeHealth {
    #[serde(rename = "cpuPercent")]
    cpu_percent: f32,
    #[serde(rename = "ramPercent")]
    ram_percent: f32,
    #[serde(rename = "temperatureC")]
    temperature_c: f32,
}

#[derive(Serialize, Deserialize, Debug)]
struct ConnectionQuality {
    #[serde(rename = "rttMs")]
    rtt_ms: u32,
    #[serde(rename = "packetLossPercent")]
    packet_loss_percent: f32,
    carrier: String,
    band: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct Location {
    lat: f64,
    lng: f64,
}

#[derive(Deserialize, Debug)]
struct FencingToken {
    #[serde(rename = "tokenId")]
    #[allow(dead_code)]
    token_id: String,
    #[serde(rename = "issuedAt")]
    issued_at: u64,
}

#[derive(Deserialize, Debug)]
struct CommandEnvelope {
    #[serde(rename = "commandId")]
    command_id: String,
    #[serde(rename = "sessionId")]
    #[allow(dead_code)]
    session_id: String,
    #[serde(rename = "vehicleId")]
    vehicle_id: String,
    #[allow(dead_code)]
    issuer: String,
    mode: OperationMode,
    token: FencingToken,
    timestamp: u64,
    #[serde(rename = "ttlMs")]
    ttl_ms: u64,
    payload: Value,
}

// ------------------------------------------------------------------
// Zone model (ICD §1). The vehicle is the authoritative gate: it
// derives its own zone from its own position and enforces the matrix.
//
// "Approved territory" is a hard-coded polygon (a rectangle here);
// inside it the vehicle is in its CONFIGURED zone type, outside it the
// vehicle is `out_of_tod` (outside approved zone) → all movement is
// refused and a safe-stop is latched.
//
// M2-5 (closes DEV-8): the configured zone is no longer a static env
// var — the cloud DELIVERS signed, revision-monotonic ZoneConfig
// documents (retained topic locally, `zone-config` Device Shadow on
// AWS). EDGE_ZONE_TYPE only seeds the initial state (revision 0).
// Fail-safe: an unverifiable / stale / foreign document is IGNORED and
// the vehicle stays on its current (stricter) zone; a permit's
// validUntil is enforced HERE, cloud-independently — past the window
// the effective zone reverts to the public_approved_route safe default.
// ------------------------------------------------------------------
#[derive(Debug, Clone)]
struct ZoneState {
    zone: String,
    permit_valid_until: Option<u64>,
    revision: u64,
}

fn is_in_approved_territory(lat: f64, lng: f64) -> bool {
    let min_lat = 47.3700;
    let max_lat = 47.3800;
    let min_lng = 8.5300;
    let max_lng = 8.5500;
    lat >= min_lat && lat <= max_lat && lng >= min_lng && lng <= max_lng
}

/// The configured zone type with the permit window enforced on-vehicle:
/// an expired permit can never keep a permissive zone alive (ICD §1).
fn current_zone_type(zs: &ZoneState) -> String {
    if let Some(valid_until) = zs.permit_valid_until {
        if now_ms() > valid_until {
            return "public_approved_route".to_string();
        }
    }
    zs.zone.clone()
}

fn effective_zone(lat: f64, lng: f64, zs: &ZoneState) -> String {
    if is_in_approved_territory(lat, lng) {
        current_zone_type(zs)
    } else {
        "out_of_tod".to_string()
    }
}

/// Ed25519 verification of the cloud signature (ICD §4, M2-5). The signed
/// bytes are the CANONICAL JSON of the document without its `signature`
/// field; serde_json's default BTreeMap object model re-serializes with
/// sorted keys, matching the cloud's canonicalStringify.
fn verify_signature(raw: &Value, key: &VerifyingKey) -> bool {
    let Some(obj) = raw.as_object() else { return false; };
    let Some(sig_b64) = obj.get("signature").and_then(|v| v.as_str()) else { return false; };
    let Ok(sig_bytes) = base64::engine::general_purpose::STANDARD.decode(sig_b64) else { return false; };
    let Ok(sig) = Signature::from_slice(&sig_bytes) else { return false; };
    let mut unsigned = obj.clone();
    unsigned.remove("signature");
    let canonical = match serde_json::to_string(&Value::Object(unsigned)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    key.verify(canonical.as_bytes(), &sig).is_ok()
}

// ------------------------------------------------------------------
// Zone/mode policy (ICD §1 matrix + §4 action classes) — GENERATED by the
// contract build as schemas/ZoneModePolicy.json and loaded FAIL-CLOSED at
// startup, exactly like the command/zone-config schemas. Gate 1 (cloud, TS)
// and Gate 2 (this kernel) therefore read the SAME rules and cannot drift
// (M3-1 — closes the duplication warning that used to live in both files).
// ------------------------------------------------------------------
#[derive(Deserialize, Debug)]
struct ZonePermissions {
    mode1: bool,
    mode2: bool,
    #[serde(rename = "diagRead")]
    diag_read: bool,
    #[serde(rename = "diagActions")]
    diag_actions: bool,
}

#[derive(Deserialize, Debug)]
struct ZoneModePolicy {
    #[serde(rename = "zoneModeMatrix")]
    zone_mode_matrix: HashMap<String, ZonePermissions>,
    #[serde(rename = "mode2Actions")]
    mode2_actions: Vec<String>,
    #[serde(rename = "diagReadActions")]
    diag_read_actions: Vec<String>,
    #[serde(rename = "diagDisruptiveActions")]
    diag_disruptive_actions: Vec<String>,
    #[serde(rename = "diagRestrictedZones")]
    diag_restricted_zones: Vec<String>,
}

impl ZoneModePolicy {
    /// Mirror of contract `isModeAllowedInZone`. Unknown zone = fail-closed.
    fn mode_allowed_in_zone(&self, zone: &str, mode: &OperationMode) -> bool {
        let Some(p) = self.zone_mode_matrix.get(zone) else { return false };
        match mode {
            OperationMode::MODE1 => p.mode1,
            OperationMode::MODE2 => p.mode2,
            OperationMode::DIAG => p.diag_read,
        }
    }

    /// Mirror of contract `inferMode` (ICD §4 command catalogue).
    ///
    /// The authoritative gate derives the operation mode from the ACTION itself
    /// and refuses an envelope whose declared `mode` disagrees (ICD §1: the
    /// cloud link "can drop, be delayed, or be spoofed" — a spoofed/buggy cloud
    /// must not be able to smuggle a Mode 2 driving command onto a public route
    /// by labelling it MODE1).
    fn infer_mode(&self, action: &str) -> OperationMode {
        if self.mode2_actions.iter().any(|a| a == action) {
            return OperationMode::MODE2;
        }
        if self.diag_read_actions.iter().any(|a| a == action)
            || self.diag_disruptive_actions.iter().any(|a| a == action)
        {
            return OperationMode::DIAG;
        }
        OperationMode::MODE1
    }

    /// Mirror of contract `isDiagDisruptiveAllowed` (ICD §1 footnote). The edge
    /// is the authoritative gate: a restart/config that creates a perception/
    /// control gap is deferred unless the vehicle sits in a safe state.
    /// Restricted zones allow it only when stationary; a zone whose matrix row
    /// forbids diag actions (out_of_tod) never allows it.
    fn diag_disruptive_allowed(&self, action: &str, zone: &str, is_stationary: bool) -> bool {
        if !self.diag_disruptive_actions.iter().any(|a| a == action) {
            return true;
        }
        let Some(p) = self.zone_mode_matrix.get(zone) else { return false };
        if !p.diag_actions {
            return false;
        }
        if self.diag_restricted_zones.iter().any(|z| z == zone) {
            return is_stationary;
        }
        true
    }
}

// Idempotency/dedup store (ICD §4). Bounded: dedup only matters within the
// command TTL window (seconds), so a FIFO cap protects the safety kernel from
// unbounded memory growth over a long operation (AD-16: deterministic kernel).
const DEDUP_CAP: usize = 4096;
type DedupStore = Mutex<(HashMap<String, String>, VecDeque<String>)>;

/// Store the exact ack for a command_id so a duplicate replays the SAME response.
fn remember_ack(store: &DedupStore, cid: &str, ack: &str) {
    let mut s = store.lock().unwrap();
    if s.0.insert(cid.to_string(), ack.to_string()).is_none() {
        s.1.push_back(cid.to_string());
        if s.1.len() > DEDUP_CAP {
            if let Some(oldest) = s.1.pop_front() {
                s.0.remove(&oldest);
            }
        }
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

// ------------------------------------------------------------------
// Actuation IPC events (M1-5/M3-1). The kernel is the server on a local
// TCP socket; the CARLA bridge (sim ADS adapter, NON-safety) connects and
// receives NDJSON: `command` events only for envelopes that PASSED Gate 2,
// and `state` events carrying the latch so the bridge can fail-safe (brake)
// on E-STOP/watchdog/geofence without understanding any command semantics.
// ------------------------------------------------------------------
fn state_event(latched: bool) -> String {
    format!(r#"{{"type":"state","latched":{},"timestamp":{}}}"#, latched, now_ms())
}

fn command_event(command_id: &str, action: &str, payload: &Value) -> String {
    serde_json::json!({
        "type": "command",
        "commandId": command_id,
        "action": action,
        "payload": payload,
        "timestamp": now_ms(),
    })
    .to_string()
}

fn ack_json(command_id: &str, status: &str, reason: Option<&str>) -> String {
    match reason {
        Some(r) => format!(
            r#"{{"commandId":"{}","status":"{}","reason":"{}"}}"#,
            command_id, status, r
        ),
        None => format!(r#"{{"commandId":"{}","status":"{}"}}"#, command_id, status),
    }
}

#[tokio::main]
async fn main() {
    println!("Joppilot Edge Safety Kernel starting...");

    // Initial zone for this vehicle. Since M2-5 this only SEEDS the state —
    // the cloud delivers signed zone-config documents at runtime (ICD §1).
    let initial_zone = env::var("EDGE_ZONE_TYPE").unwrap_or_else(|_| "public_approved_route".to_string());
    println!("Initial zone type: {} (awaiting signed zone-config from cloud)", initial_zone);

    // --- Pinned cloud public key (ICD §4, M2-5) ---
    // FAIL-CLOSED: since M2-5 every command must carry a valid cloud
    // signature; a kernel that cannot verify signatures must not run.
    // EDGE_CLOUD_PUBKEY = base64 of the raw 32-byte Ed25519 public key.
    let cloud_pubkey: VerifyingKey = {
        let b64 = env::var("EDGE_CLOUD_PUBKEY").unwrap_or_else(|_| {
            eprintln!("⛔ EDGE_CLOUD_PUBKEY is required since M2-5 (ICD §4: commands are signed). Refusing to start (fail-closed).");
            std::process::exit(1);
        });
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64.trim()).unwrap_or_else(|e| {
            eprintln!("⛔ EDGE_CLOUD_PUBKEY is not valid base64: {}. Refusing to start (fail-closed).", e);
            std::process::exit(1);
        });
        let arr: [u8; 32] = bytes.as_slice().try_into().unwrap_or_else(|_| {
            eprintln!("⛔ EDGE_CLOUD_PUBKEY must be exactly 32 bytes (raw Ed25519). Refusing to start (fail-closed).");
            std::process::exit(1);
        });
        VerifyingKey::from_bytes(&arr).unwrap_or_else(|e| {
            eprintln!("⛔ EDGE_CLOUD_PUBKEY is not a valid Ed25519 key: {}. Refusing to start (fail-closed).", e);
            std::process::exit(1);
        })
    };
    println!("Pinned cloud public key loaded (Ed25519, ICD §4)");

    // --- Load the command JSON Schema from the contract (CONTRACT.md) ---
    // The safety kernel validates every command against the contract schema.
    // FAIL-CLOSED: a safety kernel that cannot validate commands against the
    // contract must not run at all (ICD §4: the vehicle re-validates every
    // command). Starting with the SCHEMA_INVALID gate disabled would silently
    // weaken the authoritative 2nd gate.
    let schema_path = env::var("EDGE_SCHEMA_PATH")
        .unwrap_or_else(|_| "../../packages/contract/schemas/CommandEnvelope.json".to_string());
    let command_schema: JSONSchema = {
        let raw = fs::read_to_string(&schema_path).unwrap_or_else(|e| {
            eprintln!("⛔ Could not read command schema at {}: {}. Refusing to start (fail-closed).", schema_path, e);
            std::process::exit(1);
        });
        let v: Value = serde_json::from_str(&raw).unwrap_or_else(|e| {
            eprintln!("⛔ Failed to parse schema JSON: {}. Refusing to start (fail-closed).", e);
            std::process::exit(1);
        });
        match JSONSchema::compile(&v) {
            Ok(c) => { println!("Loaded command schema from {}", schema_path); c }
            Err(e) => {
                eprintln!("⛔ Failed to compile schema: {}. Refusing to start (fail-closed).", e);
                std::process::exit(1);
            }
        }
    };

    // ZoneConfig schema (M2-5): the zone document decides whether Mode 2 is
    // possible, so it gets the same fail-closed treatment as commands.
    let zoneconfig_schema: JSONSchema = {
        let path = env::var("EDGE_ZONECONFIG_SCHEMA_PATH")
            .unwrap_or_else(|_| "../../packages/contract/schemas/ZoneConfig.json".to_string());
        let raw = fs::read_to_string(&path).unwrap_or_else(|e| {
            eprintln!("⛔ Could not read zone-config schema at {}: {}. Refusing to start (fail-closed).", path, e);
            std::process::exit(1);
        });
        let v: Value = serde_json::from_str(&raw).unwrap_or_else(|e| {
            eprintln!("⛔ Failed to parse zone-config schema JSON: {}. Refusing to start (fail-closed).", e);
            std::process::exit(1);
        });
        match JSONSchema::compile(&v) {
            Ok(c) => { println!("Loaded zone-config schema from {}", path); c }
            Err(e) => {
                eprintln!("⛔ Failed to compile zone-config schema: {}. Refusing to start (fail-closed).", e);
                std::process::exit(1);
            }
        }
    };

    // Zone/mode policy (ICD §1/§4) — generated by the contract build. Same
    // fail-closed rule as the schemas: a kernel without the policy would have
    // to hardcode a fallback, which is exactly the two-gate drift this file
    // exists to close.
    let policy: ZoneModePolicy = {
        let path = env::var("EDGE_POLICY_PATH")
            .unwrap_or_else(|_| "../../packages/contract/schemas/ZoneModePolicy.json".to_string());
        let raw = fs::read_to_string(&path).unwrap_or_else(|e| {
            eprintln!("⛔ Could not read zone/mode policy at {}: {}. Refusing to start (fail-closed).", path, e);
            std::process::exit(1);
        });
        let p: ZoneModePolicy = serde_json::from_str(&raw).unwrap_or_else(|e| {
            eprintln!("⛔ Failed to parse zone/mode policy: {}. Refusing to start (fail-closed).", e);
            std::process::exit(1);
        });
        if p.zone_mode_matrix.is_empty() {
            eprintln!("⛔ Zone/mode policy has an empty matrix. Refusing to start (fail-closed).");
            std::process::exit(1);
        }
        println!("Loaded zone/mode policy from {} ({} zones)", path, p.zone_mode_matrix.len());
        p
    };

    let aws_endpoint = env::var("AWS_IOT_ENDPOINT").unwrap_or_default();
    let is_aws = !aws_endpoint.is_empty();

    let host = if is_aws { aws_endpoint } else { "localhost".to_string() };
    let port = if is_aws { 8883 } else { 1883 };

    // The vehicle's identity. The AWS IoT vehicle policy scopes every topic to
    // ${iot:Connection.Thing.ThingName}, which resolves ONLY when the MQTT
    // client id equals the thing name — so on cloud IoT the client id MUST be
    // the thing name (default VEH-001). EDGE_VEHICLE_ID overrides both the id
    // and the topic namespace together (kept in lock-step on purpose).
    let vehicle_id = env::var("EDGE_VEHICLE_ID").unwrap_or_else(|_| "VEH-001".to_string());

    let mut mqttoptions = MqttOptions::new(vehicle_id.clone(), host.clone(), port);
    mqttoptions.set_keep_alive(Duration::from_secs(5));

    if is_aws {
        println!("Configuring mTLS for AWS IoT Core (client id / thing = {})...", vehicle_id);
        let ca_cert = fs::read(env::var("AWS_CERT_ROOT_CA_PATH").expect("Missing Root CA")).expect("Failed to read Root CA");
        let client_cert = fs::read(env::var("AWS_CERT_CERT_PATH").expect("Missing Client Cert")).expect("Failed to read Client Cert");
        let client_key = fs::read(env::var("AWS_CERT_PRIVATE_KEY_PATH").expect("Missing Private Key")).expect("Failed to read Private Key");

        // AWS IoT's aws_iot_certificate issues an RSA-2048 keypair; the private
        // key comes back as PKCS#1 PEM (-----BEGIN RSA PRIVATE KEY-----), which
        // is exactly rumqttc's Key::RSA. (rumqttc 0.22's Key enum only offers
        // RSA/ECC — no PKCS#8 variant — so keep the provisioning on RSA.)
        let tls_config = TlsConfiguration::Simple {
            ca: ca_cert,
            alpn: None,
            client_auth: Some((client_cert, rumqttc::Key::RSA(client_key))),
        };
        mqttoptions.set_transport(Transport::Tls(tls_config));
    }

    let (client, mut eventloop) = AsyncClient::new(mqttoptions, 10);

    // Leak the id to &'static str (like the former string literal) so the
    // spawned telemetry/heartbeat/proposal tasks can capture it. It is a single
    // small string that lives for the whole process, so the "leak" is free.
    let vehicle_id: &'static str = Box::leak(vehicle_id.into_boxed_str());
    let estop_topic = format!("joppilot/v1/vehicles/{}/estop", vehicle_id);
    let command_topic = format!("joppilot/v1/vehicles/{}/command", vehicle_id);
    let ack_topic = format!("joppilot/v1/vehicles/{}/command/ack", vehicle_id);
    let telemetry_topic = format!("joppilot/v1/vehicles/{}/telemetry", vehicle_id);
    let heartbeat_up_topic = format!("joppilot/v1/vehicles/{}/heartbeat", vehicle_id); // vehicle → cloud
    let deadman_topic = format!("joppilot/v1/vehicles/{}/deadman", vehicle_id);         // cloud → vehicle ping
    let proposal_topic = format!("joppilot/v1/vehicles/{}/maneuver/proposal", vehicle_id); // edge → cloud
    let maneuver_status_topic = format!("joppilot/v1/vehicles/{}/maneuver/status", vehicle_id); // edge → cloud
    // Zone-config delivery (M2-5, DEV-8): retained topic locally; on AWS IoT
    // the `zone-config` named Device Shadow delta/get topics carry the same
    // signed document inside the shadow envelope.
    let zone_config_topic = format!("joppilot/v1/vehicles/{}/zone-config", vehicle_id);
    let shadow_prefix = format!("$aws/things/{}/shadow/name/zone-config", vehicle_id);

    client.subscribe(&estop_topic, QoS::AtLeastOnce).await.unwrap();
    client.subscribe(&command_topic, QoS::AtLeastOnce).await.unwrap();
    client.subscribe(&deadman_topic, QoS::AtLeastOnce).await.unwrap();
    client.subscribe(&zone_config_topic, QoS::AtLeastOnce).await.unwrap();
    if is_aws {
        client.subscribe(format!("{}/update/delta", shadow_prefix), QoS::AtLeastOnce).await.unwrap();
        client.subscribe(format!("{}/get/accepted", shadow_prefix), QoS::AtLeastOnce).await.unwrap();
        // Ask for the current shadow so a config set while offline still lands.
        client.publish(format!("{}/get", shadow_prefix), QoS::AtLeastOnce, false, "{}").await.unwrap();
    }
    println!("Subscribed to E-STOP, COMMAND, DEADMAN and ZONE-CONFIG topics");

    // -------------------- Shared state --------------------
    let location_state = Arc::new(Mutex::new((47.3769, 8.5417)));
    // Zone state (M2-5): seeded from EDGE_ZONE_TYPE, updated only by signed,
    // revision-monotonic cloud zone-config documents.
    let zone_state = Arc::new(Mutex::new(ZoneState {
        zone: initial_zone,
        permit_valid_until: None,
        revision: 0,
    }));
    // Safe-stop latch (RES-04). Once engaged it stays engaged across reconnects;
    // only an authorized CLEAR_SAFE_STOP releases it.
    let latched = Arc::new(Mutex::new(false));
    // Newest fencing-token issuedAt the vehicle has seen (ICD §4/§8 single-operator lock).
    let newest_token = Arc::new(Mutex::new(0u64));
    // Idempotency store: command_id → exact ack json (ICD §4 "applied once, same response").
    let seen_commands: Arc<DedupStore> = Arc::new(Mutex::new((HashMap::new(), VecDeque::new())));
    // Cloud liveness for the local watchdog.
    let last_contact_time = Arc::new(Mutex::new(now_ms()));
    // The watchdog only arms after the FIRST cloud contact: a vehicle that has
    // never connected is not in "connection lost" (ICD §9 is about loss).
    let watchdog_armed = Arc::new(Mutex::new(false));
    // Active maneuver proposal (ICD §6). Only one at a time; edge is authoritative on timeout.
    let active_proposal: Arc<Mutex<Option<ActiveProposal>>> = Arc::new(Mutex::new(None));
    // Live road speed (km/h), produced by the telemetry loop. The disruptive-diag
    // gate (ICD §1) reads it to decide if the vehicle is in a safe stationary state.
    let speed_state = Arc::new(Mutex::new(0.0f32));
    // True once an actuation bridge has fed a pose: the internal motion sim
    // switches off so kernel state mirrors CARLA ground truth (sticky — two
    // writers on location would fight).
    let external_pose = Arc::new(Mutex::new(false));
    // When the last pose arrived — feeds the pose-staleness watchdog below.
    let last_pose_time = Arc::new(Mutex::new(0u64));

    // -------------------- Actuation IPC server (M3-1, B-boundary stand-in) --------
    // Verified-commands-out / pose-in channel for the CARLA bridge. Losing the
    // bridge is fail-safe (nothing actuates); a slow bridge never blocks the
    // kernel (bounded broadcast, lagged events dropped — the 1 Hz state
    // snapshot re-converges the latch on the bridge side).
    let (actuation_tx, _) = broadcast::channel::<String>(64);
    {
        let addr = env::var("EDGE_ACTUATION_ADDR").unwrap_or_else(|_| "127.0.0.1:7077".to_string());
        let tx = actuation_tx.clone();
        let latch_for_ipc = latched.clone();
        let loc_for_ipc = location_state.clone();
        let speed_for_ipc = speed_state.clone();
        let ext_for_ipc = external_pose.clone();
        let pose_time_for_ipc = last_pose_time.clone();
        tokio::spawn(async move {
            let listener = match TcpListener::bind(&addr).await {
                Ok(l) => {
                    println!("Actuation IPC listening on {} (CARLA bridge connects here)", addr);
                    l
                }
                Err(e) => {
                    // Fail-safe direction: no actuation channel = nothing moves.
                    eprintln!("⚠️ Actuation IPC bind failed on {}: {} — running without actuation.", addr, e);
                    return;
                }
            };
            loop {
                let Ok((sock, peer)) = listener.accept().await else { continue };
                println!("🔌 Actuation bridge connected from {}", peer);
                let mut rx = tx.subscribe();
                let (read_half, mut write_half) = sock.into_split();

                // Latch snapshot first, so a (re)connecting bridge converges
                // immediately (it may have missed the latching event).
                let snapshot = state_event(*latch_for_ipc.lock().unwrap());
                if write_half.write_all(format!("{}\n", snapshot).as_bytes()).await.is_err() {
                    continue;
                }

                // Writer: forward broadcast events to this bridge.
                tokio::spawn(async move {
                    loop {
                        match rx.recv().await {
                            Ok(line) => {
                                if write_half.write_all(format!("{}\n", line).as_bytes()).await.is_err() {
                                    break;
                                }
                            }
                            // Dropped events are fine: state snapshots re-converge.
                            Err(broadcast::error::RecvError::Lagged(_)) => continue,
                            Err(_) => break,
                        }
                    }
                });

                // Reader: pose feedback from the bridge (sim ground truth for
                // geofence/telemetry — the vehicle knows where IT is, ICD §1).
                let loc = loc_for_ipc.clone();
                let speed = speed_for_ipc.clone();
                let ext = ext_for_ipc.clone();
                let pose_time = pose_time_for_ipc.clone();
                tokio::spawn(async move {
                    let mut lines = BufReader::new(read_half).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
                        if v.get("type").and_then(|t| t.as_str()) != Some("pose") { continue; }
                        let lat = v.get("lat").and_then(|x| x.as_f64());
                        let lng = v.get("lng").and_then(|x| x.as_f64());
                        let (Some(lat), Some(lng)) = (lat, lng) else { continue };
                        *loc.lock().unwrap() = (lat, lng);
                        if let Some(s) = v.get("speedKmh").and_then(|x| x.as_f64()) {
                            *speed.lock().unwrap() = s as f32;
                        }
                        *pose_time.lock().unwrap() = now_ms();
                        *ext.lock().unwrap() = true;
                    }
                    println!("🔌 Actuation bridge disconnected");
                });
            }
        });
    }

    // -------------------- Local watchdog / deadman (RES-01/04) --------------------
    {
        let watchdog_last_contact = last_contact_time.clone();
        let watchdog_latch = latched.clone();
        let watchdog_armed_c = watchdog_armed.clone();
        let act_for_watchdog = actuation_tx.clone();
        tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_secs(1));
            loop {
                interval.tick().await;
                if !*watchdog_armed_c.lock().unwrap() { continue; }
                let last = *watchdog_last_contact.lock().unwrap();
                let now = now_ms();
                if now > last + 3000 {
                    let mut l = watchdog_latch.lock().unwrap();
                    if !*l {
                        *l = true;
                        drop(l);
                        // The bridge must brake on this even with zero cloud
                        // connectivity — the latch travels over local IPC.
                        let _ = act_for_watchdog.send(state_event(true));
                        println!("⚠️ LOCAL WATCHDOG TRIGGERED! Cloud silent >3s → latched SAFE-STOP (local, zero connectivity).");
                    }
                }
            }
        });
    }

    // -------------------- Pose-staleness watchdog (fail-closed) --------------------
    // Once a bridge has fed ground truth, silence on the pose feed means the
    // kernel no longer knows where the vehicle is or how fast it moves — and
    // the geofence reads exactly that state. The bridge brakes on a CLEAN
    // socket loss itself; this covers the hard-killed bridge whose last CARLA
    // control keeps acting. Fail-closed: latch after 3 s of pose silence.
    // While the feed stays silent an operator CLEAR re-latches within 1 s —
    // no motion command is honoured without a ground-truth basis. Note the
    // last known location/speed stay as-is (reporting zeros would be a lie);
    // the SAFE_STOPPED state is the staleness signal. Thresholds get tuned
    // with OP-7 (watchdog timers) in the pilot.
    {
        let pose_time = last_pose_time.clone();
        let ext = external_pose.clone();
        let latch = latched.clone();
        let act = actuation_tx.clone();
        tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_secs(1));
            loop {
                interval.tick().await;
                if !*ext.lock().unwrap() { continue; }
                let last = *pose_time.lock().unwrap();
                if now_ms() > last + 3000 {
                    let mut l = latch.lock().unwrap();
                    if !*l {
                        *l = true;
                        drop(l);
                        // If the bridge reconnects it converges on this latch
                        // via the connect snapshot and brakes.
                        let _ = act.send(state_event(true));
                        println!("⚠️ POSE FEED SILENT >3s! Ground truth lost → latched SAFE-STOP (fail-closed).");
                    }
                }
            }
        });
    }

    // -------------------- Telemetry loop (10Hz / RTP-02) --------------------
    {
        let client_clone = client.clone();
        let telemetry_topic_clone = telemetry_topic.clone();
        let location_for_telemetry = location_state.clone();
        let latch_for_telemetry = latched.clone();
        let zone_for_telemetry = zone_state.clone();
        let speed_for_telemetry = speed_state.clone();
        let ext_for_telemetry = external_pose.clone();
        let act_for_telemetry = actuation_tx.clone();
        tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_millis(100));
            let mut speed = 10.0;
            let mut tick_count = 0;
            // Oscillate within approved territory so the vehicle does not drift away.
            let mut dir = 1.0_f64;

            loop {
                interval.tick().await;
                tick_count += 1;

                let is_latched = *latch_for_telemetry.lock().unwrap();
                // A connected bridge feeds ground truth (pose/speed) — the
                // internal motion sim must not fight it.
                let ext = *ext_for_telemetry.lock().unwrap();

                if !ext {
                    if tick_count % 10 == 0 && !is_latched {
                        speed = if speed > 25.0 { 10.0 } else { speed + 1.0 };
                    }
                    if is_latched { speed = 0.0; }
                    *speed_for_telemetry.lock().unwrap() = speed;
                }

                let (lat, lng) = {
                    let mut loc = location_for_telemetry.lock().unwrap();
                    if !is_latched && !ext {
                        loc.0 += 0.00002 * dir;
                        loc.1 += 0.00002 * dir;
                        if loc.0 > 47.3795 || loc.0 < 47.3705 { dir = -dir; }
                    }
                    (loc.0, loc.1)
                };

                let zone = effective_zone(lat, lng, &zone_for_telemetry.lock().unwrap().clone());

                // RES-03: a zone/geofence violation is ITSELF a safe-mode
                // trigger — latch autonomously the moment the vehicle leaves
                // approved territory. Do not wait for an inbound command to
                // observe it (the command-path check in the main loop only
                // covers the case where something happens to arrive).
                let is_latched = if zone == "out_of_tod" && !is_latched {
                    *latch_for_telemetry.lock().unwrap() = true;
                    if !ext {
                        *speed_for_telemetry.lock().unwrap() = 0.0;
                        speed = 0.0;
                    }
                    // Local IPC latch → the bridge brakes the sim vehicle.
                    let _ = act_for_telemetry.send(state_event(true));
                    println!("⚠️ GEOFENCE VIOLATION at ({:.4},{:.4}) → latched SAFE-STOP (RES-03).", lat, lng);
                    true
                } else {
                    is_latched
                };

                let state = if is_latched { "SAFE_STOPPED" } else { "IDLE" };

                let payload = TelemetryPayload {
                    vehicle_id: vehicle_id.to_string(),
                    timestamp: now_ms(),
                    location: Location { lat, lng },
                    // The mutex is authoritative: fed by the bridge pose when
                    // one is connected, by the sim block above otherwise.
                    speed_kmh: *speed_for_telemetry.lock().unwrap(),
                    vehicle_state: state.to_string(),
                    mode: OperationMode::MODE1,
                    battery: BatteryTelemetry { voltage_v: 400.0, current_a: 10.5, temperature_c: 30.0, percent: 85.0 },
                    sensors: vec![SensorStatus { id: "CAM_FRONT".to_string(), sensor_type: "CAMERA".to_string(), status: "OK".to_string() }],
                    compute_health: ComputeHealth { cpu_percent: 20.0, ram_percent: 45.0, temperature_c: 55.0 },
                    connection: ConnectionQuality { rtt_ms: 15, packet_loss_percent: 0.0, carrier: "Simulated".to_string(), band: "5G".to_string() },
                    current_zone: zone,
                };

                let json = serde_json::to_string(&payload).unwrap();
                client_clone.publish(&telemetry_topic_clone, QoS::AtMostOnce, false, json).await.unwrap();
            }
        });
    }

    // -------------------- Vehicle → cloud heartbeat (1Hz, ICD §3/§9) --------------------
    {
        let client_clone = client.clone();
        let hb_topic = heartbeat_up_topic.clone();
        let location_for_hb = location_state.clone();
        let latch_for_hb = latched.clone();
        let zone_for_hb = zone_state.clone();
        let act_for_hb = actuation_tx.clone();
        tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_secs(1));
            let mut seq: u64 = 0;
            loop {
                interval.tick().await;
                seq += 1;
                let (lat, lng) = *location_for_hb.lock().unwrap();
                let is_latched = *latch_for_hb.lock().unwrap();
                // 1 Hz latch snapshot on the actuation IPC: re-converges a
                // bridge that lagged/dropped an event (its fail-safe input).
                let _ = act_for_hb.send(state_event(is_latched));
                let hb = Heartbeat {
                    vehicle_id: vehicle_id.to_string(),
                    timestamp: now_ms(),
                    seq,
                    healthy: !is_latched,
                    vehicle_state: if is_latched { "SAFE_STOPPED".to_string() } else { "IDLE".to_string() },
                    current_zone: effective_zone(lat, lng, &zone_for_hb.lock().unwrap().clone()),
                    latched: is_latched,
                };
                let json = serde_json::to_string(&hb).unwrap();
                client_clone.publish(&hb_topic, QoS::AtLeastOnce, false, json).await.unwrap();
            }
        });
    }

    // -------------------- Maneuver proposal generator + timeout (ICD §6, sim) ----------
    {
        let client_clone = client.clone();
        let proposal_topic_clone = proposal_topic.clone();
        let status_topic_clone = maneuver_status_topic.clone();
        let active_prop = active_proposal.clone();
        let latch_for_prop = latched.clone();
        let location_for_prop = location_state.clone();

        tokio::spawn(async move {
            // Wait 10s before first proposal so the system stabilizes
            time::sleep(Duration::from_secs(10)).await;
            let mut interval = time::interval(Duration::from_secs(2));

            let scenarios = [
                ("OBSTACLE", "Stationary obstacle detected on planned path", "CAM_FRONT"),
                ("PEDESTRIAN_CONFLICT", "Pedestrian group near collection point", "LIDAR_FRONT"),
                ("ROAD_BLOCKED", "Parked vehicle blocking the route", "CAM_FRONT"),
            ];
            let mut scenario_idx = 0;

            loop {
                interval.tick().await;

                let is_latched = *latch_for_prop.lock().unwrap();
                if is_latched { continue; }

                // Check timeout on active proposal
                let timeout_info = {
                    let mut p = active_prop.lock().unwrap();
                    if let Some(ref ap) = *p {
                        if now_ms() >= ap.deadline_ms {
                            let info = (ap.proposal_id.clone(), ap.default_on_timeout.clone());
                            *p = None;
                            Some(info)
                        } else {
                            // proposal still active, wait
                            continue;
                        }
                    } else {
                        None
                    }
                }; // MutexGuard dropped here

                if let Some((timed_out_id, default_opt)) = timeout_info {
                    println!("⏰ MANEUVER PROPOSAL TIMED OUT → applying safe default '{}'. ID: {}", default_opt, timed_out_id);
                    let status = ManeuverStatusUpdate {
                        proposal_id: timed_out_id,
                        vehicle_id: vehicle_id.to_string(),
                        status: "TIMED_OUT".to_string(),
                        selected_option_id: Some(default_opt),
                        timestamp: now_ms(),
                    };
                    let json = serde_json::to_string(&status).unwrap();
                    let _ = client_clone.publish(&status_topic_clone, QoS::AtLeastOnce, false, json).await;
                    continue;
                }

                // Generate a new proposal every ~20s (simulated ADS escalation)
                // The interval is 2s but we only generate when there's no active proposal,
                // so effective cadence is ~validityWindowMs + 2s between proposals
                let (reason, summary, sensor) = scenarios[scenario_idx % scenarios.len()];
                scenario_idx += 1;

                let (lat, lng) = *location_for_prop.lock().unwrap();
                let proposal_id = Uuid::new_v4().to_string();
                let validity_ms: u64 = 30_000;

                let opt_a_id = format!("opt-{}-a", &proposal_id[..8]);
                let opt_b_id = format!("opt-{}-b", &proposal_id[..8]);

                let proposal = ManeuverProposal {
                    proposal_id: proposal_id.clone(),
                    vehicle_id: vehicle_id.to_string(),
                    reason_code: reason.to_string(),
                    context: ManeuverContext {
                        scene_summary: format!("{} at ({:.4}, {:.4})", summary, lat, lng),
                        sensor_refs: vec![sensor.to_string()],
                    },
                    options: vec![
                        ManeuverOption {
                            option_id: opt_a_id.clone(),
                            description: "Reroute around obstacle".to_string(),
                            expected_result: "Continue mission with +2min delay".to_string(),
                        },
                        ManeuverOption {
                            option_id: opt_b_id.clone(),
                            description: "Wait and retry after 60s".to_string(),
                            expected_result: "Pause at current position, retry approach".to_string(),
                        },
                    ],
                    validity_window_ms: validity_ms,
                    default_on_timeout: opt_b_id.clone(),
                    timestamp: now_ms(),
                };

                let deadline = now_ms() + validity_ms;
                let active = ActiveProposal {
                    proposal_id: proposal_id.clone(),
                    default_on_timeout: opt_b_id,
                    deadline_ms: deadline,
                };
                *active_prop.lock().unwrap() = Some(active);

                let json = serde_json::to_string(&proposal).unwrap();
                let _ = client_clone.publish(&proposal_topic_clone, QoS::AtLeastOnce, false, json).await;
                println!("📋 MANEUVER PROPOSAL published: {} (reason: {}, window: {}s)", proposal_id, reason, validity_ms / 1000);

                let status = ManeuverStatusUpdate {
                    proposal_id: proposal_id.clone(),
                    vehicle_id: vehicle_id.to_string(),
                    status: "PENDING".to_string(),
                    selected_option_id: None,
                    timestamp: now_ms(),
                };
                let status_json = serde_json::to_string(&status).unwrap();
                let _ = client_clone.publish(&status_topic_clone, QoS::AtLeastOnce, false, status_json).await;
            }
        });
    }

    // -------------------- Command ingest / 2nd gate (authoritative) --------------------
    loop {
        if let Ok(Event::Incoming(Incoming::Publish(p))) = eventloop.poll().await {
            // Any inbound message proves the cloud is alive → reset & arm the watchdog.
            *last_contact_time.lock().unwrap() = now_ms();
            *watchdog_armed.lock().unwrap() = true;

            // The deadman topic is just a liveness ping; nothing to validate.
            if p.topic == deadman_topic {
                continue;
            }

            // Zone-config delivery (M2-5, ICD §1 — closes DEV-8). FAIL-SAFE:
            // anything unverifiable, foreign or stale is IGNORED — the
            // vehicle keeps its current (stricter) zone; there is no NACK
            // path for config, the cloud observes the outcome via telemetry
            // currentZone.
            if p.topic == zone_config_topic || p.topic.starts_with(&shadow_prefix) {
                let raw: Value = match serde_json::from_slice(&p.payload) {
                    Ok(v) => v,
                    Err(_) => { eprintln!("⛔ Dropped non-JSON zone-config on {}", p.topic); continue; }
                };
                // Unwrap the Device Shadow envelope when present:
                //   update/delta  → {"state":{"config":{...}}}
                //   get/accepted  → {"state":{"desired":{"config":{...}}}}
                let doc = raw.pointer("/state/desired/config")
                    .or_else(|| raw.pointer("/state/config"))
                    .unwrap_or(&raw)
                    .clone();
                if zoneconfig_schema.validate(&doc).is_err() {
                    println!("⛔ ZONE-CONFIG IGNORED: schema invalid (fail-safe, keeping current zone).");
                    continue;
                }
                if !verify_signature(&doc, &cloud_pubkey) {
                    println!("⛔ ZONE-CONFIG IGNORED: signature missing/invalid (fail-safe, keeping current zone).");
                    continue;
                }
                if doc.get("vehicleId").and_then(|v| v.as_str()) != Some(vehicle_id) {
                    println!("⛔ ZONE-CONFIG IGNORED: addressed to another vehicle (fail-safe).");
                    continue;
                }
                let revision = doc.get("revision").and_then(|v| v.as_u64()).unwrap_or(0);
                let zone = doc.get("zone").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let permit_valid_until = doc.pointer("/permit/validUntil").and_then(|v| v.as_u64());
                let mut zs = zone_state.lock().unwrap();
                if revision <= zs.revision {
                    println!("⛔ ZONE-CONFIG IGNORED: revision {} <= current {} (anti-replay, fail-safe).", revision, zs.revision);
                    continue;
                }
                *zs = ZoneState { zone: zone.clone(), permit_valid_until, revision };
                drop(zs);
                println!("🗺️  ZONE-CONFIG APPLIED: zone='{}' permit_valid_until={:?} revision={} (signed, ICD §1).",
                    zone, permit_valid_until, revision);

                // audit-8: report the applied config back so the Device Shadow
                // CONVERGES (desired == reported → no perpetual delta, and an
                // operator inspecting the shadow sees the vehicle's ACTUAL
                // zone, not just what was desired). Echo the config we accepted
                // so reported matches desired exactly. Local (non-shadow)
                // delivery has nothing to report to.
                if is_aws {
                    let reported = serde_json::json!({ "state": { "reported": { "config": doc } } });
                    let _ = client.publish(
                        format!("{}/update", shadow_prefix),
                        QoS::AtLeastOnce, false, reported.to_string(),
                    ).await;
                }
                continue;
            }

            // 1) Schema validation (SCHEMA_INVALID, ICD §4) -----------------
            let raw: Value = match serde_json::from_slice(&p.payload) {
                Ok(v) => v,
                Err(_) => { eprintln!("⛔ Dropped non-JSON payload on {}", p.topic); continue; }
            };
            if command_schema.validate(&raw).is_err() {
                let cid = raw.get("commandId").and_then(|v| v.as_str()).unwrap_or("unknown");
                println!("⛔ COMMAND REJECTED! Schema invalid. ID: {}", cid);
                let ack = ack_json(cid, "REJECTED", Some("SCHEMA_INVALID"));
                client.publish(&ack_topic, QoS::AtLeastOnce, false, ack).await.unwrap();
                continue;
            }

            // 1b) Cloud signature (SCHEMA_INVALID, ICD §4 — mandatory since
            // M2-5). Before anything else acts on the envelope: an unsigned
            // or altered command is not a command.
            if !verify_signature(&raw, &cloud_pubkey) {
                let cid = raw.get("commandId").and_then(|v| v.as_str()).unwrap_or("unknown");
                println!("⛔ COMMAND REJECTED! Cloud signature missing/invalid. ID: {}", cid);
                let ack = ack_json(cid, "REJECTED", Some("SCHEMA_INVALID"));
                client.publish(&ack_topic, QoS::AtLeastOnce, false, ack).await.unwrap();
                continue;
            }

            let envelope: CommandEnvelope = match serde_json::from_value(raw) {
                Ok(e) => e,
                Err(e) => { eprintln!("⛔ Envelope deserialize failed after schema pass: {}", e); continue; }
            };
            let cid = envelope.command_id.clone();
            let action = envelope.payload.get("action").and_then(|v| v.as_str()).unwrap_or("").to_string();

            // 2) Idempotency (DUPLICATE_COMMAND, ICD §4) --------------------
            // A repeated command_id is applied once and gets the SAME response.
            if let Some(prev) = seen_commands.lock().unwrap().0.get(&cid).cloned() {
                println!("↩️  DUPLICATE command {} → replaying stored ACK", cid);
                client.publish(&ack_topic, QoS::AtLeastOnce, false, prev).await.unwrap();
                continue;
            }

            // Helper closure cannot borrow `client` across awaits cleanly, so we
            // finalize inline: compute the ack, store it, publish it.
            let now = now_ms();

            // 2b) Target vehicle (UNAUTHORIZED, ICD §4) --------------------
            // The envelope names its target; the authoritative gate refuses a
            // command addressed to another vehicle no matter what topic it
            // arrived on — Gate 2 exists precisely because cloud routing can
            // be wrong or spoofed (audit-7 finding 5).
            if envelope.vehicle_id != vehicle_id {
                println!("⛔ COMMAND REJECTED! Target '{}' is not this vehicle '{}'. ID: {}", envelope.vehicle_id, vehicle_id, cid);
                let ack = ack_json(&cid, "REJECTED", Some("UNAUTHORIZED"));
                remember_ack(&seen_commands, &cid, &ack);
                client.publish(&ack_topic, QoS::AtLeastOnce, false, ack).await.unwrap();
                continue;
            }

            // E-STOP / SAFE_STOP are the highest-priority commands (ICD §3):
            // stopping is ALWAYS safe to apply, so they must never be refused on
            // a stale-command technicality. They bypass the TTL gate below for
            // the SAME reason they bypass the mode-consistency check further
            // down — refusing a stop fails in the UNSAFE direction, and ICD §4
            // requires E-STOP to arrive on the first attempt and "never [be]
            // queued". A delayed E-STOP is still a stop we want applied.
            let is_estop = p.topic == estop_topic || action == "E_STOP";
            let is_safe_stop = action == "SAFE_STOP";
            let is_stop = is_estop || is_safe_stop;

            // 3) TTL (TTL_EXPIRED, ICD §4) — stop commands exempt (see above) --
            if !is_stop && now > envelope.timestamp + envelope.ttl_ms {
                println!("⛔ COMMAND REJECTED! TTL expired. ID: {}", cid);
                let ack = ack_json(&cid, "REJECTED", Some("TTL_EXPIRED"));
                remember_ack(&seen_commands, &cid, &ack);
                client.publish(&ack_topic, QoS::AtLeastOnce, false, ack).await.unwrap();
                continue;
            }

            // 4) Fencing token re-validation (INVALID_TOKEN, ICD §4/§8) ----
            {
                let mut newest = newest_token.lock().unwrap();
                if envelope.token.issued_at < *newest {
                    drop(newest);
                    println!("⛔ COMMAND REJECTED! Stale fencing token. ID: {}", cid);
                    let ack = ack_json(&cid, "REJECTED", Some("INVALID_TOKEN"));
                    remember_ack(&seen_commands, &cid, &ack);
                    client.publish(&ack_topic, QoS::AtLeastOnce, false, ack).await.unwrap();
                    continue;
                }
                if envelope.token.issued_at > *newest { *newest = envelope.token.issued_at; }
            }

            // E-STOP and SAFE_STOP always engage the latch and ACK (highest
            // priority). They are handled BEFORE the mode-consistency check on
            // purpose — refusing a stop command over a label mismatch would fail
            // in the unsafe direction. Stopping is always safe to apply.
            // (is_estop / is_safe_stop / is_stop are computed above the TTL gate,
            // which these commands deliberately bypass — ICD §3/§4.)
            if is_stop {
                *latched.lock().unwrap() = true;
                // Latch + the stop command itself go to the bridge: braking
                // must not wait for the next 1 Hz snapshot.
                let _ = actuation_tx.send(state_event(true));
                let _ = actuation_tx.send(command_event(&cid, if is_estop { "E_STOP" } else { "SAFE_STOP" }, &envelope.payload));
                let tag = if is_estop { "🚨 E-STOP" } else { "🛑 SAFE-STOP" };
                println!("{} APPLIED → latched. ID: {}", tag, cid);
                let ack = ack_json(&cid, "ACK", None);
                remember_ack(&seen_commands, &cid, &ack);
                client.publish(&ack_topic, QoS::AtLeastOnce, false, ack).await.unwrap();
                continue;
            }

            // 4b) Mode ↔ action consistency (MODE_MISMATCH, ICD §1/§4) -----
            // The declared envelope mode is untrusted input. The vehicle
            // derives the mode from the action itself, so a Mode 2 driving
            // command mislabelled MODE1 can never ride the Mode 1 allowance
            // through the zone matrix below.
            let inferred_mode = policy.infer_mode(&action);
            if envelope.mode != inferred_mode {
                println!("⛔ COMMAND REJECTED! Declared mode {:?} != inferred {:?} for action '{}'. ID: {}",
                    envelope.mode, inferred_mode, action, cid);
                let ack = ack_json(&cid, "REJECTED", Some("MODE_MISMATCH"));
                remember_ack(&seen_commands, &cid, &ack);
                client.publish(&ack_topic, QoS::AtLeastOnce, false, ack).await.unwrap();
                continue;
            }

            // 5) Latch gate (SAFE_STOP_LATCHED, ICD §9) --------------------
            // While latched, only an authorized CLEAR_SAFE_STOP is accepted.
            {
                let mut l = latched.lock().unwrap();
                if *l {
                    if action == "CLEAR_SAFE_STOP" {
                        *l = false;
                        drop(l);
                        let _ = actuation_tx.send(state_event(false));
                        let _ = actuation_tx.send(command_event(&cid, "CLEAR_SAFE_STOP", &envelope.payload));
                        println!("🔓 SAFE-STOP latch released by authorized CLEAR_SAFE_STOP. ID: {}", cid);
                        let ack = ack_json(&cid, "ACK", None);
                        remember_ack(&seen_commands, &cid, &ack);
                        client.publish(&ack_topic, QoS::AtLeastOnce, false, ack).await.unwrap();
                    } else {
                        drop(l);
                        println!("⛔ COMMAND REJECTED! Vehicle is in latched safe-stop. ID: {}", cid);
                        let ack = ack_json(&cid, "REJECTED", Some("SAFE_STOP_LATCHED"));
                        remember_ack(&seen_commands, &cid, &ack);
                        client.publish(&ack_topic, QoS::AtLeastOnce, false, ack).await.unwrap();
                    }
                    continue;
                }
            }

            // A CLEAR_SAFE_STOP while not latched is a harmless no-op ACK.
            if action == "CLEAR_SAFE_STOP" {
                let ack = ack_json(&cid, "ACK", None);
                remember_ack(&seen_commands, &cid, &ack);
                client.publish(&ack_topic, QoS::AtLeastOnce, false, ack).await.unwrap();
                continue;
            }

            // 6) Zone / mode matrix (GEOFENCE_VIOLATION / MODE_MISMATCH, ICD §1) ---
            let (lat, lng) = *location_state.lock().unwrap();
            let zone = effective_zone(lat, lng, &zone_state.lock().unwrap().clone());

            if zone == "out_of_tod" && matches!(envelope.mode, OperationMode::MODE1 | OperationMode::MODE2) {
                // Outside the approved zone → refuse and latch a safe-stop (ICD §1/§9).
                *latched.lock().unwrap() = true;
                let _ = actuation_tx.send(state_event(true));
                println!("⛔ COMMAND REJECTED! Outside approved zone ({:.4},{:.4}) → latched SAFE-STOP. ID: {}", lat, lng, cid);
                let ack = ack_json(&cid, "REJECTED", Some("GEOFENCE_VIOLATION"));
                remember_ack(&seen_commands, &cid, &ack);
                client.publish(&ack_topic, QoS::AtLeastOnce, false, ack).await.unwrap();
                continue;
            }

            if !policy.mode_allowed_in_zone(&zone, &envelope.mode) {
                // e.g. Mode 2 on a public approved route → the vehicle refuses.
                println!("⛔ COMMAND REJECTED! Mode {:?} not allowed in zone '{}'. ID: {}", envelope.mode, zone, cid);
                let ack = ack_json(&cid, "REJECTED", Some("MODE_MISMATCH"));
                remember_ack(&seen_commands, &cid, &ack);
                client.publish(&ack_topic, QoS::AtLeastOnce, false, ack).await.unwrap();
                continue;
            }

            // 6b) Disruptive diagnostics deferred unless in a safe state (ICD §1 footnote).
            // Authoritative state-based check: the edge holds live road speed.
            let is_stationary = *speed_state.lock().unwrap() < 0.5;
            if !policy.diag_disruptive_allowed(&action, &zone, is_stationary) {
                println!("⛔ COMMAND REJECTED! Disruptive diag '{}' deferred (zone '{}', speed-stationary={}). ID: {}", action, zone, is_stationary, cid);
                let ack = ack_json(&cid, "REJECTED", Some("DIAG_DEFERRED"));
                remember_ack(&seen_commands, &cid, &ack);
                client.publish(&ack_topic, QoS::AtLeastOnce, false, ack).await.unwrap();
                continue;
            }

            // 7) Maneuver decision handling (ICD §6) ----------------------
            let is_maneuver_decision = action == "CONFIRM_MANEUVER"
                || action == "REJECT_MANEUVER"
                || action == "SELECT_ALTERNATIVE";

            if is_maneuver_decision {
                let decision_proposal_id = envelope.payload.get("proposalId")
                    .and_then(|v| v.as_str()).unwrap_or("").to_string();
                let selected_option = envelope.payload.get("optionId")
                    .and_then(|v| v.as_str()).map(|s| s.to_string());

                let mut prop = active_proposal.lock().unwrap();
                // ICD §6: past the decision window the vehicle does NOT wait —
                // the safe default applies. The generator loop expires lazily
                // (2 s tick), so check the deadline HERE too: a decision that
                // arrives after the window must not beat the safe default
                // (audit-7 finding 7).
                let matched = prop.as_ref()
                    .map(|ap| ap.proposal_id == decision_proposal_id && now_ms() < ap.deadline_ms)
                    .unwrap_or(false);

                if !matched {
                    drop(prop);
                    println!("⛔ MANEUVER DECISION for unknown/expired proposal '{}'. ID: {}", decision_proposal_id, cid);
                    let ack = ack_json(&cid, "REJECTED", Some("SCHEMA_INVALID"));
                    remember_ack(&seen_commands, &cid, &ack);
                    client.publish(&ack_topic, QoS::AtLeastOnce, false, ack).await.unwrap();
                    continue;
                }

                *prop = None;
                drop(prop);

                let resolved_option = match action.as_str() {
                    "CONFIRM_MANEUVER" => selected_option.unwrap_or_else(|| decision_proposal_id.clone()),
                    "SELECT_ALTERNATIVE" => selected_option.unwrap_or_default(),
                    _ => String::new(), // REJECT_MANEUVER
                };

                println!("✅ MANEUVER {} applied (option: '{}') for proposal {}. ID: {}",
                    action, resolved_option, decision_proposal_id, cid);

                // The decision reaches the (sim) ADS side over the same IPC.
                let _ = actuation_tx.send(command_event(&cid, &action, &envelope.payload));

                let ack = ack_json(&cid, "ACK", None);
                remember_ack(&seen_commands, &cid, &ack);
                client.publish(&ack_topic, QoS::AtLeastOnce, false, ack).await.unwrap();

                let status = ManeuverStatusUpdate {
                    proposal_id: decision_proposal_id,
                    vehicle_id: vehicle_id.to_string(),
                    status: "DECIDED".to_string(),
                    selected_option_id: if resolved_option.is_empty() { None } else { Some(resolved_option) },
                    timestamp: now_ms(),
                };
                let status_json = serde_json::to_string(&status).unwrap();
                client.publish(&maneuver_status_topic, QoS::AtLeastOnce, false, status_json).await.unwrap();
                continue;
            }

            // 8) Accepted ------------------------------------------------
            // Only now — past EVERY gate — does the command reach actuation.
            let _ = actuation_tx.send(command_event(&cid, &action, &envelope.payload));
            println!("✅ COMMAND ACCEPTED '{}' mode={:?} zone='{}' ({:.4},{:.4}). ID: {}", action, envelope.mode, zone, lat, lng, cid);
            let ack = ack_json(&cid, "ACK", None);
            remember_ack(&seen_commands, &cid, &ack);
            client.publish(&ack_topic, QoS::AtLeastOnce, false, ack).await.unwrap();
        }
    }
}
