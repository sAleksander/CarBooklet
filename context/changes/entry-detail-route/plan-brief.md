# Entry Detail Route — Plan Brief

> Full plan: `context/changes/entry-detail-route/plan.md`

## What & Why

Add a read-only full-screen entry detail page at `/entries/[id]`, opened by clicking any entry card in the `/entries` list. Today entries only appear as flat list cards where multi-line text is squashed to one line and there is no way to read a single entry in full. This is roadmap slice **S-03** (PRD US-02 / FR-005).

## Starting Point

The `/entries` list renders 4 entry types from 4 separate tables via uniform React list components with no navigation. Entries have no detail view. The route `/entries/[id]` is already auth-guarded by middleware (`startsWith("/entries")`), and `entries.astro` already establishes the SSR page pattern to mirror. No DB, API, or middleware change is needed.

## Desired End State

Clicking anywhere on an entry card opens a branded `/entries/[id]` page showing every field for that entry type, with multi-line text fully readable (line breaks preserved). Edit/Delete on the card still work without navigating. An unknown, foreign, or wrong-car id shows a styled in-app 404 panel with a back link.

## Key Decisions Made

| Decision                        | Choice                                              | Why (1 sentence)                                                              | Source |
| ------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- | ------ |
| Type resolution from `[id]`     | Query all 4 tables in parallel by id+user_id        | Keeps the URL exactly `/entries/[id]` per spec; type derived from data, trivial at this scale | Plan   |
| Click target on the card        | Whole card is a link; Edit/Delete stop propagation  | Biggest hit target, matches US-02 "click any entry card"                      | Plan   |
| Not-found / foreign-id UX        | Styled in-app 404 panel with back link (HTTP 404)   | Clear feedback that stays inside the app shell                               | Plan   |
| Empty/null field display         | Show all fields, em-dash placeholder for blanks     | Predictable, consistent layout signaling the field exists but is blank        | Plan   |
| Ownership scope                  | Scope to the currently selected car                 | Keeps the detail view consistent with the active car context                  | Plan   |
| "Rich text" rendering            | Plain text with `whitespace-pre-wrap`               | Fields are plain TEXT, not markdown/HTML — no sanitization needed             | Research (codebase) |

## Scope

**In scope:**
- `getEntryById` service resolving across all 4 entry tables
- `/entries/[id]` SSR page with car-scope guard + 404 panel
- `EntryDetail.astro` non-interactive render component (all field types)
- Making all 4 list-card components link to the detail page

**Out of scope:**
- DB / API / middleware changes
- Edit or delete on the detail page (display only)
- Markdown/HTML rendering or a rich-text editor
- Any change to tabs, forms, or list rendering beyond clickability

## Architecture / Approach

Bottom-up: a single service (`getEntryById`) resolves the type by querying all 4 tables in parallel and injecting `entry_type` at the boundary (the DB has no `entry_type` column). The `/entries/[id]` Astro page reuses the `entries.astro` SSR guard flow, adds a `car_id === selectedCarId` check, and delegates rendering to a non-interactive `EntryDetail.astro` that switches on `entry_type`. The 4 React list components are wrapped in links with Edit/Delete buttons calling `stopPropagation`/`preventDefault`.

## Phases at a Glance

| Phase                          | What it delivers                                   | Key risk                                            |
| ------------------------------ | -------------------------------------------------- | --------------------------------------------------- |
| 1. Get-by-id service           | `getEntryById` resolving across 4 tables           | Forgetting to inject `entry_type` at the boundary   |
| 2. Detail page + component     | `/entries/[id]` + `EntryDetail.astro` + 404 panel  | Car-scope/404 control flow; per-type field coverage |
| 3. Clickable list cards        | All 4 cards link to detail, Edit/Delete preserved  | Edit/Delete must not trigger navigation             |

**Prerequisites:** S-02 (sidebar/AppLayout) shipped — done.
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- Car-scoping means an entry deep-link resolves only when its car is the selected one; switching cars makes the link 404 (accepted per the car-scope decision).
- Assumes the 4 list components remain structurally uniform (verified at plan time).

## Success Criteria (Summary)

- User clicks any entry card and reads all its fields in full, with line breaks preserved.
- Edit/Delete still work from the list without navigating.
- Invalid/foreign/wrong-car ids show a friendly 404 panel; logged-out access redirects to sign-in.
