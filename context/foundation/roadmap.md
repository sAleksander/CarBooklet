---
project: "CarBooklet — UI Glowup"
version: 1
status: draft
created: "2026-06-08"
updated: "2026-06-13"
prd_version_note: "S-05/S-06 added post-PRD-v2 from user direction; not yet reflected in prd-v2.md"
prd_version: 2
main_goal: quality
top_blocker: motivation
---

# Roadmap: CarBooklet — UI Glowup

> Derived from `context/foundation/prd-v2.md` (v2) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

CarBooklet has all its features but feels like an unfinished starter template — the root URL shows boilerplate, the navbar has no active state, and users must memorize URLs to get around. This change is a UX/navigation overhaul: introduce a responsive sidebar, a real landing page, a full-screen entry detail view, and a last-entry widget on the dashboard. No new data, no backend changes — the entire delta is in the UI layer.

## North star

**S-02: user can navigate the app via a sidebar that always shows where they are** — the smallest delivery that proves the primary success criterion ("user can navigate to any feature from any other feature without guessing URLs"). Once the sidebar is live with active-state indicators on every protected page, the core navigation hypothesis is validated; every other slice builds into an already-coherent shell.

> "North star" here means: the smallest end-to-end slice whose successful delivery proves the change's primary hypothesis — placed as early as its prerequisites allow because everything else only matters if this works.

## At a glance

| ID   | Change ID             | Outcome (user can …)                                                                                | Prerequisites | PRD refs                               | Status   |
| ---- | --------------------- | --------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------- | -------- |
| S-01 | root-routing-landing  | arrive at `/` and see a real landing page with sign-in/sign-up links; if logged in, auto-redirect  | —             | US-01, FR-001                          | done     |
| S-02 | sidebar-navigation    | navigate all protected pages via a responsive sidebar with active-state indicator + mobile collapse | —             | FR-002, FR-003, FR-004, FR-007, FR-008 | done     |
| S-03 | entry-detail-route    | click any entry card to open a full-screen detail page with all fields and rich-text fully rendered | S-02          | US-02, FR-005                          | done     |
| S-04 | dashboard-last-entry  | see the most recent entry (any type) displayed on `/dashboard` below the deadline tiles             | S-02          | FR-006                                 | done     |
| S-05 | entry-detail-actions  | edit or delete an entry from its detail page — actions removed from the `/entries` list view        | S-03          | (post-v2)                              | done     |
| S-06 | i18n-en-pl            | switch the entire app between English and Polish; their choice persists across sessions             | S-02          | (post-v2)                              | done     |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme               | Chain                       | Note                                                                              |
| ------ | ------------------- | --------------------------- | --------------------------------------------------------------------------------- |
| A      | Quick win           | `S-01`                      | Standalone; no prerequisites. Ship in parallel with S-02 for an early visible win. |
| B      | Navigation overhaul | `S-02` → `S-03` / `S-04`   | North star. S-03 and S-04 can run in parallel once S-02 ships.                   |
| C      | Entry CRUD reshuffle | `S-03` → `S-05`            | S-05 relocates edit/delete onto the detail page S-03 introduced.                  |
| D      | Localization        | `S-06`                      | Cross-cutting. Soft-depends on S-02 so all nav/shell copy exists before extraction. Best sequenced last so it covers every string once. |

## Baseline

What's already in place in the codebase as of 2026-06-08 (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6.3.1 + React v19 + Tailwind CSS v4 + shadcn/ui; file-based routing `src/pages/`; components in `src/components/ui/`
- **Backend / API:** present — Astro SSR on Cloudflare Workers; API routes at `src/pages/api/`; middleware at `src/middleware.ts`
- **Data:** present — Supabase client; 5 migrations covering cars + 4 entry types (repair, oil change, inspection, insurance) with RLS; no seeds
- **Auth:** present — Supabase Auth via `@supabase/ssr`, cookie-based sessions, route protection in `src/middleware.ts:4,22-26`; current protected routes: `/dashboard`, `/cars`, `/ai-chat`, `/entries`
- **Deploy / infra:** present — Cloudflare Workers (`wrangler.jsonc`) + GitHub Actions CI with auto-deploy on main push
- **Observability:** absent — Cloudflare native observability enabled in `wrangler.jsonc`; no app-level logging or error tracking

## Foundations

No foundations required. All prerequisite infrastructure (auth, data, deploy, routing) is confirmed present in the baseline. Every slice in this change is self-contained UI work that builds directly on the existing codebase.

## Slices

### S-01: Root routing + minimal landing page

- **Outcome:** user arrives at `/` and sees a minimal branded landing page with sign-in and sign-up calls to action; if already authenticated, they are immediately redirected to `/dashboard` — no boilerplate screen is shown.
- **Change ID:** root-routing-landing
- **PRD refs:** US-01, FR-001
- **Prerequisites:** —
- **Parallel with:** S-02
- **Blockers:** —
- **Unknowns:**
  - Auth-state routing at `/` — `src/middleware.ts` currently protects named routes but `/` is not in `PROTECTED_ROUTES`; the redirect for authenticated users must be handled either in middleware or in the page itself. Resolve when planning. Owner: codebase. Block: no.
- **Risk:** Minimal scope — the smallest slice in the roadmap. Main risk is touching `src/middleware.ts` in a way that accidentally alters redirect behavior for existing protected routes. Keep the change surgical: scope to `/` only.
- **Status:** done

### S-02: Sidebar navigation shell ⭐ north star

- **Outcome:** user can navigate between all major sections (Dashboard, Entries, AI Chat) on any protected page via a responsive sidebar; the sidebar shows an active-state indicator for the current section at all times; on small screens the sidebar collapses to a mobile-friendly navigation pattern (specific pattern decided during planning).
- **Change ID:** sidebar-navigation
- **PRD refs:** FR-002, FR-003, FR-004, FR-007, FR-008
- **Prerequisites:** —
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:**
  - Existing topbar implementation — how the current navbar is wired (`src/layouts/` vs. inline per page) determines whether S-02 is a layout replacement or a per-page modification. Owner: codebase (resolve when planning). Block: no.
  - Mobile nav pattern — FR-004 explicitly defers the specific pattern (hamburger vs. bottom nav) to the implementation decision at planning time. Owner: implementation decision. Block: no.
- **Risk:** This slice touches every protected page (dashboard, entries, cars, AI chat). The regression surface is the entire protected app — FR-007 (car CRUD) and FR-008 (AI chat backend) must be smoke-tested after this slice ships. Sequenced before S-03 and S-04 so both land into an already-working sidebar rather than being retrofitted.
- **Status:** done

### S-03: Entry detail route

- **Outcome:** user can click any entry card in the `/entries` list to open a full-screen detail page at `/entries/[id]`; the page displays all fields of that entry with rich-text content fully rendered and readable; the route is auth-guarded.
- **Change ID:** entry-detail-route
- **PRD refs:** US-02, FR-005
- **Prerequisites:** S-02
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:**
  - Rich-text storage format — the PRD notes rich text is "squashed to one line" in the list view; the actual format stored in the database (plain text, HTML, Markdown, structured JSON) determines the rendering approach on the detail page. Owner: codebase (check schema + entry creation code when planning). Block: no.
  - Route guard for `/entries/[id]` — this new route must be added to the protected routes set in `src/middleware.ts`; confirm the mechanism before planning. Owner: codebase. Block: no.
- **Risk:** First dynamic route (`[id]`) in the app's page structure. The routing plumbing (Astro dynamic segment + auth guard + 404 handling for unknown or unauthorized IDs) is slightly more complex than static pages. Keep the detail page display-only — no edit functionality in this slice.
- **Status:** done

### S-04: Dashboard last entry widget

- **Outcome:** user sees the most recent entry of any type displayed on `/dashboard` below the existing oil change / inspection / insurance deadline tiles.
- **Change ID:** dashboard-last-entry
- **PRD refs:** FR-006
- **Prerequisites:** S-02
- **Parallel with:** S-03
- **Blockers:** —
- **Unknowns:**
  - Entry schema shape — the existing migrations may have created a single `entries` table with an `entry_type` column OR separate tables per entry type; the "most recent entry of any type" query differs significantly between the two. Owner: codebase (check `supabase/migrations/` when planning). Block: no.
- **Risk:** Sequenced after S-02 because S-02 changes the dashboard page's layout wrapper; working on both concurrently risks file conflicts. The widget itself is read-only — the main risk is the query pattern depending on schema shape (see Unknown above).
- **Status:** done

### S-05: Relocate edit/delete to entry detail page

- **Outcome:** user manages an entry's lifecycle from one place — the edit and delete actions live on the `/entries/[id]` detail page (S-03), and are removed from the `/entries` list view; deleting returns the user to the list, editing reuses the existing entry form, and the list view becomes purely navigational (click to open detail).
- **Change ID:** entry-detail-actions
- **PRD refs:** (post-v2 — user-directed addition; fold into prd-v2.md on next PRD pass)
- **Prerequisites:** S-03 (the detail page must exist before edit/delete can move onto it)
- **Parallel with:** S-06
- **Blockers:** —
- **Unknowns:**
  - Current edit/delete wiring — whether the list view triggers edit/delete via inline buttons, a row menu, or a modal, and which handlers/API routes they call, determines how much moves vs. is re-pointed. Owner: codebase (inspect `src/pages/entries.astro` + entry components when planning). Block: no.
  - Post-delete navigation + confirmation — where the user lands after delete and whether a confirm step is required. Owner: implementation decision at planning. Block: no.
- **Risk:** Touches the live edit/delete mutation path, so the regression surface is real data loss/corruption, not just layout — the destructive action must be re-tested end-to-end after the move. Keep the underlying form and API routes unchanged; this slice only relocates the entry points, per the "no backend changes" guardrail. Note the existing Parked item "Redesigning add/edit entry forms" stays parked — this is relocation, not redesign.
- **Status:** done

### S-06: Localization — English + Polish

- **Outcome:** user can switch the entire app between English and Polish from a visible control (placement decided at planning); every user-facing string — sidebar, landing, dashboard, entries, detail, forms, auth — renders in the chosen language, and the choice persists across sessions.
- **Change ID:** i18n-en-pl
- **PRD refs:** (post-v2 — user-directed addition; fold into prd-v2.md on next PRD pass)
- **Prerequisites:** S-02 (soft — all shell/nav copy should exist before strings are extracted, so the localization pass covers the final UI once rather than chasing later changes)
- **Parallel with:** S-05
- **Blockers:** —
- **Unknowns:**
  - i18n approach — no localization library exists today; whether to adopt one (e.g. `astro:i18n` routing, `i18next`, or a lightweight custom dictionary) and whether language is URL-prefixed (`/pl/...`), cookie-based, or both. This is the central architectural decision and likely warrants `/10x-shape` or an infra-research pass before `/10x-plan`. Owner: implementation decision. Block: **yes — resolve before planning.**
  - Persistence + default — where the choice is stored (cookie vs. user profile) and how the initial language is picked (browser `Accept-Language` vs. fixed default). Owner: implementation decision. Block: no.
  - Localized dynamic data — whether entry-type labels, dates, and validation/error messages (including server-side zod errors and Supabase auth errors) also need translation, or only static chrome. Owner: codebase + decision. Block: no.
- **Risk:** First cross-cutting concern in this roadmap — it touches every page and component rather than a single vertical, so it is not a tidy slice. Highest-effort and highest-surface item here; the string-extraction sweep is the bulk of the work and easy to under-scope. Sequenced last so it localizes the finished UI once. This also breaches the original "entire delta is in the UI layer / no backend changes" framing if language ends up persisted server-side or routes become locale-prefixed — flag that to revisit the Vision recap when this slice is planned.
- **Status:** done

## Backlog Handoff

| Roadmap ID | Change ID            | Suggested issue title                                           | Ready for `/10x-plan` | Notes                                                    |
| ---------- | -------------------- | --------------------------------------------------------------- | --------------------- | -------------------------------------------------------- |
| S-01       | root-routing-landing | [S-01] Root routing + landing page — auth-state redirect + page | yes                   | Run `/10x-plan root-routing-landing`                     |
| S-02       | sidebar-navigation   | [S-02] Sidebar navigation — responsive shell + active state     | yes                   | Run `/10x-plan sidebar-navigation` ⭐ north star          |
| S-03       | entry-detail-route   | [S-03] Entry detail route — `/entries/[id]` + rich-text render  | yes                   | S-02 shipped; run `/10x-plan entry-detail-route`         |
| S-04       | dashboard-last-entry | [S-04] Dashboard last entry widget — most recent entry display  | yes                   | S-02 shipped; run `/10x-plan dashboard-last-entry`       |
| S-05       | entry-detail-actions | [S-05] Move edit/delete from entries list to detail page        | yes                   | S-03 shipped; run `/10x-plan entry-detail-actions`       |
| S-06       | i18n-en-pl           | [S-06] Localization — English + Polish with persistent toggle   | —                     | Shipped 2026-06-13                                                              |

## Open Roadmap Questions

_(none — all planned slices are done)_

## Parked

- **No changes to API routes or backend logic** — Why parked: PRD §Non-Goals — all existing API routes are untouched; any backend touch risks regressions in data flows this UI change has no reason to modify.
- **AI Chat UX improvements** (loading state, conversation history, persistence across reloads) — Why parked: PRD §Non-Goals — AI chat page will be reachable via sidebar but its internal UX is a separate future change.
- **Inspections/Insurance dedicated tab** — Why parked: PRD §Non-Goals — entry types stay grouped in the current tab structure for now; dedicated section deferred.
- **Redesigning add/edit entry forms** — Why parked: PRD §Non-Goals — form UX and field structure are unchanged; only the list view and new detail view are in scope.

## Done

- **S-01 · root-routing-landing** — Root routing + minimal landing page. Shipped 2026-06-08. Impl reviewed: APPROVED.
- **S-02 · sidebar-navigation** — Responsive sidebar shell with active-state indicators + mobile collapse. Shipped 2026-06-09. Impl reviewed: APPROVED.
- **S-03 · entry-detail-route** — Full-screen entry detail page at `/entries/[id]` with rich-text rendering + auth guard. Shipped 2026-06-10. Impl reviewed: APPROVED.
- **S-04 · dashboard-last-entry** — Last entry widget on `/dashboard` below deadline tiles. Shipped 2026-06-10. Impl reviewed: APPROVED.
- **S-05 · entry-detail-actions** — Edit/delete relocated from entries list to detail page; list view is now purely navigational. Shipped 2026-06-12. Impl reviewed: APPROVED.
- **S-06 · i18n-en-pl** — Full English/Polish localization with cookie-based persistence and sidebar language toggle. Covers every surface (sidebar, dashboard, entries, cars, AI chat, landing, auth). Shipped 2026-06-13.
