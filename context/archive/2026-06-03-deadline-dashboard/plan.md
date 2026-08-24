# Deadline Dashboard Implementation Plan

## Overview

Replace the placeholder `dashboard.astro` with a full-page deadline surface for S-06. The page shows three deadline cards for the selected car — oil change, inspection, and insurance — each color-coded by urgency (red / yellow / green). No database schema changes are needed: `oil_change_entries.conducted_at`, `inspection_entries.next_inspection_date`, and `insurance_entries.renewal_date` already exist from F-02.

## Current State Analysis

- `src/pages/dashboard.astro` — a minimal centered glass card showing car name + "Change car" link. No entry data, no Topbar, no deadlines.
- `src/lib/services/entries.ts` — 20 functions (get/create/update/delete × 4 types); no deadline aggregation.
- `src/types.ts` — all four entry types defined; no deadline types.
- No date utility helpers exist in `src/lib/`.
- Topbar is not imported in `dashboard.astro` (every other page imports it individually; Layout does not include it).

## Desired End State

Navigating to `/dashboard` shows a full-page layout with the selected car name as a heading and three deadline cards in a responsive grid. Each card is bordered and tinted red (overdue or ≤30 days), yellow (31–90 days), or green (>90 days). When no relevant entry exists, the card shows a "No data" placeholder. The oil change card shows the date-based next-due date (conducted_at + 1 year); if mileage was logged, it also shows the km-based threshold (mileage + 10 000 km) as supplementary information. For inspection, if an entry exists but `next_inspection_date` was not recorded, the card shows the last inspection date with a "next date not set" note. Topbar is rendered as on all other authenticated pages.

### Key Discoveries

- `entries.astro:26-33` — parallel `Promise.all` fetches for SSR; same pattern for deadline queries.
- `entries.astro:41-43` — page layout: `bg-cosmic min-h-screen p-4` + `<Topbar />` + centered card. Dashboard redesign follows this.
- `insurance_entries.renewal_date` — `DATE NOT NULL` in the schema (always populated); query by `ORDER BY renewal_date DESC LIMIT 1` to get the active/latest policy.
- `inspection_entries.next_inspection_date` — nullable `DATE`; a null value with an existing entry is the "no next date" case (user intentionally omitted it).
- Oil change urgency is date-only: the app has no current-odometer data, so `nextDueMileage` (lastMileage + 10 000) is displayed as an informational threshold only, not used to compute the status color.
- `supabase/migrations/20260528000000_entries_schema.sql` — entries schema plan explicitly notes "no `next_change_date` column on `oil_change_entries` — dashboard derives this at query time."
- `src/lib/supabase.ts` — `createClient(request.headers, cookies)` returns `SupabaseClient | null`; both SSR calls must guard the null case.
- `context/changes/entries-schema/plan.md` — confirmed: "S-06 will query `inspection_entries.next_inspection_date` and `insurance_entries.renewal_date` directly."

## What We're NOT Doing

- No schema changes — all required columns already exist
- No user-configurable urgency thresholds — 30/90-day windows are hardcoded constants
- No oil change mileage-based urgency — displayed informatively only; current odometer is not tracked
- No multi-car deadline overview — dashboard shows the selected car only
- No React island — deadline cards are static (no interactivity); pure Astro rendering
- No API endpoint for deadline data — SSR fetch in dashboard frontmatter is sufficient
- No `next_change_date` column on oil change entries — computed at render time

## Implementation Approach

**Phase 1** adds types and a single `getCarDeadlines()` service function. The function runs three parallel Supabase queries (`Promise.all`), then computes status and next-due dates in TypeScript. All deadline logic lives here — no computation in the template.

**Phase 2** introduces a `DeadlineCard.astro` component (status-colored container + slot) and replaces `dashboard.astro` with the full-page layout. The page calls `getCarDeadlines()` in its frontmatter and renders three card instances, each with type-specific inner content passed via the slot.

## Critical Implementation Details

**Oil change "next due" date**: `conducted_at` is a `DATE` string (`YYYY-MM-DD`). Add one year via `new Date(conducted_at); d.setFullYear(d.getFullYear() + 1)`, then reformat to `YYYY-MM-DD` with `.toISOString().substring(0, 10)`.

**Status computation**: Today's date must be normalized to midnight for consistent day-count arithmetic: `const today = new Date(); today.setHours(0, 0, 0, 0)`. Days until = `Math.floor((dueDate - today) / 86_400_000)`. Values ≤ 30 (including negative = overdue) → `'red'`; ≤ 90 → `'yellow'`; > 90 → `'green'`.

**Insurance query ordering**: Unlike other entry types, insurance should be fetched `ORDER BY renewal_date DESC` (not `conducted_at DESC`) to surface the policy with the latest expiry, not the most recently logged one.

**No `.maybeSingle()`**: Each deadline query uses `.limit(1)` (returns an array). Access the result as `data?.[0] ?? null`. This avoids the PGRST116 path that `.single()` and `.maybeSingle()` trigger on zero rows.

---

## Phase 1: Service Function + Deadline Types

### Overview

Add deadline-specific types to `src/types.ts` and a `getCarDeadlines()` function to `src/lib/services/entries.ts`. After this phase the full deadline data contract is queryable and typed — Phase 2 renders it.

### Changes Required

#### 1. Deadline types

**File**: `src/types.ts` (append after the `InsuranceEntryFormData` export)

**Intent**: Export a `DeadlineStatus` discriminant and three deadline interfaces — one per entry type — composed into a `CarDeadlines` aggregate that `getCarDeadlines()` returns and `dashboard.astro` consumes.

**Contract**:

- `DeadlineStatus = 'no_data' | 'no_next_date' | 'red' | 'yellow' | 'green'`
  - `'no_data'` — no relevant entry exists for this car
  - `'no_next_date'` — inspection-only: entry exists but `next_inspection_date` is null
  - `'red'` — overdue or due within 30 days
  - `'yellow'` — due within 31–90 days
  - `'green'` — due in more than 90 days
- `OilChangeDeadline { status: DeadlineStatus; lastConductedAt: string | null; lastMileage: number | null; nextDueDate: string | null; nextDueMileage: number | null }`
- `InspectionDeadline { status: DeadlineStatus; lastConductedAt: string | null; nextInspectionDate: string | null }`
- `InsuranceDeadline { status: DeadlineStatus; renewalDate: string | null; insurer: string | null }`
- `CarDeadlines { oilChange: OilChangeDeadline; inspection: InspectionDeadline; insurance: InsuranceDeadline }`

#### 2. `getCarDeadlines()` service function

**File**: `src/lib/services/entries.ts` (append at the bottom, after the delete functions)

**Intent**: Fetch the latest relevant entry per deadline type for a given car, compute next-due dates and urgency status, and return a `CarDeadlines` object ready for the dashboard to render.

**Contract**: `getCarDeadlines(supabase: SupabaseClient, carId: string, userId: string): Promise<CarDeadlines>`

Three parallel Supabase queries via `Promise.all`:

1. `oil_change_entries` — `ORDER BY conducted_at DESC LIMIT 1`
2. `inspection_entries` — `ORDER BY conducted_at DESC LIMIT 1`
3. `insurance_entries` — `ORDER BY renewal_date DESC LIMIT 1`

All three use `.eq("car_id", carId).eq("user_id", userId)`. All throw on `res.error`. Use `data?.[0] ?? null` to extract the single row.

Internal helpers (unexported, defined before the function):

- `addOneYear(dateStr: string): string` — returns `dateStr` with year incremented by 1, formatted as `YYYY-MM-DD`
- `computeDeadlineStatus(dueDateStr: string | null): DeadlineStatus` — returns `'no_data'` when null; otherwise normalizes today to midnight, computes daysUntil, and returns `'red'` / `'yellow'` / `'green'` per the 30/90-day thresholds

Return construction:

- `oilChange`: `nextDueDate = oil ? addOneYear(oil.conducted_at) : null`; `nextDueMileage = oil?.mileage != null ? oil.mileage + 10_000 : null`; `status = computeDeadlineStatus(nextDueDate)`
- `inspection`: if `!insp` → `'no_data'`; else if `!insp.next_inspection_date` → `'no_next_date'`; else → `computeDeadlineStatus(insp.next_inspection_date)`
- `insurance`: `status = ins ? computeDeadlineStatus(ins.renewal_date) : 'no_data'`

### Success Criteria

#### Automated Verification

- `npm run lint` passes with no new errors
- `npm run build` passes with no TypeScript errors

#### Manual Verification

- Import `{ getCarDeadlines, CarDeadlines }` from `@/lib/services/entries` in any file without error
- With a car that has at least one oil change entry: calling `getCarDeadlines()` (e.g., via the dashboard page once Phase 2 is done) returns a `CarDeadlines` object with a non-null `oilChange.nextDueDate` and a correct `status`

**Implementation Note**: After automated checks pass, confirm before proceeding to Phase 2.

---

## Phase 2: Dashboard Page Redesign

### Overview

Replace `dashboard.astro` with a full-page layout that renders three deadline cards using `getCarDeadlines()`. Introduce `DeadlineCard.astro` as the status-colored card container.

### Changes Required

#### 1. New `DeadlineCard.astro` component

**File**: `src/components/DeadlineCard.astro`

**Intent**: A reusable status-colored card container for displaying deadline information. Accepts a title and a `DeadlineStatus` value; renders a bordered card tinted to match the urgency level, with a slot for type-specific content.

**Contract**:

- Props: `{ title: string; status: DeadlineStatus }`
- Border and background tint map to status:
  - `'red'` → destructive/red tint (e.g., `border-red-400/50 bg-red-500/10`)
  - `'yellow'` → warning/amber tint
  - `'green'` → success/green tint
  - `'no_data'` / `'no_next_date'` → neutral muted tint (e.g., `border-white/10 bg-white/5`)
- Card header: title text + a small colored status badge or dot
- `<slot />` for inner content
- Import `DeadlineStatus` from `@/types`

#### 2. Rework `src/pages/dashboard.astro`

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the placeholder centered card with a full-page deadline surface. Follow the `entries.astro` layout pattern — `bg-cosmic min-h-screen p-4` + `<Topbar />` + centered content container. Deadline data is fetched server-side in the frontmatter; no React island needed.

**Contract**:

Frontmatter changes:

- Import `Topbar` from `@/components/Topbar.astro`
- Import `DeadlineCard` from `@/components/DeadlineCard.astro`
- Import `getCarDeadlines` from `@/lib/services/entries`
- Import `DeadlineStatus` from `@/types` (for slot content type narrowing if needed)
- Guard `!supabase || !user` → redirect `/cars` (matching `entries.astro:22-24`)
- Call `getCarDeadlines(supabase, selectedCarId, user.id)` after the car validity check; wrap in try/catch → redirect `/cars` on error
- Keep existing `getCarById` call and ownership check (`car?.user_id !== user.id`)

Template structure (mirrors `entries.astro` layout):

```
<Layout title="Dashboard — {car.brand} {car.model}">
  <div class="bg-cosmic min-h-screen p-4">
    <Topbar />
    <div class="flex justify-center pt-8">
      <div class="w-full max-w-3xl ...">
        <!-- car heading -->
        <h1>{car.brand} {car.model}</h1>
        <p>{car.production_year}</p>
        <a href="/cars">Change car</a>

        <!-- deadline grid -->
        <div class="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
          <DeadlineCard title="Oil Change" status={deadlines.oilChange.status}>
            <!-- oil change slot content -->
          </DeadlineCard>
          <DeadlineCard title="Inspection" status={deadlines.inspection.status}>
            <!-- inspection slot content -->
          </DeadlineCard>
          <DeadlineCard title="Insurance" status={deadlines.insurance.status}>
            <!-- insurance slot content -->
          </DeadlineCard>
        </div>
      </div>
    </div>
  </div>
</Layout>
```

Slot content per card:

- **Oil change**: if `no_data` → "No oil change entries logged." else → "Last: {lastConductedAt}" + "Next due: {nextDueDate}" + (if `nextDueMileage`) "or at ~{nextDueMileage.toLocaleString()} km"
- **Inspection**: if `no_data` → "No inspection entries logged." | if `no_next_date` → "Last: {lastConductedAt}" + "Next date not set." | else → "Next inspection: {nextInspectionDate}"
- **Insurance**: if `no_data` → "No insurance entries logged." | else → "Renewal: {renewalDate}" + (if `insurer`) insurer name
- Remove the `<form method="POST" action="/api/auth/signout">` block — sign-out is in Topbar

### Success Criteria

#### Automated Verification

- `npm run build` passes with no type errors

#### Manual Verification (wrangler dev)

- `/dashboard` loads with the full-page layout and Topbar visible
- All three deadline cards render for a car with entries of each type
- Urgency colors are correct: a past-due oil change shows red, a 60-day-away inspection shows yellow, a far-future insurance renewal shows green
- A card with no entries shows the "No data" placeholder text
- An inspection entry without `next_inspection_date` shows the "next date not set" note
- Oil change card shows the km threshold only when mileage was logged on the last entry
- "Change car" link navigates to `/cars`
- Topbar is visible and "Dashboard" link is active/highlighted
- No regressions on `/entries` or `/ai-chat`

**Implementation Note**: This is the definition of done for S-06. Verify all four urgency/data states manually.

---

## Testing Strategy

### Manual Testing Steps

1. Start Supabase and dev server (`npx supabase start`, `npm run dev`)
2. Sign in, select a car, navigate to `/dashboard`
3. With no entries: all three cards show "No data" placeholder
4. Log an oil change (with mileage) → card shows date + km thresholds; edit conducted_at to be 11 months ago → card turns red
5. Log an inspection with `next_inspection_date` 60 days from today → card shows yellow
6. Log an inspection without `next_inspection_date` → card shows "next date not set"
7. Log insurance with renewal_date > 90 days away → card shows green; edit to < 30 days → card turns red
8. Add a second oil change entry more recent than the first → deadline card reflects the newer entry
9. Verify `/entries`, `/ai-chat`, and `/cars` have no regressions

## Performance Considerations

Three Supabase queries run in parallel via `Promise.all` with `LIMIT 1` each — negligible cost. The page is fully server-rendered; no client-side data fetching or hydration cost.

## Migration Notes

None — no schema changes. All three date columns exist from F-02.

## References

- Roadmap S-06: `context/foundation/roadmap.md`
- PRD FR-012: `context/foundation/prd.md`
- Schema plan (confirms deadline columns): `context/changes/entries-schema/plan.md`
- Layout pattern reference: `src/pages/entries.astro`
- Existing entry types: `src/types.ts`
- Entry service pattern: `src/lib/services/entries.ts`
- Topbar component: `src/components/Topbar.astro`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Service Function + Deadline Types

#### Automated

- [x] 1.1 `npm run lint` passes with no new errors — 34974da
- [x] 1.2 `npm run build` passes with no TypeScript errors — 34974da

#### Manual

- [x] 1.3 `getCarDeadlines` and `CarDeadlines` import cleanly from `@/lib/services/entries` — 34974da

### Phase 2: Dashboard Page Redesign

#### Automated

- [x] 2.1 `npm run build` passes with no type errors — 0bfd1bf

#### Manual

- [x] 2.2 `/dashboard` loads full-page layout with Topbar — 0bfd1bf
- [x] 2.3 All three deadline cards render correctly with entry data — 0bfd1bf
- [x] 2.4 Urgency colors correct: red / yellow / green per threshold — 0bfd1bf
- [x] 2.5 No-data placeholder renders for cards with no entries — 0bfd1bf
- [x] 2.6 Inspection "next date not set" state renders correctly — 0bfd1bf
- [x] 2.7 Oil change km threshold shows only when mileage was logged — 0bfd1bf
- [x] 2.8 No regressions on `/entries` or `/ai-chat` — 0bfd1bf
