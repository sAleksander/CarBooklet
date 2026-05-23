---
project: "CarBooklet"
version: 1
status: draft
created: 2026-05-20
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: "# TODO: qps — see Open Questions"
  data_volume: "# TODO: data_volume — see Open Questions"
timeline_budget:
  mvp_weeks: 3
  hard_deadline: "2026-06-30"
  after_hours_only: true
---

## Vision & Problem Statement

A car owner who performs some of their own repairs and diagnostics carries a physical service booklet as their vehicle's entire knowledge base. That booklet can exist in only one place at a time: in the glove box, on a shelf at home, or wherever it was last set down on the day a dashboard warning light appears. When the moment of need arrives — at a mechanic's counter, in a parking lot, or mid-repair in a garage — the record is unavailable. Upcoming oil changes and mandatory technical inspections arrive unnoticed; recurring faults repeat without the owner connecting them across entries. Self-diagnosis relies on memory rather than documented history, and the cost of that reliance is misdiagnosed faults, missed regulatory deadlines, and preventable repair expenses.

Vehicle maintenance and repair records have always been available as structured data — the gap has been the reasoning layer. The AI systems available today can ingest a vehicle's personal history alongside general knowledge of a specific car model and answer the questions a paper booklet cannot: "is this warning code a known issue for my model?", "what caused the last time this same fault appeared?", "what should I check before the upcoming inspection?" No existing maintenance tracker provides this combination of personal history and model-specific reasoning.

## User & Persona

**Primary persona**: A private individual who owns one or two cars and conducts at least some of their own maintenance and diagnostics. They are not a professional mechanic but are technically engaged — capable of reading a diagnostic error code, replacing standard parts, and reasoning about mechanical symptoms. Their need is not just a digital log but a searchable, queryable knowledge base of their car's history that they can interrogate when a problem arises or a deadline approaches.

## Success Criteria

### Primary
A user with at least one registered vehicle asks the AI assistant a question about their car and receives an answer that draws on their logged history and on knowledge specific to their car model. The response is grounded in the user's own vehicle data — not generic car advice that would apply equally to any make and model.

### Secondary
All vehicle entry types are available: repair (with a cause/context field describing what led to the repair), oil change, technical inspection, insurance, and car data. Multiple cars can be managed independently under a single user account.

### Guardrails
- A user's vehicle data and entries are never accessible from another user's account. Data isolation is unconditional — no sharing, cross-account access, or admin-viewable user data in v1.

## User Stories

### US-01: AI answers a question about my car

- **Given** the user has a car registered in the system
- **When** the user asks the AI assistant an open-ended question about that car
- **Then** the AI assistant answers using knowledge of the car model — and additionally draws on any logged entries that are relevant to the question

#### Acceptance Criteria
- If no entries exist yet, the AI answers using general car model knowledge
- If matching entries exist, the response explicitly references them
- The user sees continuous visible progress while the response is being prepared

## Functional Requirements

### Authentication & Accounts
- FR-001: User can register and log in to their account. Priority: must-have
  > Socrates: Counter-argument considered: "OAuth only to reduce security surface for a small app — no email/password maintenance." Resolution: accepted as an implementation constraint; the FR stands but the auth mechanism leans OAuth. Captured in Forward: tech-stack.

### Car Management
- FR-002: User can add a car (make, model, year, and other identifying data). Priority: must-have
  > Socrates: Counter-argument considered: "Free-text car name is enough for AI context; structured fields add schema complexity." Resolution: rejected — structured make/model/year is load-bearing for model-specific AI knowledge. The AI can't look up OBD2 codes or model-specific known issues without a precise car model identifier.
- FR-009: User can manage multiple cars (add, switch between, remove). Priority: must-have
  > Socrates: Counter-argument considered: "Multi-car adds schema and UX complexity before the single-car flow is validated." Resolution: noted but kept as must-have — the stated persona owns 1–2 cars and designing for one car then retrofitting is technically harder. However, if MVP timeline is tight, multi-car can be deferred to a fast-follow v1.1.

### Entry Logging
- FR-003: User can log a repair entry for a car, including the cause/context (what led to the repair). Priority: must-have
  > Socrates: Counter-argument considered: "Breakdown and repair are the same event; a standalone breakdown type adds unnecessary separation." Resolution: FR revised — breakdown is captured as a cause/description field within a Repair entry, not a standalone type. Repair entry is the core, most universally useful entry type.
- FR-004: *(merged into FR-003 — breakdown is a cause field on a Repair entry)*
- FR-005: User can log an oil change entry for a car (with optional filter/parts details). Priority: must-have
  > Socrates: Counter-argument considered: "Oil change is just a tagged repair entry — a separate type adds UI surface area." Resolution: oil change must remain identifiable as a category (not buried in generic repairs) because the dashboard must query it specifically to remind the user of the next interval. Implementation may share a schema with other service entries but must be queryable by type.
- FR-006: User can log a technical inspection entry for a car (date, result, next due date). Priority: must-have
  > Socrates: Counter-argument considered: "Inspection is just a dated administrative event; a generic entry type covers it." Resolution: accepted as a schema concern (inspection and insurance may share an 'administrative event' schema with a subtype field) but rejected as a user-facing concern — the dashboard MUST prominently surface inspection expiry. In Poland, an expired inspection prohibits road use. This date must be first-class.
- FR-007: User can log an insurance entry for a car (policy period, renewal date). Priority: must-have
  > Socrates: Counter-argument considered: "Insurance data is PII — storing it adds privacy obligations; a calendar reminder is simpler." Resolution: kept, with scope reduced — the app stores renewal date and basic policy metadata only (not policy number or coverage details). The privacy concern is mitigated by minimal data capture. Dashboard visibility of renewal date is the core value.

### Entry Management
- FR-008: User can view, edit, and delete any entry for a car, with a delete confirmation step. Priority: must-have
  > Socrates: Counter-argument considered: "Hard delete without audit trail lets users erase or falsify history the AI relies on." Resolution: hard delete is kept (user owns their data, app is not a legal record) but guarded by a confirmation dialog. The user is the authority on what their car's history says; the AI trusts user-provided data.

### Dashboard
- FR-012: User sees a dashboard/landing page that prominently surfaces upcoming oil change, inspection, and insurance deadlines for each car. Priority: must-have
  > Socrates: (New FR surfaced during Socrates round for FR-005/006/007 — added, no challenge run yet. Oil change, inspection, and insurance expiry are the three "must not miss" dates; the dashboard is the primary UX surface for proactive reminders.)

### AI Assistant
- FR-010: User can ask the AI assistant an open-ended question about a car via a free-text chat interface. Priority: must-have
  > Socrates: Counter-argument considered: "Predefined prompts are faster to ship and more predictable than open chat." Resolution: rejected — the core value is answering questions the user can't anticipate (OBD2 codes, model-specific known issues, recurring pattern analysis). A preset prompt list negates the product's differentiator.
- FR-011: AI assistant answers using the car's logged history (when entries exist) and the system's general knowledge about the specific car model and common issues. Priority: must-have
  > Socrates: Counter-argument considered: "Model-specific knowledge requires a dedicated database — latency and cost may not be worth it." Resolution: resolved — the LLM's pre-training knowledge is sufficient for model-specific context (OBD2 error codes, known model-specific issues like the Renault Clio 2 airbag connector). No dedicated car model database is needed for v1; the LLM's general knowledge covers the use case.

## Non-Functional Requirements

- **Mobile accessibility**: The app must be fully functional on a mobile device browser without requiring installation from an app store. A user in a garage with only their phone must be able to log an entry and interact with the AI assistant. Architecture decisions that would prevent future browser-based installation are ruled out.
- **AI query feedback**: Any AI assistant query must display continuous visible progress to the user from submission through to response delivery. The absence of any visible feedback during AI processing is a regression.

## Business Logic

Given a user's logged vehicle history and car model, the app surfaces relevant context, patterns, and guidance to help the user diagnose and resolve problems or ask questions about their specific car.

The rule consumes two categories of input: the user's logged entries for a given car (repairs with their cause context, oil changes, technical inspections, insurance records) and the make, model, and year of that car as an identifier. The output is a response to the user's natural-language question that weaves together what is known about this specific car model — common faults, standard diagnostic codes, manufacturer service intervals — with what the user has personally recorded about their own car. The user encounters this through a free-text chat interface: they ask anything and the app reasons over both sources to produce a grounded answer rather than generic advice.

The value of this rule is in the synthesis: a car-model-aware response that has no personal history is generic; a personal-history-aware response with no car-model knowledge lacks diagnostic context. Neither alone is the product.

## Access Control

User registration and authentication is required to access any part of the application. Unauthenticated requests to any car or entry resource are rejected.

The user model is flat — all registered users have identical capabilities. Every user has full create, read, update, and delete rights over their own cars and entries, and no rights over any other user's data. There are no admin, moderator, or guest roles in v1.

Sign-in behavior: a user who is not authenticated is redirected to the sign-in flow before they can access any car or entry data.

## Non-Goals

- **Car sharing between users**: One car belongs to one user. No co-ownership, shared access, or transfer between accounts in v1. Adding sharing before multi-user access patterns are understood risks data isolation bugs and UX complexity.
- **External history integrations (CarVertical, CEPIK)**: No automated import of vehicle history from third-party services. The app's knowledge base is user-curated; external data quality and integration costs are out of scope for v1.
- **Vehicle fleet management**: No fleet concept — cars belong directly to the user, not to a named fleet. The stated persona owns 1–2 personal cars; fleet grouping adds organizational complexity with no v1 payoff.
- **Native mobile app / app store distribution**: Web-only for v1. The architecture must not prevent future browser-based installation, but no native iOS/Android build and no app store submission are in scope. The distinction between browser-installable and app-store-distributed is a deliberate v1 boundary.

## Open Questions

1. **target_scale.qps** — Queries-per-second estimate not captured during shaping. Given `users: small` (handful of users), this is expected to be negligible — confirm before capacity or rate-limit decisions are made. Owner: user. By: before tech-stack selection.
2. **target_scale.data_volume** — Data volume estimate not captured during shaping. Given the use case (personal car entries, handful of users), expected to be small — confirm before storage decisions are made. Owner: user. By: before tech-stack selection.
3. **FR-012 Socrates round not run** — The dashboard FR (FR-012) was surfaced during the Socrates round for entry-type FRs but did not receive its own challenge. Consider: "Is a dedicated dashboard in v1 scope, or is a simple chronological entry list sufficient to prove the MVP?" Resolution: user decision. By: before implementation planning.
