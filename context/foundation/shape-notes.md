---
project: "CarBooklet"
context_type: greenfield
updated: "2026-05-20"
product_type: web-app
target_scale:
  users: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: "2026-06-30"
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  frs_drafted: 11
  quality_check_status: accepted
---

## Vision & Problem Statement

**Pain**: The physical car booklet is bound to a single location — inaccessible remotely, incapable of proactive reminders, and its repair/breakdown history cannot be searched or reasoned over intelligently.

**Moment**: When a warning light appears and the owner needs context from past repairs; when an oil change or inspection deadline approaches unnoticed; when diagnosing a recurring issue and needing to ask "has this happened before?"

**Cost today**: The owner either carries the booklet everywhere (risk of loss) or leaves it at home (unavailable when needed). Deadlines are missed. Repair patterns go unrecognized. Self-diagnosis is done without structured historical context.

**Insight**: LLMs can now reason over personal, structured history — making a car-history-aware AI assistant feasible for the first time. Existing maintenance trackers do not have this layer.

**Primary domain rule shape**: Decision support — the app reasons over the vehicle's history and surfaces answers, patterns, and guidance the owner couldn't derive quickly on their own.

## User & Persona

**Primary persona**: A private individual owning 1–2 cars who conducts at least some repairs and diagnostics themselves. They are not a professional mechanic but are technically capable — they want to understand their car's problems deeply enough to fix or intelligently discuss them.

**Pain category**: Decision support + self-repair aid. The core need is not just record-keeping but AI-assisted reasoning over personal vehicle history to enable better self-diagnosis and repair decisions.

## Access Control

**Authentication**: Email + password or OAuth (social login). User data is server-side and accessible from any device.

**User model**: Flat — all users are equal. Every authenticated user has full control over their own cars and records; no admin/member/guest role separation.

**Smallest access model for MVP**: Single authenticated user role. Each user owns their cars and all entries within them; no sharing, delegation, or admin surface needed for v1.

## Success Criteria

### Primary
User asks the AI about their car and gets an answer that references their own logged repair/service history AND general knowledge about their specific car model. The AI response is grounded in actual user data — not generic car advice.

MVP core flow (proof it works):
1. User signs up / logs in
2. User adds a car (make, model, year)
3. User logs a repair entry (description, date)
4. User opens AI chat and asks about the car / that repair
5. AI responds with context drawn from the logged entry and car model knowledge

### Secondary (nice-to-have for v1)
All entry types from the idea notes are supported: breakdown, repair, oil change, technical inspection, insurance, and car data/profile.

### Guardrails
- **Data isolation**: A user's cars and entries are never visible to other users. Strict per-user data boundary, no exceptions.

### Timeline
`mvp_weeks: 3` (2–3 weeks after-hours, within threshold — no acknowledgment block required)

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
- FR-011: AI assistant answers using the car's logged history (when entries exist) and the LLM's general knowledge about the specific car model and common issues. Priority: must-have
  > Socrates: Counter-argument considered: "Model-specific knowledge requires a dedicated database — latency and cost may not be worth it." Resolution: resolved — the LLM's pre-training knowledge is sufficient for model-specific context (OBD2 error codes, known model-specific issues like the Renault Clio 2 airbag connector). No dedicated car model database is needed for v1; the LLM's general knowledge covers the use case.

## Business Logic

**One-sentence domain rule**: Given a user's logged vehicle history and car model, the app surfaces relevant context, patterns, and guidance to help the user diagnose and resolve problems or ask questions about their specific car.

**What this means in practice**:
- *Inputs*: The user's logged entries (repairs, oil changes, inspections, insurance, breakdown causes) + the car's make/model/year as an identifier.
- *Output*: AI-generated answers that are grounded in the user's actual history and in the LLM's general knowledge of the specific car model and common issues (OBD2 codes, model-specific known faults, service intervals).
- *How the user encounters it*: Through a free-text chat interface where they can ask anything — "why does this warning light keep coming back?", "is this repair cost reasonable for my car model?", "what should I check before my next inspection?". The AI answers by reasoning over both personal history and model knowledge.

**Why this is not empty-CRUD**: The app applies a reasoning rule (contextual AI response grounded in personal + model data) that a spreadsheet or notes app cannot replicate. The value is the synthesis, not the storage.

## Non-Functional Requirements

- **Mobile browser accessibility**: The app must be fully usable on a mobile browser without installation (responsive web). A user in a garage with only their phone must be able to log an entry and ask the AI. The app must be architecturally PWA-compatible for future installability.
- **Visible AI response feedback**: Any AI call must provide continuous visible loading feedback from submission to response arrival. The user must never experience an ambiguous wait where the app appears frozen. Applies to all AI interactions regardless of response latency.

## User Stories

### US-01: AI answers about my car
**Given** the user has a car registered in the system,
**When** the user asks the AI assistant a question about that car,
**Then** the AI answers using general knowledge about the car model — and additionally references any logged entries if they are present and relevant to the question.

## Product Framing

```
product_type:         web-app
target_scale:
  users:              small  (just me, or a handful)
timeline_budget:
  mvp_weeks:          3
  hard_deadline:      2026-06-30
  after_hours_only:   true
```

**Scale note**: At 1,000+ users, LLM API call cost per AI query becomes a significant concern. The domain rule itself doesn't change (per-user, independent history), but prompt length management and API cost-per-query will need attention before scaling. Captured for forward planning.

## Non-Goals

- **Car sharing between users**: One car belongs to one user. No co-ownership, shared access, or transfer between accounts in v1. Adding sharing before multi-user access patterns are understood risks data isolation bugs and UX complexity.
- **External history integrations (CarVertical, CEPIK)**: No automated import of vehicle history from third-party services. The app's knowledge base is user-curated; external data quality and API costs are out of scope for v1.
- **Vehicle fleet management**: No fleet concept — cars belong directly to the user, not to a named fleet. The stated persona owns 1–2 personal cars; fleet grouping adds organizational complexity with no v1 payoff.
- **Native mobile app / app store distribution**: Web-only for v1. PWA-ready architecture is in scope (NFR), but no native iOS/Android build, no app store submission. The distinction between "installable from browser" and "app store app" is a deliberate v1 boundary.

## Quality cross-check

All greenfield quality elements present. No gaps. Status: `accepted`.

- Access Control: present — OAuth + flat user model
- Business Logic: present — one-sentence domain rule captured
- Project artifacts: present
- Timeline-cost acknowledgment: present — 3 weeks, within threshold
- Non-Goals: present — 4 explicit entries

## Forward: tech-stack

*(Informational — for 10x-tech-stack-selector, not part of the PRD)*

- Auth: OAuth preferred (FR-001 Socrates) to avoid email/password maintenance and reduce security surface for a small app. Specific provider TBD in stack selection.
- AI layer: LLM API call per chat query. Prompt will include car make/model/year + all relevant logged entries for context. No dedicated car database — LLM pre-training knowledge covers model-specific use cases.
- PWA-ready architecture required for future installability (NFR). Framework choice should support service workers / PWA manifest.

