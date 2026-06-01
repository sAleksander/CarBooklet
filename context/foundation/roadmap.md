---
project: CarBooklet
version: 1
status: draft
created: 2026-05-27
updated: 2026-06-01
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: CarBooklet

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

CarBooklet replaces the physical car service booklet — always missing when needed — with a mobile-accessible, AI-queryable record of a vehicle's maintenance and repair history. The core product hypothesis — that an LLM can synthesize a user's personal logged history with general knowledge about their specific car model to answer questions no generic car-advice tool can match — is validated the moment a user adds a car and gets an AI response grounded in its make, model, and year. Entry-grounding (AI referencing logged repairs and services) deepens that proof once entries exist.

## North star

**S-02: user can add a car and ask the AI; AI responds with car-model knowledge** — proves the product's technical core (OpenRouter integration, SSE streaming, visible progress) before entry-grounding complexity is added. With `speed` as the sequencing goal, this is the earliest milestone that confirms the app's differentiating AI layer works on this infrastructure.

> "North star" here means: the smallest end-to-end slice whose successful delivery proves the product's core technical hypothesis — placed as early as its prerequisites allow because everything else only matters if this works.

## At a glance

| ID   | Change ID               | Outcome (user can …)                                                               | Prerequisites    | PRD refs                                        | Status   |
| ---- | ----------------------- | ---------------------------------------------------------------------------------- | ---------------- | ----------------------------------------------- | -------- |
| F-01 | cars-schema             | (foundation) cars table + RLS live in Supabase                                    | —                | FR-002, FR-009                                  | done     |
| F-02 | entries-schema          | (foundation) entries table + RLS + FK to cars live                                | F-01             | FR-003, FR-005, FR-006, FR-007, FR-008          | done     |
| F-03 | ai-integration-scaffold | (foundation) OpenRouter client + SSE streaming verified on Cloudflare Workers      | —                | FR-010, FR-011, NFR: visible AI response feedback | done   |
| S-01 | car-management          | add, view, and remove their cars; multiple cars supported                          | F-01             | FR-001, FR-002, FR-009                          | done     |
| S-02 | ai-car-chat             | ask the AI about their car; AI responds with model knowledge and visible streaming | F-01, F-03, S-01 | US-01, FR-010, FR-011                           | proposed |
| S-03 | repair-entry-logging    | log a repair entry (date, description, cause/context)                              | F-02, S-01       | FR-003                                          | proposed |
| S-04 | additional-entry-types  | log oil change, inspection, and insurance entries                                  | F-02, S-01       | FR-005, FR-006, FR-007                          | proposed |
| S-05 | entry-management        | view, edit, and delete any entry, with a delete confirmation step                  | F-02, S-03, S-04 | FR-008                                          | proposed |
| S-06 | deadline-dashboard      | see a dashboard surfacing upcoming oil change, inspection, and insurance deadlines | S-04, S-05       | FR-012                                          | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme             | Chain                                       | Note                                                                                          |
| ------ | ----------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| A      | North star path   | `F-01` / `F-03` → `S-01` → `S-02`          | F-01 and F-03 are parallel heads; S-01 needs only F-01; S-02 needs both. Ship this stream first. |
| B      | Entry + dashboard | `F-02` → `S-03` / `S-04` → `S-05` → `S-06` | Joins Stream A at F-01 (F-02 depends on it) and S-01 (S-03/S-04 depend on it).               |

## Baseline

What's already in place in the codebase as of 2026-05-27 (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro v6 + React v19 + Tailwind CSS v4 + shadcn/ui; file-based routing via `src/pages/`
- **Backend / API:** present — Astro SSR on Cloudflare Workers; auth API routes at `src/pages/api/auth/`; middleware at `src/middleware.ts`
- **Data:** absent — no application-level schema or migrations; Supabase `auth.users` table only
- **Auth:** present — Supabase Auth (`@supabase/ssr`), cookie-based sessions, route protection at `src/middleware.ts:18`; FR-001 is satisfied by the existing baseline
- **Deploy / infra:** present — Cloudflare Workers (`wrangler.jsonc`) + GitHub Actions CI at `.github/workflows/ci.yml`; note: CI pipeline deploy target (Workers vs. deprecated Pages) requires auditing before first production deploy
- **Observability:** partial — `wrangler.jsonc` has `observability: { enabled: true }`; no application-level logging or error tracking

## Foundations

### F-01: Cars data schema

- **Outcome:** (foundation) cars table with make, model, year, and user_id FK + RLS policy (each user sees only their own cars) is live in the Supabase database.
- **Change ID:** cars-schema
- **PRD refs:** FR-002, FR-009, Access Control section
- **Unlocks:** S-01 (car management), S-02 (AI chat — north star), F-02 (FK dependency)
- **Prerequisites:** —
- **Parallel with:** F-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Schema decisions made here — e.g., free-text vs. structured make/model fields — propagate into the AI prompt in S-02. PRD Socrates already resolved: structured fields are required for model-specific AI knowledge. Keep it simple: free-text strings for make, model, and year in v1.
- **Status:** ready

### F-02: Entries data schema

- **Outcome:** (foundation) entries table with entry_type, date, description, and type-specific fields + FK to cars + RLS policy is live; supports all four PRD entry types (repair, oil change, inspection, insurance).
- **Change ID:** entries-schema
- **PRD refs:** FR-003, FR-005, FR-006, FR-007, FR-008
- **Unlocks:** S-03 (repair entry logging), S-04 (additional entry types), S-05 (entry management)
- **Prerequisites:** F-01
- **Parallel with:** F-03 (after F-01 completes, F-02 and any remaining F-03 work can proceed concurrently)
- **Blockers:** —
- **Unknowns:**
  - Entry schema shape — single entries table with entry_type enum + type-specific nullable columns vs. separate tables per entry type. Owner: user. Block: no (decide when planning F-02; a single table with type-specific columns is the simplest v1 default).
- **Risk:** Inspection and insurance date fields must be first-class date columns, not buried in a JSONB blob, because FR-012 dashboard queries them directly. Avoid a generic blob-first schema design.
- **Status:** done

### F-03: AI integration scaffold

- **Outcome:** (foundation) OpenRouter API client is wired to an Astro API route, SSE streaming response is verified working on the Cloudflare Workers runtime via `wrangler dev`, and a reusable loading-state component exists.
- **Change ID:** ai-integration-scaffold
- **PRD refs:** FR-010, FR-011, NFR: visible AI response feedback
- **Unlocks:** S-02 (AI chat — north star)
- **Prerequisites:** —
- **Parallel with:** F-01
- **Blockers:** —
- **Unknowns:**
  - OpenRouter SDK ESM compatibility — `infrastructure.md` documents a CJS/ESM runtime trap on Cloudflare Workers; verify any OpenRouter or AI SDK dependency is ESM-compatible before wiring. Owner: user. Block: no (verifiable locally before S-02 begins).
- **Risk:** SSE streaming on Cloudflare Workers must use native `ReadableStream`; any library relying on the Node.js `stream` module will fail at runtime on the deployed Worker. Verification via `wrangler dev` is the definition of "done" for this foundation — do not mark ready until streaming is confirmed in the Workers runtime.
- **Status:** done

## Slices

### S-01: Car management

- **Outcome:** user can add, view, and remove their cars (make, model, year); multiple cars are supported with a visible way to switch between them.
- **Change ID:** car-management
- **PRD refs:** FR-001, FR-002, FR-009
- **Prerequisites:** F-01
- **Parallel with:** F-03 (no mutual dependency; F-03 can complete while S-01 is being built after F-01)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** "Selected car" session state — which car is active for AI chat and entry logging — must be established in this slice. Every downstream slice (S-02 through S-06) consumes it. Getting this wrong requires retrofitting multiple slices.
- **Status:** done

### S-02: AI assistant chat

- **Outcome:** user can ask the AI an open-ended question about their selected car; the AI responds using general knowledge about the car's make, model, and year; the response streams with visible progress from submission to completion.
- **Change ID:** ai-car-chat
- **PRD refs:** US-01, FR-010, FR-011
- **Prerequisites:** F-01, F-03, S-01
- **Parallel with:** F-02 (F-02 depends on F-01 only; can proceed while S-02 is being developed)
- **Blockers:** —
- **Unknowns:**
  - Entry context integration — the AI prompt sends car make/model/year only at this milestone; once S-03/S-04 populate the entries table, the prompt should be updated to include logged entries so FR-011's history path is exercised. Intentionally deferred to keep this slice lean. Owner: user. Block: no.
  - CI pipeline target — `.github/workflows/ci.yml` may deploy to the deprecated Cloudflare Pages target instead of Workers (per `infrastructure.md` risk register, likelihood: high); must be fixed before first production deploy. Owner: user. Block: no (develop and verify locally; fix before shipping S-02 to production).
- **Risk:** This is the north star — any delay here delays the product proof. SSE correctness must be confirmed in F-03 before this slice begins; do not absorb F-03's runtime risk into S-02 scope.
- **Status:** proposed

### S-03: Repair entry logging

- **Outcome:** user can log a repair entry for their selected car, including the date, a description of the repair, and the cause/context (what led to the repair).
- **Change ID:** repair-entry-logging
- **PRD refs:** FR-003
- **Prerequisites:** F-02, S-01
- **Parallel with:** S-04 (both depend on F-02 and S-01; neither depends on the other)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The cause/context field is PRD-mandated (FR-003 Socrates resolution) — must not be optional in the UI. After this slice ships, update the AI prompt in S-02 to include logged entries (see entry context integration Unknown in S-02).
- **Status:** proposed

### S-04: Additional entry types

- **Outcome:** user can log oil change entries (with optional filter/parts details), technical inspection entries (date, result, next due date), and insurance entries (policy period, renewal date) for their selected car.
- **Change ID:** additional-entry-types
- **PRD refs:** FR-005, FR-006, FR-007
- **Prerequisites:** F-02, S-01
- **Parallel with:** S-03
- **Blockers:** —
- **Unknowns:**
  - Date field priority — next due date (inspection) and renewal date (insurance) must be first-class date columns for FR-012 dashboard queries; confirm this is reflected in F-02's schema before starting this slice. Owner: user. Block: no.
- **Risk:** Three entry types in one slice is the most scope-heavy slice on the roadmap. If timeline pressure mounts, insurance entries (FR-007) are the lowest safety stakes — oil change interval and inspection expiry are the dates with regulatory consequences in the PRD's context (Poland: expired inspection prohibits road use).
- **Status:** proposed

### S-05: Entry management

- **Outcome:** user can view the full list of entries for their selected car, edit any entry, and delete any entry with a delete confirmation step.
- **Change ID:** entry-management
- **PRD refs:** FR-008
- **Prerequisites:** F-02, S-03, S-04
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Delete confirmation is PRD-mandated (FR-008 Socrates resolution) — hard delete without a confirmation dialog is a regression, not a simplification.
- **Status:** proposed

### S-06: Deadline dashboard

- **Outcome:** user sees a dashboard that prominently surfaces upcoming oil change, inspection, and insurance deadlines for each of their registered cars.
- **Change ID:** deadline-dashboard
- **PRD refs:** FR-012
- **Prerequisites:** S-04, S-05
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Dashboard scope — FR-012 Socrates round was not run (PRD Open Question 3). Is a deadline-only list sufficient for v1, or is a richer vehicle overview expected? Owner: user. Block: no (a deadline list satisfies FR-012 as written; scope can be expanded without replanning).
- **Risk:** Sequenced last because all entry types (S-04) must exist before the dashboard has meaningful data to surface. This order is correct despite FR-012 being a must-have.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID               | Suggested issue title                                       | Ready for `/10x-plan` | Notes                                                          |
| ---------- | ----------------------- | ----------------------------------------------------------- | --------------------- | -------------------------------------------------------------- |
| F-01       | cars-schema             | [F-01] Cars data schema — Supabase migration + RLS          | yes                   | Run `/10x-plan cars-schema`                                    |
| F-02       | entries-schema          | [F-02] Entries data schema — Supabase migration + RLS       | no                    | Depends on F-01; settle entry schema shape before planning     |
| F-03       | ai-integration-scaffold | [F-03] AI integration scaffold — OpenRouter + SSE streaming | yes                   | Run `/10x-plan ai-integration-scaffold`                        |
| S-01       | car-management          | [S-01] Car management — add, view, remove, switch           | done                  | Shipped 2026-05-27                                             |
| S-02       | ai-car-chat             | [S-02] AI car chat (north star) — stream AI response        | yes                   | Depends on F-01, F-03, S-01 — all done                        |
| S-03       | repair-entry-logging    | [S-03] Repair entry — date, description, cause/context      | no                    | Depends on F-02, S-01                                          |
| S-04       | additional-entry-types  | [S-04] Oil change + inspection + insurance entries          | no                    | Depends on F-02, S-01                                          |
| S-05       | entry-management        | [S-05] Entry management — view, edit, delete                | no                    | Depends on F-02, S-03, S-04                                    |
| S-06       | deadline-dashboard      | [S-06] Deadline dashboard — oil / inspection / insurance    | no                    | Depends on S-04, S-05                                          |

## Open Roadmap Questions

1. **target_scale.qps** — Queries-per-second estimate not captured during shaping. At small scale (handful of users) expected to be negligible; confirm before any rate-limit or capacity decision. Owner: user. Block: no slice.
2. **target_scale.data_volume** — Data volume not captured. At small scale expected to be small; confirm before storage tier decisions. Owner: user. Block: no slice.
3. **FR-012 dashboard scope** — Socrates round not run on FR-012 (PRD Open Question 3). Is a deadline-only list sufficient for v1, or is a richer vehicle overview expected? Owner: user. Block: S-06 scope (doesn't block building a deadline list, but shapes what's in it).
4. **Entry schema shape** — Single entries table with entry_type enum vs. separate tables per entry type. Resolve when invoking `/10x-plan entries-schema` — not a roadmap-level blocker, but deciding early avoids mid-build schema rework. Owner: user. Block: F-02 planning.

## Parked

- **Car sharing between users** — Why parked: PRD §Non-Goals — one car belongs to one user; sharing risks data isolation bugs before multi-user access patterns are understood.
- **External history integrations (CarVertical, CEPIK)** — Why parked: PRD §Non-Goals — user-curated history only; external API quality and integration costs are out of scope for v1.
- **Vehicle fleet management** — Why parked: PRD §Non-Goals — persona owns 1–2 personal cars; fleet grouping adds complexity with no v1 payoff.
- **Native mobile app / app store distribution** — Why parked: PRD §Non-Goals — web-only for v1; PWA-ready architecture is in scope but no app store submission.

## Done

| ID   | Change ID   | Outcome                                        | Shipped     | Commits             |
| ---- | ----------- | ---------------------------------------------- | ----------- | ------------------- |
| F-01 | cars-schema             | cars table + RLS + TypeScript types live                                                   | 2026-05-27 | b7df5ef, 6bca689                              |
| F-02 | entries-schema          | 4 entry tables + RLS + FK to cars + TypeScript types live                                  | 2026-05-28 | 50d1e4c, e013642, 72c4c1e, 12d349f           |
| F-03 | ai-integration-scaffold | OpenRouter + SSE streaming verified on Workers; useStreamingText hook + StreamingText ready | 2026-06-01 | 4187e6c, ad1ebb2, e36de8b, 26a944d, 417949b  |
| S-01 | car-management          | add, view, edit, delete, select cars; dashboard shows selected car                         | 2026-05-27 | 224789c, b66a9bc, afd2b4f, 14affa2            |
