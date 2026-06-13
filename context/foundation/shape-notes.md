---
project: "CarBooklet — UI Glowup"
context_type: brownfield
updated: "2026-06-06"
product_type: web-app
target_scale:
  users: small
timeline_budget:
  delivery_weeks: 2
  hard_deadline: null
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  frs_drafted: 8
  quality_check_status: accepted
---

## Current System

**What exists**: CarBooklet — a web app for logging car maintenance history (repairs, oil changes, technical inspections, insurance) with an AI chat assistant that reasons over the user's logged repair history and car model knowledge.

**Tech stack**: Astro v6 + React v19, TypeScript, Tailwind CSS v4, Supabase (auth + database), Cloudflare Workers (edge deployment). Full server-side rendering. shadcn/ui component library.

**Users today**: Individual car owners (1–2 cars) who self-diagnose and track maintenance. Single authenticated user role — flat user model, no admin/guest separation.

**Pain / gap**: The app has all its planned features but feels like a hastily assembled starter template where nothing makes sense. Navigation is disjointed — users must guess URLs to reach features, there is no active-state indicator on the navbar, and the app opens to the 10x Astro starter boilerplate instead of the user's dashboard. Specific UX failures observed during manual testing:
- Root URL (`/`) shows the starter boilerplate regardless of auth state — should redirect to `/dashboard` or `/auth/signin`
- Navbar links are small and barely visible; no active-state indicator showing where the user currently is
- Dashboard is visually bare — lots of empty space, last entry not shown under summary tiles
- Entry list (`/entries`) shows all entries as a flat "History" list; rich-text formatting is squashed to one line; no way to open an entry in full-screen detail view
- Inspections and Insurance are grouped under the same tab as Repairs/Oil Changes despite being used ~once a year — they deserve a dedicated section
- AI Chat has no loading feedback (button stays "sending…" as if broken), no conversation history, entries reset on page reload, and doesn't visibly show it's using repair history

**Must preserve**: All existing core data flows — car management (add/edit/delete car), all entry types (repair, oil change, inspection, insurance), AI chat functionality, authentication and route protection, Supabase schema (no DB migrations).

## Vision & Problem Statement

**What's changing**: A UX/navigation overhaul that gives the app a coherent information architecture. The change is structural, not functional — no new features, no changes to how data is stored or processed.

**The delta**:
1. Root URL routes correctly based on auth state (no more boilerplate screen)
2. Navbar is visible, informative, and shows the user where they are
3. Dashboard uses its space to surface useful context (last entry, upcoming deadlines)
4. Entry list supports full-screen drill-down so rich-text entries are readable
5. Inspections and Insurance get a dedicated section/tab separate from Repairs/Oil Changes
6. AI Chat has proper loading feedback and the interface communicates that it uses car history

**Why now**: The app was built feature-first. The navigation and visual shell were never addressed as a cohesive layer. Without this change, new users cannot orient themselves and existing users must rely on memorized URLs.

## User & Persona

**Primary persona**: An individual car owner who already uses CarBooklet to log entries. They know the features exist but find the interface confusing — they want to be able to navigate to any feature without guessing.

**Pain category**: Navigation friction + visual boilerplate. The core need is orientation — the user should be able to arrive at any feature from any other feature without knowing the URL structure.

## Access Control

No changes planned — current model preserved.

**Current model**: Email + password auth (OAuth-leaning per prior shape session). Single flat user role — all authenticated users have full control over their own cars and entries. No admin, guest, or shared-access roles. Route protection handled in `src/middleware.ts`.

**This change does not touch auth or route protection.**

## Success Criteria

### Primary
User can navigate to any feature from any other feature without guessing URLs, and can open individual entries to read them in full.

MVP core flow (proof it works):
1. User arrives at `/` → redirected to `/dashboard` (logged in) or `/auth/signin` (not logged in) — no starter boilerplate
2. User navigates between sections via navbar; active section is visually indicated at all times
3. User opens `/entries` → clicks any entry → full-screen detail view renders with rich text fully readable
4. User opens `/dashboard` → sees last entry displayed below the oil change / inspection / insurance summary tiles

### Secondary (nice-to-have, not blocking v1)
- Inspections and Insurance get a dedicated section/tab separate from Repairs/Oil Changes
- AI Chat shows a proper loading state (interface blocked, spinner visible) during response generation instead of stuck "sending…" button

### Guardrails
- No regressions in car management (add/edit/delete car)
- No regressions in entry management (add/edit/delete for all entry types)
- AI chat backend functionality preserved (UX wrapper may change in v1.1 but the call must still work)
- No Supabase schema changes — this is a frontend/UI-only change

### Timeline
`delivery_weeks: 2` — 1–2 weeks after-hours, within threshold. No acknowledgment block required.

## Functional Requirements

### Routing & Navigation
- FR-001: User sees a minimal public landing page at `/` with clear sign-in and sign-up calls to action; if already authenticated, they are immediately redirected to `/dashboard`. Priority: must-have. Change: modified (was showing 10x Astro starter boilerplate; now a real landing page with auth-state routing)
  > Socrates: Counter-argument considered: "Design a real landing page instead of just redirecting." Resolution: accepted as a scope change — a minimal landing page is now in scope as must-have. The redirect-only approach would have erased the possibility of a public landing entirely. Minimal scope: links to sign-in/sign-up + brief value prop sentence.
- FR-002: User sees a responsive sidebar navigation on all protected pages, with visible links to all major sections (Dashboard, Entries, AI Chat). Priority: must-have. Change: new
  > Socrates: Counter-argument considered: "Sidebar is overkill for 3–4 sections; an improved top navbar is simpler." Resolution: rejected — sidebar chosen as the target pattern. Counter-argument stands as a valid alternative but user confirmed sidebar. The mobile-collapse requirement (FR-004) must be explicitly delivered alongside this FR.
- FR-003: Sidebar navigation displays an active-state indicator for the current section so the user always knows where they are. Priority: must-have. Change: new
  > Socrates: (Batched with FR-002 above.)
- FR-004: Sidebar navigation collapses to a mobile-friendly pattern on small screens (hamburger or bottom nav — specific pattern is an implementation decision). Priority: must-have. Change: new
  > Socrates: Counter-argument considered: "Mobile nav pattern should be decided before building, not left open." Resolution: noted — the specific pattern (hamburger vs. bottom nav) is an implementation decision deferred to the plan stage. The requirement is mobile-accessible sidebar; the implementation chooses the pattern.

### Entry Detail
- FR-005: User can click any entry in the `/entries` list to open a full-screen detail view at `/entries/[id]`, displaying all entry fields with full rich-text rendering. The route is auth-guarded. Priority: must-have. Change: new
  > Socrates: Counter-argument considered: "A modal is faster to ship." Resolution: user confirmed new page/route. Auth-guarding note added to the FR — `/entries/[id]` must be added to `PROTECTED_ROUTES` in middleware.

### Dashboard
- FR-006: User sees the most recent entry displayed on `/dashboard`, below the existing summary tiles for oil change, inspection, and insurance deadlines. Priority: must-have. Change: modified
  > Socrates: Counter-argument considered: "Should it be the last repair specifically, not the last entry of any type?" Resolution: FR stands as written — last entry of any type. "Last entry" is the user's most recent action regardless of type; filtering by type would require a design decision the user hasn't made.

### Preserved Behavior
- FR-007: User can add, edit, and delete cars and all entry types (repair, oil change, inspection, insurance) without any change to existing flows. Priority: must-have. Change: preserved
  > Socrates: Counter-argument considered: "Preserved FRs are redundant — preservation is implied, not worth making explicit." Resolution: kept as guardrail-only entries (not implementation tasks). These FRs exist to make the regression surface explicit, not to drive new work. Implementation should treat them as a test checklist, not a build list.
- FR-008: AI chat backend continues to function (API call, response display) after navigation structure changes. Priority: must-have. Change: preserved
  > Socrates: (Batched with FR-007 above.)

## Business Logic

No domain logic change. This is a UI/navigation-only change.

**What exists**: The existing domain rule (AI-assisted reasoning over logged car history) is unchanged. The app's data model, Supabase schema, API routes, and AI call logic are all out of scope.

## Non-Functional Requirements

- **Mobile browser usability**: All new UI surfaces (sidebar, entry detail page, landing page) must be fully usable on a mobile browser without installation. A user on a phone must be able to navigate the app and read entry details with no degraded experience.

## Constraints & Preserved Behavior

- Supabase schema: no migrations — this is a frontend-only change.
- All existing API routes (`/api/cars/*`, `/api/entries/*`, `/api/chat/*`, `/api/auth/*`) are untouched.
- Route protection: all currently protected routes remain protected; new routes (`/entries/[id]`, `/`) must be correctly handled in `src/middleware.ts`.
- No changes to car CRUD, entry CRUD, or AI chat backend logic.

## User Stories

### US-01: User navigates to the app and lands in the right place
**Given** a user visits the root URL (`/`),
**When** the page loads,
**Then** they are immediately redirected to `/dashboard` (if authenticated) or `/auth/signin` (if not) — no boilerplate screen is shown.

### US-02: User finds a specific entry and reads it in full
**Given** the user is on `/entries`,
**When** the user clicks an entry card,
**Then** they are taken to `/entries/[id]` showing all fields of that entry with rich-text content fully rendered and readable.

## Non-Goals

- **No changes to API routes or backend logic**: All existing API routes, Supabase queries, and AI call logic are untouched. This is a frontend-only change. Rationale: any backend touch is out of scope and risks introducing regressions in data flows the UI change has no reason to modify.
- **AI Chat UX improvements** (loading state, conversation history, persistence across reloads): The chat page will be reachable via sidebar navigation but its internal UX is a separate future change.
- **Inspections/Insurance dedicated tab**: Grouped with Repairs/Oil Changes in the current entry list for now. Dedicated section deferred.
- **Redesigning add/edit entry forms**: Form UX and field structure are unchanged. Only the entry list view and new detail view are in scope.

## Quality cross-check

All 6 brownfield quality elements present. Status: `accepted`.

- Access Control: present — current model preserved, no changes
- Business Logic: present — infrastructure-only change (valid for brownfield)
- Project artifacts: present — shape-notes.md with valid checkpoint
- Timeline-cost acknowledgment: present — 2 weeks delivery, within threshold
- Non-Goals: present — 4 explicit entries
- Preserved behavior: present — Constraints & Preserved Behavior block names what must not break

