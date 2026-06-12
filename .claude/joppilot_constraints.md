# Joppilot - Constraints
 
**Scope:** Joppilot - Fleet Management & Remote Control System
 
## 0. About This Document
 
### 0.1 Terms
- **Jöppli / Joeppli:** Driverless, autonomous recycling vehicle. (Not the subject of this document; it is the asset managed by Joppilot.)
- **Joppilot:** The software platform to be built for remote monitoring, supervision, and control of the vehicle/fleet. **This is the subject of this document.**
- **OAD / VAF:** Swiss Ordinance on Automated Driving (Ordinance on Automated Driving / Verordnung über das automatisierte Fahren).
- **nDSG / revFADP:** Revised Swiss Federal Act on Data Protection.
- **FDPIC:** Swiss Federal Data Protection and Information Commissioner (supervisory authority).
- **BehiG / BehiV:** Swiss Disability Equality Act and the related ordinance.
- **Operator (Remote Operator):** The person who remotely supervises/controls the vehicle.

### 0.2 Obligation Levels
Each constraint is labeled with one of the following levels:
- **[M] Mandatory**: Compliance is required. Violation is unacceptable.
- **[R] Recommended**: Strong expectation; deviation must be justified.
- **[O] Out of scope / not a current requirement**: Not needed at this time; the design is expected not to preclude this, but no extra work should be done for it.

## 1. Scope and Context Constraints (SCP)
 
| ID | Level | Constraint |
|---|---|---|
| SCP-01 | [M] | Joppilot is designed exclusively for **Swiss** operations. Initial target cantons: **Glarus (GL), Zürich (ZH), Basel (BS/BL)**. |
| SCP-02 | [M] | Joppilot is a **fleet management + remote control/supervision** platform. Core capabilities: fleet monitoring, diagnostics, real-time telemetry/camera streaming, remote supervision/control, route optimization, household-level recycling data collection, and municipal reporting. |
| SCP-03 | [M] | The vehicle's **autonomy/driving software is outside Joppilot's scope.** Joppilot communicates with this stack only through a defined interface; it does not produce driving decisions. |
| SCP-04 | [M] | Fleet operators, developers, and Joeppli engineers are the system's primary users. The interface and reports are designed for this audience. (Note: Municipalities are not primary users at this stage; they may be incorporated in later phases.) |
| SCP-05 | [O] | **A booking (reservation/rental) system is a planned but uncertain component.** Whether it will be built will be clarified in later phases of the project; it is not a firm requirement in the current scope. |

## 2. Legal and Regulatory Constraints (LEG)
 
> Operating driverless vehicles on public roads in Switzerland is subject to the **OAD/VAF framework (in effect since 1 March 2025)**. The constraints below are derived from this framework and from data protection legislation.
 
| ID | Level | Constraint |
|---|---|---|
| LEG-01 | [M] | A driverless vehicle may only be operated on **routes approved by the relevant canton**. Joppilot must be designed to support the vehicle's autonomous movement **only within approved route/zone boundaries** (and to hand control to the teleoperator outside those boundaries). |
| LEG-02 | [M] | A driverless vehicle **must be supervised in real time**, and the **operator performing this supervision must be physically located in Switzerland**. The system must be able to restrict operator access to a control center/network within Switzerland. |
| LEG-03 | [M] | A **pre-departure check** is legally mandatory (brakes, steering, tires, lights, safety faults detected by self-diagnosis, etc.). Joppilot must support this check being performed, recorded, and confirmed by the operator **as a digital workflow.** |
| LEG-04 | [M] | **On-vehicle recording of relevant system/event data is legally mandatory.** Joppilot must ensure that data from supervision/control sessions (commands, telemetry, decisions, and where applicable, video/audio) is recorded and stored in a **time-synchronized, complete, and tamper-evident** manner. |
| LEG-05 | [M] | **Civil liability remains with the vehicle owner** (strict liability, independent of fault). This creates an **auditability and chain of evidence** requirement for Joppilot: who, when, with which authorization, issued which command - all must be traceable. |
| LEG-06 | [M] | Development must comply not only with Swiss **federal** legislation but also with the **canton-level** conditions of the target cantons (GL/ZH/BS). Canton-specific route authorization conditions must be configurable (see Open Items). |
| LEG-07 | [R] | The design should be such that **compliance evidence can be produced** against applicable safety/cybersecurity standards in the driverless vehicle context (see STD-01). |

## 3. Data and Privacy Constraints (DAT)
 
| ID | Level | Constraint |
|---|---|---|
| DAT-01 | [M] | **All data collected at the household level must be processed in compliance with the Swiss nDSG (revFADP).** |
| DAT-02 | [M] | **When expanding to the EU phase**, **GDPR applies additionally** to the extent that data subjects residing in the EU are served. The data model and processes must be designed to be ready for this transition. |
| DAT-03 | [M] | The principles of **purpose limitation and data minimization** must be applied: only data necessary for operations is collected. |
| DAT-04 | [M] | **Personal data in reports provided to municipalities** must be collected in a purpose-appropriate manner and must be **anonymized/pseudonymized**. Municipal reports must not identify individuals at the household level by default. |
| DAT-05 | [M] | **Third parties (faces/license plates) in footage** recorded in public areas must be **anonymized** for uses other than incident/legal purposes. |
| DAT-06 | [M] | **Data retention periods must be defined and enforceable**; deletion/retention must be managed in a manner that does not conflict with legal retention obligations (e.g., event logs). |
| DAT-07 | [M] | **Functioning workflows** must exist for data subject rights (access, export, deletion / "right to be forgotten"). |
| DAT-08 | [M] | **Data residency:** nDSG does not *mandate* storage within Switzerland for this data; transfer to the EU/EEA is possible under adequacy provisions. However, the system must be **adaptable** if a future contract requires **primary storage within Swiss territory** (this is a design flexibility constraint, not a default). |
| DAT-09 | [M] | **Breach notification:** A process/runbook must exist to support notification to the FDPIC "as soon as possible" in the event of high-risk data breaches. (Note: nDSG does not have a fixed 72-hour rule like GDPR.) |
| DAT-10 | [M] | A **named responsible person (privacy owner)** must be appointed for privacy decisions. (Note: nDSG can impose **personal criminal fines** on responsible individuals; accountability must be embedded in the operating model.) |

## 4. Security Constraints (SEC)
  
| ID | Level | Constraint |
|---|---|---|
| SEC-01 | [M] | **Vehicle ↔ cloud communication must be end-to-end encrypted** and based on **mutual authentication**. No unauthenticated device/actor can write data to or receive commands from the system. |
| SEC-02 | [M] | **All data in transit and at rest must be encrypted.** Encryption keys must be managed and rotatable. |
| SEC-03 | [M] | Unauthorized users must not be able to log into the system; roles must be **isolated from each other**. **Multi-factor authentication (MFA) is mandatory** for administrator and operator roles. |
| SEC-04 | [M] | Access is granted according to the **least privilege** principle. Remote control/supervision authorization is valid only for **assigned vehicles**. |
| SEC-05 | [M] | **Only one operator at a time** may hold active control/supervision authority over the same vehicle. Control handover must be controlled, verifiable, and logged; conflicting (split-brain) control must be strictly prevented. |
| SEC-06 | [M] | **All critical actions must be written to an immutable (WORM) audit log**: who, when, on which vehicle, which command. Records must be correlatable via a correlation ID. |
| SEC-07 | [M] | Operator access must be **restrictable to the corporate network / VPN** (see LEG-02). |
| SEC-08 | [M] | Identity/key material on the vehicle side must be **stored securely** and must not be extractable from the device; tampering must be detectable. |
| SEC-09 | [M] | Operator authorization revocation must result in **immediate disconnection**. |
| SEC-10 | [R] | The system should be able to detect anomalous device/communication behavior (fleet security monitoring) and should pass penetration tests (especially on the command channel and authorization/lock logic) **without critical findings**. |

## 5. Real-Time and Performance Constraints (RTP)
 
| ID | Level | Constraint |
|---|---|---|
| RTP-01 | [M] | **At least 5 camera streams** must be transmittable simultaneously for a single vehicle. |
| RTP-02 | [M] | **Real-time streaming for sensor data** must be continuous. |
| RTP-03 | [M] | **Diagnostics for the vehicle and all its sensors must be displayable on a per-vehicle basis**; this requires a continuous **real-time diagnostic stream** from the vehicle. |
| RTP-04 | [M] | **Route optimization must operate in real time**; **ETA information must be reflected to the user instantly.** |
| RTP-05 | [M] | **Constraint interaction (important):** Real-time route optimization (RTP-04) **is bounded by LEG-01.** Optimization can only reorder/reschedule within canton-**approved route/zone boundaries**; it cannot route the vehicle outside an approved route. This priority must be clear to the developer. |
| RTP-06 | [M] | **Video latency for remote supervision/control must be kept low** (target: glass-to-glass < ~500 ms; the final threshold will be validated with the POC/pilot). The E-STOP/command path must have a **stricter latency guarantee than the video path**. |
| RTP-07 | [R] | Video streaming should be **on demand**: continuous street-view recording is not the default, for both cost and **nDSG privacy (privacy-by-design)** reasons. |
| RTP-08 | [M] | Real-time/teleoperations data is **not buffered and played back later**; if the connection degrades, data is not delayed and "caught up" - instead, the system transitions to safe mode (see RES-01). |

## 6. Resilience, Safe Mode, and Connectivity Constraints (RES)
 
| ID | Level | Constraint |
|---|---|---|
| RES-01 | [M] | **When the connection is lost, the vehicle must transition to safe mode (safe-stop).** This behavior must be guaranteed on the vehicle side by a **connection-independent** (local, offline-capable mechanism); it must not depend on the cloud. |
| RES-02 | [M] | **When the connection is re-established, logs must be synchronized** (non-real-time data accumulated during the offline period is transferred losslessly). |
| RES-03 | [M] | Safe mode triggers must include at least: connection loss, heartbeat loss, video freeze/latency, and **zone/geofence violation**. The triggering logic must be graduated/speed-adapted to prevent erroneous triggering (false safe-stop storms); however, the guarantee of transitioning to safe mode must not be compromised. |
| RES-04 | [M] | Safe mode must be graduated: until an authorized person resolves the relevant condition, the vehicle does not resume movement on its own; every entry creates an event record and preserves the associated session log. |
| RES-05 | [M] | **Connectivity resilience:** A single cellular carrier going down must not break operations; multi-carrier / redundant connectivity must be supported. (Note: Tunnel/valley dead zones in Swiss terrain must be anticipated.) |
| RES-06 | [M] | When connectivity degrades, graceful degradation is applied: quality is reduced first, control is preserved as long as possible, and if necessary, safe mode is engaged. |

> Connection loss: The communication link between the vehicle and the cloud is broken. The vehicle can no longer receive commands or send data; in this situation, it transitions to safe mode on its own.

> Heartbeat loss: The vehicle sends periodic "I'm here, I'm running" signals (heartbeats) to the cloud. Even if the link appears technically open, if these signals do not arrive within the expected timeframe, the system/communication is understood to be unhealthy and safe mode is engaged. (In other words, it catches the "frozen/unresponsive" state even without a "complete disconnection.")

> Video latency/freeze: The camera footage sent to the operator stops updating or is delayed to an unacceptable degree. Because the operator cannot supervise the vehicle without current footage, the vehicle is placed in safe mode.

> Zone/geofence violation: The vehicle exits its canton-approved operating zone (geofence = a boundary defined on the map). When the vehicle crosses this boundary, it automatically transitions to safe mode.

## 7. Platform and Infrastructure Constraints (PLT)
 
| ID | Level | Constraint |
|---|---|---|
| PLT-01 | [M] | The system must run on **AWS**. |
| PLT-02 | [M] | AWS infrastructure, in terms of region selection, must be **compliant with Swiss/EU data protection constraints (DAT-08)**. |
| PLT-03 | [R] | Selected services should be evaluated for **lifecycle/longevity** (services at risk of being deprecated/placed in maintenance mode should be avoided; where necessary, replaceability should be preserved through thin abstraction layers). |

## 8. Accessibility Constraints (ACC)
 
| ID | Level | Constraint |
|---|---|---|
| ACC-01 | [M] | The interface must meet at least **WCAG 2.1 AA** (forward-looking target: WCAG 2.2 AA). It must be aligned with the Swiss **eCH-0059** standard. |
| ACC-02 | [M] | **Large text / text resizing:** Content must be **zoomable up to 200%** without loss of functionality. |
| ACC-03 | [M] | **High contrast** and sufficient color contrast must be provided; information must not be conveyed by color alone. |
| ACC-04 | [M] | **Full keyboard operability** and screen reader compatibility must be provided. In particular, the **E-STOP / emergency stop** control must be large, prominent, and keyboard-accessible. |
| ACC-05 | [R] | A published **accessibility statement** should be planned (the BehiG revision may require this). |
| ACC-06 | [O] | **In the EU market phase**, the **EAA (European Accessibility Act)** and EN 301 549 should be evaluated additionally. This is not a primary concern for the current Swiss-only scope. |

> ⚠️ TODO: Laws to be reviewed again.

> Since Joppilot serves municipalities (public sector) and operators, Swiss accessibility legislation is directly relevant. The Swiss technical reference is **eCH-0059**, which references the international **WCAG**; the **BehiG** revision (expected entry into force 1 January 2027) is anticipated to also cover private sector digital services.

> **BehiG**: Disability Equality Act

> **WCAG** (Web Content Accessibility Guidelines) is the de facto international standard for digital accessibility, developed by the W3C's Web Accessibility Initiative (WAI). **WCAG 2.1 AA + eCH-0059** is Switzerland's legal technical reference.

> WCAG Levels: **A** is the lowest (basic criteria that remove severe barriers), **AA** removes additional barriers and establishes a level that works for most users with disabilities including those using assistive technologies such as screen readers, **AAA** is the most stringent/potentially unachievable level. AAA is typically not mandated because some criteria cannot be met for every content type; AA is the target referenced by nearly all accessibility laws including the EU Accessibility Act, UK Equality Act, and US Section 508.

> WCAG 2.1 vs WCAG 2.2: WCAG 2.2 became a W3C Recommendation on 5 October 2023; it is a strict superset of 2.1 (except for one removed criterion), so meeting 2.2 AA automatically also meets 2.1 AA, and there is no disadvantage to targeting 2.2. All three versions - 2.0, 2.1, and 2.2 - are valid standards; 2.2 does not supersede 2.1, but W3C encourages use of the latest version.

> ACC-05: BehiG requires a formal accessibility statement (Erklärung zur Barrierefreiheit) that must be visibly displayed on the website; the statement must include a conformance declaration citing eCH-0059/WCAG 2.1 AA compliance and the creation/last review dates.

> ACC-06 (EU phase - EAA/EN 301 549): Comes into effect when expanding beyond Switzerland. When a company based in non-EU Switzerland provides goods/services to EU countries, its website must comply with the EAA (i.e., meet WCAG 2.1 AA via EN 301 549). The EAA entered into force in June 2025 and requires compliance with EN 301 549 (the EU standard that incorporates WCAG).

## 9. Language and Localization Constraints (LNG)
 
| ID | Level | Constraint |
|---|---|---|
| LNG-01 | [M] | The system must **support multiple languages.** For universality, **English (en)** must always be available. |
| LNG-02 | [M] | The initial 3 target cantons (GL, ZH, BS) are **German-speaking** cantons; therefore **German (de-CH)** and **English (en)** are the primary languages for current operations. |
| LNG-03 | [R] | In preparation for Switzerland-wide expansion, the architecture must not preclude adding **French (fr-CH)** and **Italian (it-CH)** (key-based translation infrastructure). |
| LNG-04 | [M] | Swiss local formats must be supported: number format (e.g., 1'234.56), date format (dd.mm.yyyy), and the **Europe/Zurich** time zone. |
 
## 10. Operational and Scale Constraints (OPS)
 
| ID | Level | Constraint |
|---|---|---|
| OPS-01 | [M] | **Binding current scale: a fleet of approximately 10 vehicles** must be remotely controlled and monitored. Design and tests are dimensioned against **this scale**. |
| OPS-02 | [M] | **At least 5 camera streams** per vehicle (see RTP-01) and real-time sensor/diagnostic streaming must be supported simultaneously **for the entire 10-vehicle fleet**. |
| OPS-03 | [O] | Although no near-term increase in vehicle count is planned, the critical technologies chosen must not make vertical scaling impossible. However, vertical scaling is not a primary objective. |
| OPS-04 | [R] | Since remote supervision video sessions are opened **on demand** (RTP-07), the number of concurrent sessions is limited and independent of fleet size; resource planning should be done accordingly. |
 
## 11. Standards and Compliance Constraints (STD)
 
| ID | Level | Constraint |
|---|---|---|
| STD-01 | [R] | **Alignment** with relevant functional safety and cybersecurity standards in the driverless vehicle context (e.g., ISO 26262, ISO 21448/SOTIF, ISO/SAE 21434, UNECE R155/R156) should be pursued. The full safety case is the responsibility of the vehicle side; Joppilot must be able to produce compliance evidence for the portions of these standards **that apply to it** (e.g., software update management = R156, cybersecurity management = R155). |
| STD-02 | [M] | **Software/configuration updates must be controlled** (staged rollout + rollback). This is a requirement of both safe operation and the obligation to keep the vehicle current/maintained (OAD owner obligation). |

 
