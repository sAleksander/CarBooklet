# Dashboard Last Entry Widget Implementation Plan

## Overview

Display the single most-recent entry of any type on `/dashboard`, below the existing oil-change / inspection / insurance deadline tiles — filling the empty space the PRD flagged as a UX failure. This is roadmap slice **S-04** (PRD `FR-006`). A read-only widget plus one cross-table service function. No database, API, route, or middleware changes.

## Current State Analysis

- **`dashboard.astro` is a clean SSR page** (`src/pages/dashboard.astro:1-108`): guards auth + car selection, fetches `getCarDeadlines`, renders a 3-column grid of `DeadlineCard` components. The area below the grid is empty — the target slot for this widget.
- **A direct pattern to mirror already exists** — `getCarDeadlines` (`src/lib/services/entries.ts:316-380`) runs parallel `Promise.all` queries across the entry tables, each `.order("conducted_at", { ascending: false }).limit(1)`, then reads `[0]`. "Last entry of any type" is the same shape: fetch the latest per table, then reduce to the single max across the four.
- **Entries live in 4 separate tables** — `repair_entries`, `oil_change_entries`, `inspection_entries`, `insurance_entries`. There is **no unified `entries` table and no `entry_type` DB column**; `entry_type` is injected at the service return site (`src/types.ts:69`). The roadmap's one Unknown (single table vs. separate tables) is resolved: separate tables.
- **All existing list/deadline queries sort by `conducted_at` desc** (`entries.ts` `get*Entries`), so "most recent" already means most-recent `conducted_at` everywhere in the app.
- **Reusable assets from the just-shipped `entry-detail-route` change** — the `/entries/[type]/[id]` detail route and `getEntryById(supabase, entryType, entryId, userId)`. The widget links to that route. The detail page's `entryTypeLabel` record is the labeling convention to follow.
- **Non-interactive UI is `.astro`** per `CLAUDE.md` — the widget is a static render, so it is an `.astro` component, not React. `DeadlineCard.astro` and `EntryDetail.astro` are the local precedents for the glass-card aesthetic.

## Desired End State

A user on `/dashboard` with at least one logged entry sees, below the three deadline tiles, a compact card showing the most recent entry: its type label, its `conducted_at` date, and a one-line type-specific summary. Clicking anywhere on the card opens that entry's detail page at `/entries/[type]/[id]`. A user whose selected car has zero entries sees no widget (the slot stays empty).

Verify: with entries present, the dashboard shows the correct most-recent entry and its card links to the right detail page; logging a newer entry updates the card on reload; two same-day entries resolve deterministically by type priority; a car with no entries renders no widget and no error.

### Key Discoveries:

- `getCarDeadlines` is the exact pattern to mirror for parallel per-table "latest" fetches — `src/lib/services/entries.ts:316-380`.
- `entry_type` must be injected at the service boundary; it is not a DB column — `src/types.ts:69`.
- Detail route + service already exist; widget only needs to link to `/entries/${entry.entry_type}/${entry.id}` — shipped in `entry-detail-route`.
- `conducted_at` is the established ordering field across the app — `entries.ts` `get*Entries`.
- Empty-state decision is "hide the widget", so the dashboard template renders the card only when the service returns non-null.

## What We're NOT Doing

- No DB schema changes, no migrations.
- No API route changes, no middleware changes.
- No new entry-detail rendering — the widget links to the existing `/entries/[type]/[id]` page; it does not embed `EntryDetail.astro`.
- No edit/delete affordances on the widget — display + link only.
- No filtering by entry type — "most recent of **any** type" per `FR-006`.
- No empty-state prompt/CTA — per decision, the widget is simply absent when there are no entries.
- No changes to the deadline tiles, the `getCarDeadlines` service, or any other dashboard content.
- No shared extraction of the `entryTypeLabel` map — a small inline record in the widget is consistent with the detail page and avoids cross-file coupling for this small change.

## Implementation Approach

Two phases, bottom-up: (1) a `getLastEntry` service that resolves the most-recent entry across all 4 tables, reusing the `getCarDeadlines` parallel-query shape and reducing the candidates to one by `conducted_at` with a fixed type-priority tie-break; (2) a non-interactive `LastEntryCard.astro` widget wired into `dashboard.astro` below the deadline grid, rendered only when an entry exists.

## Critical Implementation Details

**Tie-break semantics.** Each per-table query returns at most one row (its latest by `conducted_at`), yielding up to four candidates. The winner is the candidate with the latest `conducted_at`; when two share an identical `conducted_at` (the columns are date-granular, so same-day ties are real), the lower-priority-index type wins, using the fixed order `repair (0) > oil_change (1) > inspection (2) > insurance (3)` — matching the `EntryType` declaration order in `src/types.ts:33`. This makes the result deterministic across runs and test-stable.

## Phase 1: `getLastEntry` service function

### Overview

Add a service that returns the single most-recent `Entry` (any type) for a car, or `null` when the car has no entries.

### Changes Required:

#### 1. `getLastEntry` service function

**File**: `src/lib/services/entries.ts`

**Intent**: Resolve the most-recent entry across all 4 tables for a given car + user, so the dashboard can show "your last entry of any type". Mirrors the `getCarDeadlines` parallel-fetch shape; placed adjacent to it in the cross-table aggregation section (after `getCarDeadlines`) so all multi-table reads sit together.

**Contract**: `getLastEntry(supabase: SupabaseClient, carId: string, userId: string): Promise<Entry | null>`. Query all 4 tables in a `Promise.all`, each `.select("*").eq("car_id", carId).eq("user_id", userId).order("conducted_at", { ascending: false }).limit(1)`; throw on any `res.error` (same idiom as `getCarDeadlines`). Inject the literal `entry_type` on each present row (exactly as the `get*Entries` mappers do) to build the candidate list, dropping tables that returned no row. Reduce candidates to the winner using the tie-break in "Critical Implementation Details"; return `null` when there are no candidates. Because the comparison is the non-obvious part, the reducer is shown:

```ts
const priority: Record<Entry["entry_type"], number> = {
  repair: 0,
  oil_change: 1,
  inspection: 2,
  insurance: 3,
};
const last = candidates.reduce<Entry | null>((best, cur) => {
  if (!best) return cur;
  const delta = new Date(cur.conducted_at).getTime() - new Date(best.conducted_at).getTime();
  if (delta > 0) return cur;
  if (delta === 0 && priority[cur.entry_type] < priority[best.entry_type]) return cur;
  return best;
}, null);
return last;
```

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- (none — covered by Phase 2 dashboard verification)

---

## Phase 2: `LastEntryCard` widget + dashboard wiring

### Overview

Create the non-interactive `LastEntryCard.astro` widget and render it on `/dashboard` below the deadline grid, only when `getLastEntry` returns an entry.

### Changes Required:

#### 1. Last-entry widget component

**File**: `src/components/LastEntryCard.astro`

**Intent**: Present the most-recent entry as a compact, clickable summary that links to its full detail page. Non-interactive → `.astro` per `CLAUDE.md`. Visual style matches the existing glass-card aesthetic (`DeadlineCard.astro`, the entries list cards).

**Contract**: Props `{ entry: Entry }`. Renders a single `<a href={`/entries/${entry.entry_type}/${entry.id}`}>` card containing: the entry type label (from a small inline `Record<string, string>` mirroring the detail page's `entryTypeLabel`), the `conducted_at` date formatted as `new Date(entry.conducted_at).toLocaleDateString()`, and a one-line type-specific summary chosen by switching on `entry.entry_type` — `repair → description`, `oil_change → oil_details`, `inspection → result`, `insurance → insurer` — with an em-dash (`—`) placeholder when the field is null. Hover affordance consistent with the entries list cards (`transition-colors hover:bg-white/10`).

#### 2. Dashboard wiring

**File**: `src/pages/dashboard.astro`

**Intent**: Fetch the last entry alongside the existing deadlines and render the widget below the deadline grid, hidden when there is none.

**Contract**: Import `getLastEntry` and `LastEntryCard`. Fetch `lastEntry` within the existing data-load `try` (it already redirects to `/cars?error=load_failed` on throw); fetching it concurrently with `getCarDeadlines` via the existing `Promise.all` is preferred. After the deadline grid `</div>`, render `{lastEntry && <LastEntryCard entry={lastEntry} />}` inside the same `max-w-3xl` container, with top margin separating it from the grid. No change to the deadline tiles or guards.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- On a car with entries, the dashboard shows a card for the most-recent entry (correct type label, date, and type-specific summary line).
- The card links to `/entries/[type]/[id]` for that entry and opens the correct detail page.
- After logging an entry with a newer `conducted_at`, the card updates on dashboard reload.
- Two entries with the same `conducted_at` resolve deterministically by type priority (`repair > oil_change > inspection > insurance`).
- A null summary field (e.g. a repair with no cause, an inspection with no result) shows the em-dash placeholder.
- A car with zero entries renders no widget and no error (empty slot below the tiles).
- The widget renders inside `AppLayout` on both desktop and mobile.

**Implementation Note**: After Phase 2 automated checks pass, pause for manual confirmation. Then run the regression smoke check (dashboard deadline tiles still render correctly for cars with and without entries).

---

## Testing Strategy

### Manual Testing Steps:

1. On `/dashboard` with a car that has multiple entry types, confirm the card shows the entry with the latest `conducted_at`.
2. Click the card → lands on that entry's `/entries/[type]/[id]` detail page.
3. Log a new entry dated later than the current latest → reload `/dashboard` → card updates to the new entry.
4. Create two entries of different types with the same `conducted_at` → confirm `repair > oil_change > inspection > insurance` decides the winner.
5. Confirm a type with a null summary field renders the em-dash.
6. Select (or create) a car with no entries → dashboard shows the deadline tiles and no last-entry widget, no error.
7. Regression (PRD guardrail `FR-007`): deadline tiles still render for cars with and without entries.

## Migration Notes

None — no data or schema changes.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-04)
- PRD: `context/foundation/prd-v2.md` (FR-006)
- Pattern to mirror: `src/lib/services/entries.ts:316-380` (`getCarDeadlines`)
- Detail route to link to: `src/pages/entries/[type]/[id].astro` (shipped in `entry-detail-route`)
- Glass-card aesthetic: `src/components/DeadlineCard.astro`, `src/components/entries/EntryDetail.astro`
- `entry_type` injection: `src/types.ts:69`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: `getLastEntry` service function

#### Automated

- [x] 1.1 Type checking passes: `npm run lint`
- [x] 1.2 Build succeeds: `npm run build`

### Phase 2: `LastEntryCard` widget + dashboard wiring

#### Automated

- [ ] 2.1 Type checking passes: `npm run lint`
- [ ] 2.2 Build succeeds: `npm run build`

#### Manual

- [ ] 2.3 Dashboard shows a card for the most-recent entry (correct label, date, type-specific summary)
- [ ] 2.4 Card links to and opens the correct `/entries/[type]/[id]` detail page
- [ ] 2.5 Card updates on reload after logging a newer-dated entry
- [ ] 2.6 Same-`conducted_at` entries resolve by type priority (repair > oil_change > inspection > insurance)
- [ ] 2.7 Null summary field shows the em-dash placeholder
- [ ] 2.8 Car with zero entries renders no widget and no error
- [ ] 2.9 Widget renders inside AppLayout on desktop and mobile
