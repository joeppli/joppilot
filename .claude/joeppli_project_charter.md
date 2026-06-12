# Jöppli - Project Charter

**Version:** 1.0 · **Date:** June 11, 2026
**Company:** Jöppli - Autonomous Recycling Logistics · Glarus, Switzerland · kontakt@joeppli.ch

## 1. Project Purpose

Jöppli establishes an autonomous recycling logistics system that brings the recycling collection point directly to the household's doorstep. Electric, driverless mini-trucks (narrower than a Microlino) arrive at the door on demand; enabling municipalities to offer a doorstep recycling service powered by household-level data, without establishing permanent collection infrastructure or adding headcount.

**Vision statement:** "The future of recycling is at your door."

## 2. Justification (Problem Statement)

The weak link in the circular economy is that the system relies on a single "motivated person" in each household:

- **Effort:** The average distance to Sammelstellen (collection points) is ~500 m; in suburbs and low-density cantons, they are open only two days a week. The elderly, those without cars, and time-constrained households are left out of the system.
- **Waste:** In Zürich, manual sorting of 832 Züri-Säcke bags by ERZ revealed that 40% of the contents were actually recyclable. Illegal dumping and incorrect sorting constitute a hidden tax cost.
- **Lack of Data:** Recycling data at the household, street, or neighborhood level is virtually zero. ERZ had to manually sort 832 bags just to acquire this information.

## 3. Scope

### In-Scope
- **Resident app:** Two-tap doorstep pickup requests, load size selection, live ETA, impact tracking.
- **Autonomous fleet:** Electric, 6-compartment vehicles (glass, paper, metal, plastic, e-waste, other) equipped with sensors and dispatched on-demand; real-time route optimization.
- **City console:** Logging of every pickup by type, weight, and location; live fleet map; simulation; tele-operation; human-in-the-loop intervention capability.
- **Testing:** Simulation tests in Alt-Wiedikon (ongoing) and the 2027 Zürich pilot (with ERZ).
- **Business models:** B2G RaaS contracts (monthly per district) and B2B branded fleets + other waste verticals (hazardous waste, e-waste).

### Out-of-Scope
- Waste processing / sorting facilities (focus is strictly on collection logistics).
- Installation or maintenance of new permanent collection point infrastructure.
- Citizen relationship management (remains with the municipality; Jöppli handles the tech operations).
- Robotaxi / general-purpose autonomous vehicle development (strictly vertical, narrow operational design domain).

## 4. Objectives

| Phase | Period | Objective | Funding |
|---|---|---|---|
| Phase 0 - Simulation | 2026 | Simulation validation in Alt-Wiedikon | Existing resources |
| Phase 1 - Pilot | 2027 | Pilot operation with ERZ in Zürich | Pre-Seed CHF 0.8–1M |
| Phase 2 - Multi-city | 2027–2030 | 3–5 Swiss cities, 5–15 vehicles, in-house fleet management and autonomy stack | Series A CHF 6–8M |
| Phase 3 - EU | 2030+ | EU market entry, 50+ operational vehicles, CHF 5–15M ARR | - |
| Exit | 2032–2035 |

**Market Target:** The Swiss market is CHF 1.5B (~6 million tons of waste annually); the EU municipal waste and recycling collection services market is CHF 30B/year. Reaching CHF 6M ARR with 50 vehicles in 2030 ≈ 0.4% of the Swiss market. Unit economics assumption: 1 vehicle = 0.5 km² urban area.

## 5. Stakeholders

| Stakeholder | Role / Expectation |
|---|---|
| Armağan Arslan (Founder) | Project owner; 10+ years of experience in autonomous vehicle development, deployment, and testing |
| ERZ (Entsorgung + Recycling Zürich) | Pilot partner; integration into the existing fleet without additional personnel |
| Municipalities (B2G) | RaaS customer; manages citizen relationships, gains household-level data |
| Residents | End-user; particularly elderly, car-free, and time-constrained households |
| Investors | Pre-Seed (CHF 0.8–1M) and Series A (CHF 6–8M) |
| Regulators | OAD (Ordinance on Automated Driving, in effect since 2025) permits; BAFU/FOEN recycling targets |
| OEM Partners | Vehicle manufacturing / supply |
| B2B Customers | Branded fleets, hazardous waste, and e-waste verticals |
| Circular Economy Actors | Networking, outreach, and feedback partners |

## 6. Constraints

- **Regulatory:** Driverless operation permits under Swiss OAD; Operational Design Domain (ODD) constraints; compliance with BAFU targets.
- **Technical:** Vehicle width must be narrower than a Microlino; ~0.5 km² coverage per vehicle; 6-compartment interior design; tele-operation and human-in-the-loop capacity is mandatory.
- **Operational:** Must operate without installing new permanent infrastructure; scale without increasing headcount; integrate smoothly into ERZ's existing fleet operations.
- **Financial:** Phase transitions are dependent on funding rounds (Pre-Seed → Series A).
- **Data / Privacy:** Household-level data collection must comply with the Swiss nDSG (and GDPR for the EU phase).

## 7. Assumptions

- Necessary permits for the Zürich pilot under OAD can be secured by 2027.
- Municipalities will adopt the RaaS model (technology by Jöppli, management by the municipality).
- Residents will accept the app-based on-demand model.
- Average revenue above the B2G CHF 3.5–5K/vehicle/month range (≈CHF 10K/vehicle/month) is defensible through a mix of B2B premiums and specialized waste verticals. *(Marked as an open topic in the deck).*

## 8. Risks (Summary)

- Delays in regulatory approvals or restrictive ODD constraints.
- Public acceptance and app adoption rates falling below expectations.
- Inability to validate the targeted unit economics mix (ARR/vehicle).
- Competition in the vertical AV market (horizontal expansion from package delivery or shuttle players).

## 9. Success Criteria

- **Phase 0:** Validation of operational scenarios in the Alt-Wiedikon simulation. *(Numerical acceptance criteria: TBD)*
- **Phase 1 (Pilot):** Deployment of the Zürich pilot with ERZ; logging of every pickup by type/weight/location; tele-operation ratio and completed pickup targets. *(Target KPIs: TBD)*
- **Phase 2:** 3–5 cities, 5–15 vehicles; transition to an proprietary autonomy stack.
- **Phase 3 / Business Target:** 50+ vehicles in 2030, CHF 6M ARR, 0.4% Swiss market share.
- **Outreach Targets (Short-term):** Municipal/OEM/circular economy introductions (networking) and user feedback via QR surveys.

---
*Fields marked as "TBD" (To Be Determined) indicate points where numerical targets are missing in the source materials.*