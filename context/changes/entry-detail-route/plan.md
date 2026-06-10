# Entry Detail Route Implementation Plan

## Overview

Add a read-only, full-screen entry detail page at `/entries/[id]`, reachable by clicking any entry card in the `/entries` list. The page displays **all fields** of a single entry with multi-line text rendered fully (line breaks preserved) instead of squashed to one line. This is roadmap slice **S-03** (PRD `US-02`, `FR-005`). No database, API, or middleware changes.

## Current State Analysis

- **Entries live in 4 separate tables** — `repair_entries`, `oil_change_entries`, `inspection_entries`, `insurance_entries` (`supabase/migrations/20260528000000_entries_schema.sql`). There is **no unified `entries` table and no `entry_type` column** in the DB; `entry_type` is injected at the service return site (`src/types.ts:69`, `src/lib/services/entries.ts`).
- **"Rich text" is plain `TEXT`** — `description`, `cause`, `oil_details`, `result`, `insurer` are plain `TEXT` columns edited via shadcn `<Textarea>` (`src/components/entries/RepairEntryForm.tsx:101`). No markdown/HTML/rich-text editor exists in the project (`package.json` has none). "Squashed to one line" is just newline collapse in the list — the fix is `whitespace-pre-wrap`. **No HTML rendering, no sanitization, no XSS surface.**
- **Auth guard already covers the route** — `src/middleware.ts:4,22` matches via `pathname.startsWith("/entries")`, so `/entries/[id]` is already protected. The `FR-005` note about adding to `PROTECTED_ROUTES` is already satisfied; no middleware change.
- **Canonical SSR page pattern exists** — `src/pages/entries.astro` shows the pattern to mirror: `createClient(...)`, `Astro.locals.user` + `Astro.locals.selectedCarId`, redirect to `/cars` when no car is selected, ownership check, wrap content in `AppLayout`.
- **No get-by-id service** — `entries.ts` has list/create/update/delete but no single-entry fetch. Update functions use the `res.error?.code === "PGRST116" → return null` pattern (`entries.ts:163`) for "no row", which the new fetch will reuse via `.maybeSingle()`.
- **List cards are uniform and have no navigation** — all 4 list components (`RepairEntryList.tsx`, `OilChangeEntryList.tsx`, `InspectionEntryList.tsx`, `InsuranceEntryList.tsx`) share an identical `<li>` shell with `onEdit`/`onDelete` ghost buttons. None currently link anywhere (`grep` for `href`/`navigate` → none).

## Desired End State

A user on `/entries` clicks anywhere on an entry card and lands on `/entries/[id]`, a branded full-screen page showing every field of that entry (em-dash for blanks), with multi-line text fully readable. Edit/Delete buttons on the card still work without navigating. Hitting an id that doesn't exist, isn't the user's, or doesn't belong to the currently selected car renders a styled in-app 404 panel with a link back to `/entries`.

Verify: clicking each entry type's card opens its detail page; multi-line repair descriptions show line breaks; a fabricated/foreign id shows the 404 panel; Edit/Delete still function from the list.

### Key Discoveries:

- Auth already handled by `startsWith("/entries")` — `src/middleware.ts:22`.
- Plain-text fields → render with `whitespace-pre-wrap`, no sanitization — `migrations/20260528000000_entries_schema.sql`.
- `PGRST116 → null` + `.maybeSingle()` is the established "row not found" idiom — `src/lib/services/entries.ts:163`.
- `entry_type` must be injected at the service boundary; it is not a DB column — `src/types.ts:69`.
- All 4 list components are copy-uniform — one edit pattern applies to all four.

## What We're NOT Doing

- No DB schema changes, no migrations.
- No API route changes (`src/pages/api/entries/*` untouched).
- No middleware changes (route already guarded).
- No edit/delete functionality on the detail page — display only.
- No markdown/HTML rendering or rich-text editor — fields stay plain text.
- No changes to the entry list's tab structure, forms, or the existing list rendering beyond making cards clickable.
- No new "back/breadcrumb" navigation system beyond a single back link on the detail page.

## Implementation Approach

Three phases, bottom-up: (1) a single `getEntryById` service that resolves the entry across all 4 tables by `id` + `user_id`; (2) the `/entries/[id]` Astro page that guards, scopes to the selected car, and renders via a non-interactive `EntryDetail.astro` component; (3) make the 4 list cards link to the detail page while preserving Edit/Delete. Per `CLAUDE.md`, the detail render is an `.astro` component (non-interactive), not React.

## Phase 1: Get-by-id entry service

### Overview

Add a service that, given an entry id and user id, finds which of the 4 tables holds it and returns the discriminated `Entry` (with `entry_type` injected) or `null`.

### Changes Required:

#### 1. `getEntryById` service function

**File**: `src/lib/services/entries.ts`

**Intent**: Resolve a single entry by id without knowing its type up front, scoped to the owning user. Queries all 4 tables in parallel; the one match wins; no match → `null`. This backs the detail page's "query all 4 tables" resolution strategy.

**Contract**: `getEntryById(supabase: SupabaseClient, entryId: string, userId: string): Promise<Entry | null>`. Each table queried with `.select("*").eq("id", entryId).eq("user_id", userId).maybeSingle()` in a `Promise.all`; on the matching row, inject the literal `entry_type` (`"repair"` | `"oil_change"` | `"inspection"` | `"insurance"`) exactly as the existing `get*Entries` mappers do; return the first non-null, else `null`. Reuse the existing error handling idiom (`.maybeSingle()` returns `data: null` with no error when absent — no `PGRST116` branch needed). Return type is the existing `Entry` union from `src/types.ts`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run lint` (ESLint runs type-checked rules per `README.md`)
- Build succeeds: `npm run build`

#### Manual Verification:

- (none — covered by Phase 2 page verification)

---

## Phase 2: Detail page + render component

### Overview

Create the `/entries/[id]` page (SSR guard + car-scope check + 404 panel) and a non-interactive `EntryDetail.astro` component that renders all fields for the entry's type.

### Changes Required:

#### 1. Entry detail render component

**File**: `src/components/entries/EntryDetail.astro`

**Intent**: Present every field of a single entry in a readable full-screen layout, switching on `entry_type`. Non-interactive → `.astro` per `CLAUDE.md`. Empty/null fields render with an em-dash placeholder (per decision: "show all fields"). Multi-line text fields render with line breaks preserved.

**Contract**: Props `{ entry: Entry }`. Renders the common fields (Date `conducted_at`, Mileage) then type-specific fields by switching on `entry.entry_type`:
- `repair` → Description, Cause
- `oil_change` → Oil details
- `inspection` → Result, Next inspection date
- `insurance` → Insurer, Policy start date, Renewal date

Long-text fields (`description`, `cause`, `oil_details`) use a `whitespace-pre-wrap` container so newlines render. Null/empty values render a shared em-dash placeholder (`—`). Dates formatted consistently with the list (`new Date(x).toLocaleDateString()`). May also show `created_at`/`updated_at` as a subtle metadata footer ("Logged on …"). Visual style matches the existing glass-card aesthetic in `entries.astro` (`rounded-2xl border border-white/10 bg-white/10 ... backdrop-blur-xl`).

#### 2. Entry detail page

**File**: `src/pages/entries/[id].astro`

**Intent**: Server-render a single entry's detail, guarding auth/car-selection/ownership and scoping the entry to the currently selected car. Mirrors the SSR control flow of `entries.astro`.

**Contract**: Reads `Astro.params.id`, `Astro.locals.user`, `Astro.locals.selectedCarId`. Control flow:
1. No `selectedCarId` or no `supabase`/`user` → `Astro.redirect("/cars")` (mirrors `entries.astro:15-23`).
2. Fetch the entry via `getEntryById(supabase, id, user.id)`.
3. **Not found OR `entry.car_id !== selectedCarId`** (car-scope decision) → set `Astro.response.status = 404` and render the in-app not-found panel (message + link back to `/entries`) inside `AppLayout`.
4. Otherwise fetch the car via `getCarById(supabase, selectedCarId, user.id)` for the header (same as `entries.astro:27`), render `AppLayout` containing a back link to `/entries` and `<EntryDetail entry={entry} />`.

No code snippet needed — the control flow follows `entries.astro` directly.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Navigating to `/entries/[valid-id]` for each of the 4 entry types renders all fields for that type.
- A multi-line repair `description` displays with its line breaks intact (not collapsed to one line).
- Null optional fields (e.g. a repair with no `cause`, an entry with no mileage) show the em-dash placeholder.
- `/entries/<random-uuid>` and an id belonging to a different selected car both show the styled 404 panel with a working "back to entries" link (and HTTP 404 status).
- Visiting `/entries/[id]` while logged out redirects to `/auth/signin` (existing middleware).
- The detail page renders inside the sidebar app shell (`AppLayout`) on both desktop and mobile.

**Implementation Note**: After Phase 2 automated checks pass, pause for manual confirmation before Phase 3.

---

## Phase 3: Clickable list cards

### Overview

Make each entry card in all 4 list components navigate to `/entries/[id]`, while keeping the existing Edit/Delete buttons working.

### Changes Required:

#### 1. Link the card shell (×4 components)

**File**: `src/components/entries/RepairEntryList.tsx`, `OilChangeEntryList.tsx`, `InspectionEntryList.tsx`, `InsuranceEntryList.tsx`

**Intent**: Make the whole card a link to the detail page (decision: "whole card is a link") without hijacking the Edit/Delete buttons. Applied identically to all four uniform components.

**Contract**: Wrap each `<li>`'s content in an anchor to `/entries/${entry.id}` (or make the `<li>` a clickable link region) with an interactive affordance (cursor/hover). The existing Edit and Delete `Button` `onClick` handlers must call `e.stopPropagation()` and `e.preventDefault()` before invoking `onEdit`/`onDelete`, so clicking them does not trigger navigation. Keep the existing card markup and conditional field rendering intact — only the wrapper and the two button handlers change.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Clicking the body of a card (all 4 types) navigates to that entry's detail page.
- Clicking Edit opens the edit form and does **not** navigate.
- Clicking Delete triggers the delete flow and does **not** navigate.
- Hover state signals the card is clickable.

**Implementation Note**: After Phase 3 automated checks pass, pause for manual confirmation. Then run the regression smoke check below.

---

## Testing Strategy

### Manual Testing Steps:

1. From `/entries`, click each of the 4 entry-type cards → detail page renders all fields.
2. Create/confirm a repair entry with a multi-line description → detail shows line breaks.
3. Create/confirm an entry with empty optional fields → detail shows em-dash placeholders.
4. Visit `/entries/<random-uuid>` → 404 panel with back link, HTTP 404.
5. With car A selected, take an entry id that belongs to car B (switch selection) → 404 panel (car-scope).
6. Log out, visit `/entries/[id]` → redirected to `/auth/signin`.
7. Regression (PRD guardrails `FR-007`): add/edit/delete still work from the list; Edit/Delete buttons don't navigate.

## Migration Notes

None — no data or schema changes.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-03)
- PRD: `context/foundation/prd-v2.md` (US-02, FR-005)
- SSR page pattern: `src/pages/entries.astro`
- Service pattern + `entry_type` injection: `src/lib/services/entries.ts:14-30`, `src/types.ts:69`
- Schema (plain TEXT fields): `supabase/migrations/20260528000000_entries_schema.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Get-by-id entry service

#### Automated

- [x] 1.1 Type checking passes: `npm run lint` — 19af11a
- [x] 1.2 Build succeeds: `npm run build` — 19af11a

### Phase 2: Detail page + render component

#### Automated

- [x] 2.1 Type checking passes: `npm run lint` — 4638283
- [x] 2.2 Build succeeds: `npm run build` — 4638283

#### Manual

- [x] 2.3 All 4 entry types render every field on `/entries/[id]` — 4638283
- [x] 2.4 Multi-line repair description shows line breaks — 4638283
- [x] 2.5 Null optional fields show em-dash placeholder — 4638283
- [x] 2.6 Unknown id and foreign-car id both show styled 404 panel (HTTP 404) with working back link — 4638283
- [x] 2.7 Logged-out visit redirects to `/auth/signin` — 4638283
- [x] 2.8 Detail page renders inside AppLayout on desktop and mobile — 4638283

### Phase 3: Clickable list cards

#### Automated

- [x] 3.1 Type checking passes: `npm run lint` — 9dc7c89
- [x] 3.2 Build succeeds: `npm run build` — 9dc7c89

#### Manual

- [x] 3.3 Clicking card body (all 4 types) navigates to detail page — 9dc7c89
- [x] 3.4 Clicking Edit opens edit form without navigating — 9dc7c89
- [x] 3.5 Clicking Delete triggers delete flow without navigating — 9dc7c89
- [x] 3.6 Hover state signals the card is clickable — 9dc7c89
