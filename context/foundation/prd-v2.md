---
project: "CarBooklet — UI Glowup"
version: 2
status: draft
created: "2026-06-08"
context_type: brownfield
product_type: web-app
target_scale:
  users: small
timeline_budget:
  delivery_weeks: 2
  hard_deadline: null
  after_hours_only: true
---

## Current System Overview

**System purpose**: CarBooklet is a web app for logging car maintenance history — repairs, oil changes, technical inspections, and insurance — with an AI chat assistant that reasons over the user's logged repair history and car model knowledge.

**Architecture**: Full server-side rendering, edge-deployed.

**Tech stack**: Astro v6 + React v19, TypeScript, Tailwind CSS v4, Supabase (auth + database), Cloudflare Workers (edge deployment). shadcn/ui component library.

**Current user base**: Individual car owners (1–2 cars) who self-diagnose and track maintenance. Single authenticated user role — flat user model, no admin/guest separation.

**Core functionality**: Car management (add/edit/delete car), all entry types (repair, oil change, inspection, insurance), AI chat assistant, authentication and route protection.

## Problem Statement & Motivation

The app has all its planned features but feels like a hastily assembled starter template where nothing makes sense. Navigation is disjointed — users must guess URLs to reach features, there is no active-state indicator on the navbar, and the app opens to the 10x Astro starter boilerplate instead of the user's dashboard.

Specific UX failures observed during manual testing:

- Root URL (`/`) shows the starter boilerplate regardless of auth state — should redirect to `/dashboard` or `/auth/signin`
- Navbar links are small and barely visible; no active-state indicator showing where the user currently is
- Dashboard is visually bare — lots of empty space, last entry not shown under summary tiles
- Entry list (`/entries`) shows all entries as a flat "History" list; rich-text formatting is squashed to one line; no way to open an entry in full-screen detail view
- Inspections and Insurance are grouped under the same tab as Repairs/Oil Changes despite being used ~once a year — they deserve a dedicated section
- AI Chat has no loading feedback (button stays "sending…" as if broken), no conversation history, entries reset on page reload, and doesn't visibly show it's using repair history

**Why now**: The app was built feature-first. The navigation and visual shell were never addressed as a cohesive layer. Without this change, new users cannot orient themselves and existing users must rely on memorized URLs.

## User & Persona

**Primary persona**: An individual car owner who already uses CarBooklet to log entries. They know the features exist but find the interface confusing — they want to be able to navigate to any feature without guessing.

**Pain category**: Navigation friction + visual boilerplate. The core need is orientation — the user should be able to arrive at any feature from any other feature without knowing the URL structure.

## Success Criteria

### Primary

User can navigate to any feature from any other feature without guessing URLs, and can open individual entries to read them in full.

MVP core flow (proof it works):
1. User arrives at `/` → redirected to `/dashboard` (logged in) or `/auth/signin` (not logged in) — no starter boilerplate
2. User navigates between sections via navbar; active section is visually indicated at all times
3. User opens `/entries` → clicks any entry → full-screen detail view renders with rich text fully readable
4. User opens `/dashboard` → sees last entry displayed below the oil change / inspection / insurance summary tiles

### Secondary

- Inspections and Insurance get a dedicated section/tab separate from Repairs/Oil Changes
- AI Chat shows a proper loading state (interface blocked, visible feedback) during response generation instead of stuck "sending…" button

### Guardrails

- No regressions in car management (add/edit/delete car)
- No regressions in entry management (add/edit/delete for all entry types)
- AI chat backend functionality preserved (UX wrapper may change in v1.1 but the call must still work)
- No database schema changes — this is a frontend/UI-only change

## User Stories

### US-01: User navigates to the app and lands in the right place

**Given** a user visits the root URL (`/`),
**When** the page loads,
**Then** they are immediately redirected to `/dashboard` (if authenticated) or `/auth/signin` (if not) — no boilerplate screen is shown.

### US-02: User finds a specific entry and reads it in full

**Given** the user is on `/entries`,
**When** the user clicks an entry card,
**Then** they are taken to `/entries/[id]` showing all fields of that entry with rich-text content fully rendered and readable.

## Scope of Change

### New

- [new] **FR-001**: Minimal public landing page at `/` with clear sign-in and sign-up calls to action; if already authenticated, the user is immediately redirected to `/dashboard`. Priority: must-have. (was: 10x Astro starter boilerplate at `/` with no auth-state routing)
  > Socrates: Counter-argument considered: "Design a real landing page instead of just redirecting." Resolution: accepted as a scope change — a minimal landing page is now in scope as must-have. The redirect-only approach would have erased the possibility of a public landing entirely. Minimal scope: links to sign-in/sign-up + brief value prop sentence.

- [new] **FR-002**: Responsive sidebar navigation on all protected pages, with visible links to all major sections (Dashboard, Entries, AI Chat). Priority: must-have.
  > Socrates: Counter-argument considered: "Sidebar is overkill for 3–4 sections; an improved top navbar is simpler." Resolution: rejected — sidebar chosen as the target pattern. Counter-argument stands as a valid alternative but user confirmed sidebar. The mobile-collapse requirement (FR-004) must be explicitly delivered alongside this FR.

- [new] **FR-003**: Sidebar navigation displays an active-state indicator for the current section so the user always knows where they are. Priority: must-have.
  > Socrates: (Batched with FR-002 above.)

- [new] **FR-004**: Sidebar navigation collapses to a mobile-friendly pattern on small screens (specific pattern is an implementation decision). Priority: must-have.
  > Socrates: Counter-argument considered: "Mobile nav pattern should be decided before building, not left open." Resolution: noted — the specific pattern is an implementation decision deferred to the plan stage. The requirement is mobile-accessible sidebar; the implementation chooses the pattern.

- [new] **FR-005**: User can click any entry in the `/entries` list to open a full-screen detail view at `/entries/[id]`, displaying all entry fields with full rich-text rendering. The route is auth-guarded. Priority: must-have.
  > Socrates: Counter-argument considered: "A modal is faster to ship." Resolution: user confirmed new page/route. Auth-guarding note added to the FR — `/entries/[id]` must be added to `PROTECTED_ROUTES` in middleware.

### Modified

- [modified] **FR-006**: The most recent entry (of any type) is displayed on `/dashboard`, below the existing summary tiles for oil change, inspection, and insurance deadlines. Priority: must-have. (was: dashboard did not show the most recent entry; the space below summary tiles was empty)
  > Socrates: Counter-argument considered: "Should it be the last repair specifically, not the last entry of any type?" Resolution: FR stands as written — last entry of any type. "Last entry" is the user's most recent action regardless of type; filtering by type would require a design decision the user hasn't made.

### Preserved

- [preserved] **FR-007**: User can add, edit, and delete cars and all entry types (repair, oil change, inspection, insurance) without any change to existing flows. Priority: must-have.
  > Socrates: Counter-argument considered: "Preserved FRs are redundant — preservation is implied, not worth making explicit." Resolution: kept as guardrail-only entries (not implementation tasks). These FRs exist to make the regression surface explicit, not to drive new work. Implementation should treat them as a test checklist, not a build list.

- [preserved] **FR-008**: AI chat backend continues to function (API call, response display) after navigation structure changes. Priority: must-have.
  > Socrates: (Batched with FR-007 above.)

## Constraints & Compatibility

- **No database schema changes**: No database migrations — this is a frontend/UI-only change.
- **All existing API routes are untouched**: Car, entry, chat, and auth endpoints remain unchanged.
- **Route protection**: All currently protected routes remain protected; the new entry detail route (`/entries/[id]`) must also be auth-guarded.
- **No changes to car CRUD, entry CRUD, or AI chat backend logic.**
- **Backward compatibility**: All existing core data flows must be preserved — car management, all entry types, AI chat functionality, and authentication.

## Business Logic Changes

No domain logic change. This is a UI/navigation-only change.

The existing domain rule (AI-assisted reasoning over logged car history) is unchanged. The app's data model, API routes, and AI call logic are all out of scope for this change.

## Access Control Changes

No access control changes — current model preserved.

Current model: email and password authentication. Single flat user role — all authenticated users have full control over their own cars and entries. No admin, guest, or shared-access roles. Route protection rules remain in place for all existing protected pages. The new entry detail route (`/entries/[id]`) must be added to the protected routes set.

## Non-Goals

- **No changes to API routes or backend logic**: All existing API routes, queries, and AI call logic are untouched. This is a frontend-only change. Rationale: any backend touch is out of scope and risks introducing regressions in data flows the UI change has no reason to modify.
- **AI Chat UX improvements** (loading state, conversation history, persistence across reloads): The chat page will be reachable via sidebar navigation but its internal UX is a separate future change.
- **Inspections/Insurance dedicated tab**: Grouped with Repairs/Oil Changes in the current entry list for now. Dedicated section deferred.
- **Redesigning add/edit entry forms**: Form UX and field structure are unchanged. Only the entry list view and new detail view are in scope.

## Open Questions

No open questions — all shape-notes content was fully resolved during the `/10x-shape` session. All FRs include explicit priority and Socrates resolutions.
