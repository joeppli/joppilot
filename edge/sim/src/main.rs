use rumqttc::{AsyncClient, MqttOptions, QoS, Event, Incoming, TlsConfiguration, Transport};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::time;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use std::env;
use std::fs;
use jsonschema::JSONSchema;
use serde_json::Value;
use uuid::Uuid;

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
    #[allow(dead_code)]
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
// ------------------------------------------------------------------
fn is_in_approved_territory(lat: f64, lng: f64) -> bool {
    let min_lat = 47.3700;
    let max_lat = 47.3800;
    let min_lng = 8.5300;
    let max_lng = 8.5500;
    lat >= min_lat && lat <= max_lat && lng >= min_lng && lng <= max_lng
}

fn effective_zone(lat: f64, lng: f64, configured_zone: &str) -> String {
    if is_in_approved_territory(lat, lng) {
        configured_zone.to_string()
    } else {
        "out_of_tod".to_string()
    }
}

/// Mirror of contract `isModeAllowedInZone` / ZONE_MODE_MATRIX (ICD §1).
fn mode_allowed_in_zone(zone: &str, mode: &OperationMode) -> bool {
    match zone {
        "public_approved_route" => matches!(mode, OperationMode::MODE1 | OperationMode::DIAG),
        "public_test_permit" | "depot" | "private" | "permitted_test" => true,
        "out_of_tod" => matches!(mode, OperationMode::DIAG),
        _ => false,
    }
}

fn is_diag_disruptive(action: &str) -> bool {
    matches!(action, "RESTART_SERVICE" | "RESTART_COMPUTER" | "RESTART_SENSOR" | "UPDATE_CONFIG")
}

/// Mirror of contract `isDiagDisruptiveAllowed` (ICD §1 footnote). The edge is the
/// authoritative gate: a restart/config that creates a perception/control gap is
/// deferred unless the vehicle sits in a safe state. public_approved_route is
/// "restricted" (only when stationary); off-public/test zones allow it; out_of_tod
/// forbids it. Returns true when the action may run now.
fn diag_disruptive_allowed(action: &str, zone: &str, is_stationary: bool) -> bool {
    if !is_diag_disruptive(action) { return true; }
    match zone {
        "out_of_tod" => false,
        "public_approved_route" => is_stationary,
        _ => true, // public_test_permit, depot, private, permitted_test
    }
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
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

    // Configured zone for this vehicle (distributed as zone configuration; ICD §1).
    let configured_zone = env::var("EDGE_ZONE_TYPE").unwrap_or_else(|_| "public_approved_route".to_string());
    println!("Configured zone type: {}", configured_zone);

    // --- Load the command JSON Schema from the contract (CONTRACT.md) ---
    // The safety kernel validates every command against the contract schema.
    let schema_path = env::var("EDGE_SCHEMA_PATH")
        .unwrap_or_else(|_| "../../packages/contract/schemas/CommandEnvelope.json".to_string());
    let command_schema: Option<Arc<JSONSchema>> = match fs::read_to_string(&schema_path) {
        Ok(raw) => match serde_json::from_str::<Value>(&raw) {
            Ok(v) => match JSONSchema::compile(&v) {
                Ok(c) => {
                    println!("Loaded command schema from {}", schema_path);
                    Some(Arc::new(c))
                }
                Err(e) => { eprintln!("⚠️ Failed to compile schema: {}. SCHEMA_INVALID gate disabled.", e); None }
            },
            Err(e) => { eprintln!("⚠️ Failed to parse schema JSON: {}. SCHEMA_INVALID gate disabled.", e); None }
        },
        Err(e) => { eprintln!("⚠️ Could not read schema at {}: {}. SCHEMA_INVALID gate disabled.", schema_path, e); None }
    };

    let aws_endpoint = env::var("AWS_IOT_ENDPOINT").unwrap_or_default();
    let is_aws = !aws_endpoint.is_empty();

    let host = if is_aws { aws_endpoint } else { "localhost".to_string() };
    let port = if is_aws { 8883 } else { 1883 };

    let mut mqttoptions = MqttOptions::new("edge-vehicle-001", host.clone(), port);
    mqttoptions.set_keep_alive(Duration::from_secs(5));

    if is_aws {
        println!("Configuring mTLS for AWS IoT Core...");
        let ca_cert = fs::read(env::var("AWS_CERT_ROOT_CA_PATH").expect("Missing Root CA")).expect("Failed to read Root CA");
        let client_cert = fs::read(env::var("AWS_CERT_CERT_PATH").expect("Missing Client Cert")).expect("Failed to read Client Cert");
        let client_key = fs::read(env::var("AWS_CERT_PRIVATE_KEY_PATH").expect("Missing Private Key")).expect("Failed to read Private Key");

        let tls_config = TlsConfiguration::Simple {
            ca: ca_cert,
            alpn: None,
            client_auth: Some((client_cert, rumqttc::Key::RSA(client_key))),
        };
        mqttoptions.set_transport(Transport::Tls(tls_config));
    }

    let (client, mut eventloop) = AsyncClient::new(mqttoptions, 10);

    let vehicle_id = "VEH-001";
    let estop_topic = format!("joppilot/v1/vehicles/{}/estop", vehicle_id);
    let command_topic = format!("joppilot/v1/vehicles/{}/command", vehicle_id);
    let ack_topic = format!("joppilot/v1/vehicles/{}/command/ack", vehicle_id);
    let telemetry_topic = format!("joppilot/v1/vehicles/{}/telemetry", vehicle_id);
    let heartbeat_up_topic = format!("joppilot/v1/vehicles/{}/heartbeat", vehicle_id); // vehicle → cloud
    let deadman_topic = format!("joppilot/v1/vehicles/{}/deadman", vehicle_id);         // cloud → vehicle ping
    let proposal_topic = format!("joppilot/v1/vehicles/{}/maneuver/proposal", vehicle_id); // edge → cloud
    let maneuver_status_topic = format!("joppilot/v1/vehicles/{}/maneuver/status", vehicle_id); // edge → cloud

    client.subscribe(&estop_topic, QoS::AtLeastOnce).await.unwrap();
    client.subscribe(&command_topic, QoS::AtLeastOnce).await.unwrap();
    client.subscribe(&deadman_topic, QoS::AtLeastOnce).await.unwrap();
    println!("Subscribed to E-STOP, COMMAND and DEADMAN topics");

    // -------------------- Shared state --------------------
    let location_state = Arc::new(Mutex::new((47.3769, 8.5417)));
    // Safe-stop latch (RES-04). Once engaged it stays engaged across reconnects;
    // only an authorized CLEAR_SAFE_STOP releases it.
    let latched = Arc::new(Mutex::new(false));
    // Newest fencing-token issuedAt the vehicle has seen (ICD §4/§8 single-operator lock).
    let newest_token = Arc::new(Mutex::new(0u64));
    // Idempotency store: command_id → exact ack json (ICD §4 "applied once, same response").
    let seen_commands: Arc<Mutex<HashMap<String, String>>> = Arc::new(Mutex::new(HashMap::new()));
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

    // -------------------- Local watchdog / deadman (RES-01/04) --------------------
    {
        let watchdog_last_contact = last_contact_time.clone();
        let watchdog_latch = latched.clone();
        let watchdog_armed_c = watchdog_armed.clone();
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
                        println!("⚠️ LOCAL WATCHDOG TRIGGERED! Cloud silent >3s → latched SAFE-STOP (local, zero connectivity).");
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
        let zone_for_telemetry = configured_zone.clone();
        let speed_for_telemetry = speed_state.clone();
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

                if tick_count % 10 == 0 && !is_latched {
                    speed = if speed > 25.0 { 10.0 } else { speed + 1.0 };
                }
                if is_latched { speed = 0.0; }
                *speed_for_telemetry.lock().unwrap() = speed;

                let (lat, lng) = {
                    let mut loc = location_for_telemetry.lock().unwrap();
                    if !is_latched {
                        loc.0 += 0.00002 * dir;
                        loc.1 += 0.00002 * dir;
                        if loc.0 > 47.3795 || loc.0 < 47.3705 { dir = -dir; }
                    }
                    (loc.0, loc.1)
                };

                let zone = effective_zone(lat, lng, &zone_for_telemetry);
                let state = if is_latched { "SAFE_STOPPED" } else { "IDLE" };

                let payload = TelemetryPayload {
                    vehicle_id: vehicle_id.to_string(),
                    timestamp: now_ms(),
                    location: Location { lat, lng },
                    speed_kmh: speed,
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
        let zone_for_hb = configured_zone.clone();
        tokio::spawn(async move {
            let mut interval = time::interval(Duration::from_secs(1));
            let mut seq: u64 = 0;
            loop {
                interval.tick().await;
                seq += 1;
                let (lat, lng) = *location_for_hb.lock().unwrap();
                let is_latched = *latch_for_hb.lock().unwrap();
                let hb = Heartbeat {
                    vehicle_id: vehicle_id.to_string(),
                    timestamp: now_ms(),
                    seq,
                    healthy: !is_latched,
                    vehicle_state: if is_latched { "SAFE_STOPPED".to_string() } else { "IDLE".to_string() },
                    current_zone: effective_zone(lat, lng, &zone_for_hb),
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
                        vehicle_id: "VEH-001".to_string(),
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
                    vehicle_id: "VEH-001".to_string(),
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
                    vehicle_id: "VEH-001".to_string(),
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

            // 1) Schema validation (SCHEMA_INVALID, ICD §4) -----------------
            let raw: Value = match serde_json::from_slice(&p.payload) {
                Ok(v) => v,
                Err(_) => { eprintln!("⛔ Dropped non-JSON payload on {}", p.topic); continue; }
            };
            if let Some(schema) = &command_schema {
                if schema.validate(&raw).is_err() {
                    let cid = raw.get("commandId").and_then(|v| v.as_str()).unwrap_or("unknown");
                    println!("⛔ COMMAND REJECTED! Schema invalid. ID: {}", cid);
                    let ack = ack_json(cid, "REJECTED", Some("SCHEMA_INVALID"));
                    client.publish(&ack_topic, QoS::AtLeastOnce, false, ack).await.unwrap();
                    continue;
                }
            }

            let envelope: CommandEnvelope = match serde_json::from_value(raw) {
                Ok(e) => e,
                Err(e) => { eprintln!("⛔ Envelope deserialize failed after schema pass: {}", e); continue; }
            };
            let cid = envelope.command_id.clone();
            let action = envelope.payload.get("action").and_then(|v| v.as_str()).unwrap_or("").to_string();

            // 2) Idempotency (DUPLICATE_COMMAND, ICD §4) --------------------
            // A repeated command_id is applied once and gets the SAME response.
            if let Some(prev) = seen_commands.lock().unwrap().get(&cid).cloned() {
                println!("↩️  DUPLICATE command {} → replaying stored ACK", cid);
                client.publish(&ack_topic, QoS::AtLeastOnce, false, prev).await.unwrap();
                continue;
            }

            // Helper closure cannot borrow `client` across awaits cleanly, so we
            // finalize inline: compute the ack, store it, publish it.
            let now = now_ms();

            // 3) TTL (TTL_EXPIRED, ICD §4) ---------------------------------
            if now > envelope.timestamp + envelope.ttl_ms {
                println!("⛔ COMMAND REJECTED! TTL expired. ID: {}", cid);
                let ack = ack_json(&cid, "REJECTED", Some("TTL_EXPIRED"));
                seen_commands.lock().unwrap().insert(cid.clone(), ack.clone());
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
                    seen_commands.lock().unwrap().insert(cid.clone(), ack.clone());
                    client.publish(&ack_topic, QoS::AtLeastOnce, false, ack).await.unwrap();
                    continue;
                }
                if envelope.token.issued_at > *newest { *newest = envelope.token.issued_at; }
            }

            // E-STOP and SAFE_STOP always engage the latch and ACK (highest priority).
            let is_estop = p.topic == estop_topic || action == "E_STOP";
            let is_safe_stop = action == "SAFE_STOP";

            if is_estop || is_safe_stop {
                *latched.lock().unwrap() = true;
                let tag = if is_estop { "🚨 E-STOP" } else { "🛑 SAFE-STOP" };
                println!("{} APPLIED → latched. ID: {}", tag, cid);
                let ack = ack_json(&cid, "ACK", None);
                seen_commands.lock().unwrap().insert(cid.clone(), ack.clone());
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
                        println!("🔓 SAFE-STOP latch released by authorized CLEAR_SAFE_STOP. ID: {}", cid);
                        let ack = ack_json(&cid, "ACK", None);
                        seen_commands.lock().unwrap().insert(cid.clone(), ack.clone());
                        client.publish(&ack_topic, QoS::AtLeastOnce, false, ack).await.unwrap();
                    } else {
                        drop(l);
                        println!("⛔ COMMAND REJECTED! Vehicle is in latched safe-stop. ID: {}", cid);
                        let ack = ack_json(&cid, "REJECTED", Some("SAFE_STOP_LATCHED"));
                        seen_commands.lock().unwrap().insert(cid.clone(), ack.clone());
                        client.publish(&ack_topic, QoS::AtLeastOnce, false, ack).await.unwrap();
                    }
                    continue;
                }
            }

            // A CLEAR_SAFE_STOP while not latched is a harmless no-op ACK.
            if action == "CLEAR_SAFE_STOP" {
                let ack = ack_json(&cid, "ACK", None);
                seen_commands.lock().unwrap().insert(cid.clone(), ack.clone());
                client.publish(&ack_topic, QoS::AtLeastOnce, false, ack).await.unwrap();
                continue;
            }

            // 6) Zone / mode matrix (GEOFENCE_VIOLATION / MODE_MISMATCH, ICD §1) ---
            let (lat, lng) = *location_state.lock().unwrap();
            let zone = effective_zone(lat, lng, &configured_zone);

            if zone == "out_of_tod" && matches!(envelope.mode, OperationMode::MODE1 | OperationMode::MODE2) {
                // Outside the approved zone → refuse and latch a safe-stop (ICD §1/§9).
                *latched.lock().unwrap() = true;
                println!("⛔ COMMAND REJECTED! Outside approved zone ({:.4},{:.4}) → latched SAFE-STOP. ID: {}", lat, lng, cid);
                let ack = ack_json(&cid, "REJECTED", Some("GEOFENCE_VIOLATION"));
                seen_commands.lock().unwrap().insert(cid.clone(), ack.clone());
                client.publish(&ack_topic, QoS::AtLeastOnce, false, ack).await.unwrap();
                continue;
            }

            if !mode_allowed_in_zone(&zone, &envelope.mode) {
                // e.g. Mode 2 on a public approved route → the vehicle refuses.
                println!("⛔ COMMAND REJECTED! Mode {:?} not allowed in zone '{}'. ID: {}", envelope.mode, zone, cid);
                let ack = ack_json(&cid, "REJECTED", Some("MODE_MISMATCH"));
                seen_commands.lock().unwrap().insert(cid.clone(), ack.clone());
                client.publish(&ack_topic, QoS::AtLeastOnce, false, ack).await.unwrap();
                continue;
            }

            // 6b) Disruptive diagnostics deferred unless in a safe state (ICD §1 footnote).
            // Authoritative state-based check: the edge holds live road speed.
            let is_stationary = *speed_state.lock().unwrap() < 0.5;
            if !diag_disruptive_allowed(&action, &zone, is_stationary) {
                println!("⛔ COMMAND REJECTED! Disruptive diag '{}' deferred (zone '{}', speed-stationary={}). ID: {}", action, zone, is_stationary, cid);
                let ack = ack_json(&cid, "REJECTED", Some("DIAG_DEFERRED"));
                seen_commands.lock().unwrap().insert(cid.clone(), ack.clone());
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
                let matched = prop.as_ref().map(|ap| ap.proposal_id == decision_proposal_id).unwrap_or(false);

                if !matched {
                    drop(prop);
                    println!("⛔ MANEUVER DECISION for unknown/expired proposal '{}'. ID: {}", decision_proposal_id, cid);
                    let ack = ack_json(&cid, "REJECTED", Some("SCHEMA_INVALID"));
                    seen_commands.lock().unwrap().insert(cid.clone(), ack.clone());
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

                let ack = ack_json(&cid, "ACK", None);
                seen_commands.lock().unwrap().insert(cid.clone(), ack.clone());
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
            println!("✅ COMMAND ACCEPTED '{}' mode={:?} zone='{}' ({:.4},{:.4}). ID: {}", action, envelope.mode, zone, lat, lng, cid);
            let ack = ack_json(&cid, "ACK", None);
            seen_commands.lock().unwrap().insert(cid.clone(), ack.clone());
            client.publish(&ack_topic, QoS::AtLeastOnce, false, ack).await.unwrap();
        }
    }
}
