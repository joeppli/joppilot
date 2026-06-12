# Jöppli - Product Requirements

**Version:** 1.0 · **Date:** June 11, 2026
**Scope:** Resident App + Autonomous Fleet + City Console - designed to operate as a unified system ("One app, one fleet, one console").

## A. Functional Requirements

### FR-1 · Resident App

| ID | Requirement |
|---|---|
| FR-1.1 | The user must be able to request a doorstep recycling pickup. |
| FR-1.2 | The user must be able to select the load size: Small (1–2 standard bags), Medium (3–5), Big (6–10), Mega (full load / vehicle capacity). |
| FR-1.3 | The app must display the live ETA of the assigned vehicle and the requested load information. |
| FR-1.4 | The app must feature an impact tracking module ("See what you saved"). |
| FR-1.5 | The user must be notified of changes in request status (assigned, en route, completed). |

### FR-2 · Autonomous Fleet (Vehicle + Dispatch)

| ID | Requirement |
|---|---|
| FR-2.1 | Vehicles must be dispatched on-demand. |
| FR-2.2 | Routes must be optimized in real-time. |
| FR-2.3 | The vehicle must feature 6 distinct waste compartments: glass, paper, metal/aluminum, plastic, e-waste, other. |
| FR-2.4 | The vehicle must be equipped with sensors for waste type and fill-level detection. |
| FR-2.5 | The vehicle must be fully electric and capable of driverless operation (under Swiss OAD). |
| FR-2.6 | The vehicle must feature an on-board drop-off interface (labeled compartment lids) to guide users in depositing waste into the correct compartment. |
| FR-2.7 | The vehicle must support tele-operation connectivity for remote intervention. |

### FR-3 · Joppilot (City Console)

| ID | Requirement |
|---|---|
| FR-3.1 | Every pickup must be automatically logged by type, weight, and location. |
| FR-3.2 | The console must provide a live fleet map showing the number of vehicles, number of pickups, and active tele-operation sessions. |
| FR-3.3 | The console must provide a simulation environment for operational scenarios. |
| FR-3.4 | The console must support tele-operation and human-in-the-loop intervention. |
| FR-3.5 | Data must be reportable at the household, street, and neighborhood levels (providing visibility that municipalities currently lack). |
| FR-3.6 | The console must include management modules for locations/geofences, depots, charging & energy, vehicle maintenance/inspection logs, and inventory. |

### FR-4 · Business Model Support

| ID | Requirement |
|---|---|
| FR-4.1 | The system must support zone/district-based operations and reporting to align with B2G monthly RaaS contracts per district. |
| FR-4.2 | The system must be flexible enough to support B2B branded fleets (co-operations with partners) and additional waste verticals (hazardous waste, e-waste). |
| FR-4.3 | Role separation: Authorization must be configured so that technology operations remain with Jöppli, while citizen relationship and administration remain with the municipality. |

---

## B. Non-Functional Requirements

### NFR-1 · Safety
- Driverless operation must fully comply with the requirements of the Swiss Ordinance on Automated Driving (OAD, 2025).
- In situations of autonomy uncertainty, human-in-the-loop / tele-operation must be able to take over; a safe stopping (fail-safe) behavior must be defined.
- The vehicle must be designed to operate safely in pedestrian-dense, narrow urban streets (operational design domain: urban, narrow ODD).

### NFR-2 · Performance
- Route optimization must run in real-time; ETA information must be reflected live to the user. *(Latency/accuracy targets: TBD)*
- The console must display the fleet status in real-time ("LIVE").

### NFR-3 · Scalability
- Unit coverage: 1 vehicle = 0.5 km² urban area.
- The system must scale from a single pilot city (Zürich 2027) → to 3–5 cities (5–15 vehicles) → to EU scale (2030+, 50+ vehicles) without requiring a corresponding increase in headcount.
- A multi-city / multi-tenant architecture must be supported.

### NFR-4 · Reliability and Availability
- High availability must be targeted for fleet and console services.
- In case of connectivity loss, the vehicle must switch to a safe mode; logs must be synchronized once the connection is restored.

### NFR-5 · Information Security and Privacy
- Data collected at the household level must be processed in compliance with the Swiss nDSG, and with GDPR during the EU phase.
- Personal data in reports provided to the municipality must be aggregated/anonymized in accordance with the data purpose.
- Tele-operation and vehicle-to-cloud communication must be encrypted end-to-end.

### NFR-6 · Usability and Accessibility
- Since the target audience includes the elderly, car-free, and time-constrained households, the app flow must be completable in a maximum of two taps and meet accessibility standards such as large text and high contrast.
- Multilingual support: At least DE; FR/IT/EN based on the target market.

### NFR-7 · Interoperability
- The system must integrate seamlessly into ERZ's existing fleet operations without requiring additional personnel ("slots into ERZ's existing fleet").
- Data export/reporting interfaces must be provided for data transfer to municipal systems.

### NFR-8 · Sustainability and Physical Constraints
- Vehicles must be 100% electric; charging and energy management must be monitorable from the console.
- Vehicle width must be narrower than a Microlino (design constraint for narrow street access).
- No installation or maintenance of permanent collection infrastructure shall be required.

### NFR-9 · Maintainability and Traceability
- Vehicle inspections, maintenance, and parts inventory must be manageable via the console.
- All operational events must be logged in an auditable manner.

---
*Notes marked as "TBD" (To Be Determined) indicate quality criteria where numerical targets are missing in the source material.*