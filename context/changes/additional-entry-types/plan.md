# Additional Entry Types Implementation Plan

## Overview

Extend `/entries` from repair-only to all four entry types by adding oil change, inspection, and insurance logging behind a tabbed UI. The page becomes a `EntriesTabs` island (Repairs | Oil Changes | Inspections | Insurance), Repairs active by default. Each type follows the full S-03 pattern: service functions → API route → form + list + orchestrator → server-side pre-fetch.

## Current State Analysis

- F-02 schema is live: `oil_change_entries`, `inspection_entries`, `insurance_entries` all exist with RLS and triggers.
- TypeScript types are fully defined in `src/types.ts`: `OilChangeEntry`, `InspectionEntry`, `InsuranceEntry` and their `*FormData` counterparts.
- S-03 established the complete stack pattern — service (`entries.ts`), GET/POST route (`/api/entries/repair`), React island (`RepairEntries` + `RepairEntryForm` + `RepairEntryList`), and Astro page (`entries.astro`).
- `entries.astro` currently fetches repair entries only and mounts `<RepairEntries client:load />`.
- `getRepairEntries(supabase, carId, userId)` and `createRepairEntry(supabase, userId, carId, data)` in `src/lib/services/entries.ts` are the exact signatures to mirror.
- Ownership check pattern established by impl-review: `car?.user_id !== user.id → 404`.

## Desired End State

A user navigates to `/entries`, sees four tabs (Repairs | Oil Changes | Inspections | Insurance). Switching tabs shows the add-form and history list for that type. Each form submits, clears, and prepends the new entry to the list without a page reload. The heading no longer says "Repair Entries" — it reflects the car name only.

### Key Discoveries

- Service pattern: `src/lib/services/entries.ts:4–33` — get and create functions accept `(supabase, carId, userId)` / `(supabase, userId, carId, data)`.
- API route pattern: `src/pages/api/entries/repair.ts` — GET validates `car_id` UUID from query params; POST validates with Zod, checks `car?.user_id !== user.id`, returns 201.
- `InsuranceEntry.renewal_date` is `string` (NOT NULL) — the only required date-specific field across the three new types.
- `InspectionEntry.result` is `string | null` (nullable) — the Pass/Fail select stores `"Passed"` / `"Failed"` or null if left blank.
- Island pattern: `RepairEntries.tsx:1–32` — owns `entries` array state + `formKey` counter for form reset; renders `<RepairEntryForm key={formKey} ...>` + `<RepairEntryList entries={entries} />`.
- Page pre-fetch: `entries.astro:21–24` — `Promise.all` parallel fetches for car + entries.
- `shadcn/ui` `<Select>` is already installed (used in car form); no new component install needed.

## What We're NOT Doing

- No edit or delete of entries — that is S-05
- No entry filtering, pagination, or search
- No AI prompt update to include entries — that is the S-02 addendum (deferred until S-04 ships)
- No additional Topbar links — single "Entries" link unchanged
- No tab persistence in localStorage — Repairs tab is always the default on page load
- No shared generic component abstraction across the three new list types

## Implementation Approach

Three-layer stack repeated for each new entry type (mirroring S-03), then a tab orchestrator and page update:

1. **Service layer** (`entries.ts`): Add `getOilChangeEntries`, `createOilChangeEntry`, and counterparts for inspection and insurance. Each mirrors `getRepairEntries`/`createRepairEntry` exactly — same signature, same table, different table name and `entry_type` const.

2. **API routes** (`/api/entries/oil-change.ts`, `/api/entries/inspection.ts`, `/api/entries/insurance.ts`): Each file is a near-copy of `repair.ts` with a type-specific Zod schema. The inspection schema validates `result` as `z.enum(["Passed", "Failed"]).nullable().optional()`. The insurance schema makes `renewal_date` required (no `.optional()`).

3. **React components**: Per-type form + list + orchestrator for each of the three new types. All follow the `RepairEntryForm`/`RepairEntryList`/`RepairEntries` pattern. `EntriesTabs` owns the `activeTab` string state and conditionally renders one of the four orchestrators.

4. **Astro page update**: `entries.astro` imports the new service functions, expands `Promise.all` to 5 items (car + 4 entry lists), replaces `<RepairEntries>` with `<EntriesTabs>`, and updates the page heading to show only the car name (removing "— Repair Entries").

## Critical Implementation Details

**Inspection result field**: The DB column is `TEXT` (nullable). The API Zod schema validates the result as `z.enum(["Passed", "Failed"]).nullable().optional()` — exactly these two string values or null. The form `<Select>` has three options: an empty placeholder (submits null), "Passed", and "Failed". Do not accept arbitrary strings at the API layer.

**EntriesTabs props shape**: The island receives `initialRepairEntries`, `initialOilChangeEntries`, `initialInspectionEntries`, `initialInsuranceEntries` (each typed as their respective array) plus `carId`. Active tab does not need to be a prop — it defaults to `"repairs"` in component state.

---

## Phase 1: Service + API Routes

### Overview

Add 6 service functions to `entries.ts` and create 3 new API route files. After this phase the full backend chain for all three new types is verifiable with `curl`.

### Changes Required

#### 1. Extend entries service

**File**: `src/lib/services/entries.ts`

**Intent**: Add `get` and `create` pairs for oil change, inspection, and insurance entries. Each pair follows the established `getRepairEntries`/`createRepairEntry` pattern exactly, differing only in the table name and injected `entry_type` const.

**Contract**:
- `getOilChangeEntries(supabase: SupabaseClient, carId: string, userId: string): Promise<OilChangeEntry[]>` — SELECT from `oil_change_entries`, filter `car_id = carId` and `user_id = userId`, order by `conducted_at` DESC. Map rows: inject `entry_type: 'oil_change' as const`.
- `createOilChangeEntry(supabase: SupabaseClient, userId: string, carId: string, data: OilChangeEntryFormData): Promise<OilChangeEntry>` — INSERT with `user_id` + `car_id` + spread `data`, SELECT single. Return with `entry_type: 'oil_change' as const`.
- Repeat the same structure for `getInspectionEntries`/`createInspectionEntry` (`inspection_entries`, `entry_type: 'inspection' as const`) and `getInsuranceEntries`/`createInsuranceEntry` (`insurance_entries`, `entry_type: 'insurance' as const`).
- All 6 functions throw on `res.error` — same error handling as the existing pair.
- Import `OilChangeEntry`, `OilChangeEntryFormData`, `InspectionEntry`, `InspectionEntryFormData`, `InsuranceEntry`, `InsuranceEntryFormData` from `@/types`.

#### 2. Oil change API route

**File**: `src/pages/api/entries/oil-change.ts`

**Intent**: GET and POST for oil change entries. Direct copy of `repair.ts` with the oil-change Zod schema.

**Contract**:
- GET: `car_id` UUID from query params → `getOilChangeEntries(supabase, carId, user.id)` → `{ entries }`.
- POST Zod schema:
  ```ts
  z.object({
    car_id: z.string().uuid(),
    conducted_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    mileage: z.number().int().min(0).nullable().optional(),
    oil_details: z.string().nullish().transform(v => v ?? null),
  })
  ```
- Ownership check: `car?.user_id !== user.id → 404`.
- Returns `{ entry }` with status 201.

#### 3. Inspection API route

**File**: `src/pages/api/entries/inspection.ts`

**Intent**: GET and POST for inspection entries, with `result` restricted to "Passed" or "Failed".

**Contract**:
- POST Zod schema:
  ```ts
  z.object({
    car_id: z.string().uuid(),
    conducted_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    mileage: z.number().int().min(0).nullable().optional(),
    result: z.enum(["Passed", "Failed"]).nullable().optional().transform(v => v ?? null),
    next_inspection_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().transform(v => v ?? null),
  })
  ```
- Calls `createInspectionEntry`. Returns `{ entry }` with 201.

#### 4. Insurance API route

**File**: `src/pages/api/entries/insurance.ts`

**Intent**: GET and POST for insurance entries, with `renewal_date` required.

**Contract**:
- POST Zod schema:
  ```ts
  z.object({
    car_id: z.string().uuid(),
    conducted_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    mileage: z.number().int().min(0).nullable().optional(),
    insurer: z.string().nullish().transform(v => v ?? null),
    policy_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().transform(v => v ?? null),
    renewal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Renewal date must be YYYY-MM-DD'),
  })
  ```
- Calls `createInsuranceEntry`. Returns `{ entry }` with 201.

### Success Criteria

#### Automated Verification

- `npm run lint` passes with no new errors
- `npm run build` passes with no TypeScript errors

#### Manual Verification

- `curl -X GET "http://localhost:4321/api/entries/oil-change?car_id=<uuid>" -H "Cookie: <session>"` returns `{ "entries": [] }` for a car with no entries (repeat for inspection and insurance)
- `curl -X POST .../api/entries/oil-change` with valid body returns `{ entry }` 201; same for inspection and insurance
- POST to insurance without `renewal_date` returns 400
- POST to inspection with `result: "Unknown"` returns 400
- Requests without session return 401; requests with another user's `car_id` return 404

**Implementation Note**: After automated and manual curl verifications pass, confirm before proceeding to Phase 2.

---

## Phase 2: React Components

### Overview

Create the three new per-type component triads (form + list + orchestrator) and the `EntriesTabs` tab controller. All new components live in `src/components/entries/`.

### Changes Required

#### 1. OilChangeEntryForm

**File**: `src/components/entries/OilChangeEntryForm.tsx`

**Intent**: Form for adding an oil change entry. `oil_details` is the only type-specific field (optional text area). Follows `RepairEntryForm` pattern exactly.

**Contract**:
- Props: `{ carId: string; onSuccess: (entry: OilChangeEntry) => void }`
- Form state: `conducted_at` defaults to today, `oil_details: ''`, `mileage: null`.
- POSTs to `/api/entries/oil-change`. No client-side required-field validation beyond non-empty `conducted_at`.
- Button: "Log oil change" / "Saving…".

#### 2. OilChangeEntryList

**File**: `src/components/entries/OilChangeEntryList.tsx`

**Intent**: Display list of oil change entries. Shows date, mileage (if non-null), oil details (if non-null).

**Contract**:
- Props: `{ entries: OilChangeEntry[] }`.
- Empty state: "No oil change entries yet. Log your first one above."
- Per entry: formatted `conducted_at`, mileage labeled "Mileage:", `oil_details` labeled "Details:".

#### 3. OilChangeEntries

**File**: `src/components/entries/OilChangeEntries.tsx`

**Intent**: Orchestrator island. Owns entries state and form-reset key. Mirrors `RepairEntries` exactly.

**Contract**:
- Props: `{ initialEntries: OilChangeEntry[]; carId: string }`.
- State: `entries`, `formKey`.
- `handleSuccess(entry)`: prepend entry, increment formKey.
- Renders `<OilChangeEntryForm key={formKey} ...>` above `<OilChangeEntryList entries={entries} />`.

#### 4. InspectionEntryForm

**File**: `src/components/entries/InspectionEntryForm.tsx`

**Intent**: Form for adding an inspection entry. Type-specific fields: `result` as a Pass/Fail select, `next_inspection_date` as a date input.

**Contract**:
- Props: `{ carId: string; onSuccess: (entry: InspectionEntry) => void }`
- Form state: `conducted_at` = today, `result: null`, `next_inspection_date: ''`, `mileage: null`.
- `result` rendered as `<Select>` (shadcn/ui). Options: a placeholder "Select result" (value `""`), "Passed", "Failed". On change, set to the string value or null if the placeholder is selected.
- POSTs to `/api/entries/inspection`. No required fields beyond `conducted_at`.
- Button: "Log inspection" / "Saving…".

#### 5. InspectionEntryList

**File**: `src/components/entries/InspectionEntryList.tsx`

**Intent**: Display list of inspection entries. Shows date, result (if non-null), next inspection date (if non-null), mileage (if non-null).

**Contract**:
- Props: `{ entries: InspectionEntry[] }`.
- Empty state: "No inspection entries yet. Log your first one above."
- Per entry: date, result labeled "Result:", `next_inspection_date` labeled "Next due:", mileage.

#### 6. InspectionEntries

**File**: `src/components/entries/InspectionEntries.tsx`

**Intent**: Orchestrator. Same pattern as `OilChangeEntries` for `InspectionEntry` and `/api/entries/inspection`.

**Contract**: Props `{ initialEntries: InspectionEntry[]; carId: string }`. Same `entries` + `formKey` state pattern.

#### 7. InsuranceEntryForm

**File**: `src/components/entries/InsuranceEntryForm.tsx`

**Intent**: Form for adding an insurance entry. Type-specific fields: `insurer` (optional text), `policy_start_date` (optional date), `renewal_date` (required date).

**Contract**:
- Props: `{ carId: string; onSuccess: (entry: InsuranceEntry) => void }`
- Form state: `conducted_at` = today, `insurer: ''`, `policy_start_date: ''`, `renewal_date: ''`, `mileage: null`.
- Client-side validation: `renewal_date` must be non-empty.
- POSTs to `/api/entries/insurance`.
- Button: "Log insurance" / "Saving…".

#### 8. InsuranceEntryList

**File**: `src/components/entries/InsuranceEntryList.tsx`

**Intent**: Display list of insurance entries. Shows date, insurer (if non-null), policy start date (if non-null), renewal date (always shown — it is required), mileage (if non-null).

**Contract**:
- Props: `{ entries: InsuranceEntry[] }`.
- Empty state: "No insurance entries yet. Log your first one above."
- Per entry: date, insurer labeled "Insurer:", policy start labeled "Policy from:", renewal labeled "Renewal:".

#### 9. InsuranceEntries

**File**: `src/components/entries/InsuranceEntries.tsx`

**Intent**: Orchestrator. Same pattern as `OilChangeEntries` for `InsuranceEntry` and `/api/entries/insurance`.

**Contract**: Props `{ initialEntries: InsuranceEntry[]; carId: string }`. Same pattern.

#### 10. EntriesTabs

**File**: `src/components/entries/EntriesTabs.tsx`

**Intent**: Top-level island. Owns the active tab and renders the correct per-type orchestrator. Receives server-pre-fetched initial entries for all four types.

**Contract**:
- Props:
  ```ts
  {
    initialRepairEntries: RepairEntry[];
    initialOilChangeEntries: OilChangeEntry[];
    initialInspectionEntries: InspectionEntry[];
    initialInsuranceEntries: InsuranceEntry[];
    carId: string;
  }
  ```
- State: `activeTab: "repairs" | "oil_change" | "inspection" | "insurance"`, default `"repairs"`.
- Tab bar: four buttons labeled "Repairs", "Oil Changes", "Inspections", "Insurance". Active tab has a visible active style (e.g. `border-b-2 border-purple-400 text-white`); inactive tabs are `text-white/60 hover:text-white`.
- Body: conditional render — only the active orchestrator mounts:
  - `"repairs"` → `<RepairEntries initialEntries={initialRepairEntries} carId={carId} />`
  - `"oil_change"` → `<OilChangeEntries initialEntries={initialOilChangeEntries} carId={carId} />`
  - `"inspection"` → `<InspectionEntries initialEntries={initialInspectionEntries} carId={carId} />`
  - `"insurance"` → `<InsuranceEntries initialEntries={initialInsuranceEntries} carId={carId} />`

### Success Criteria

#### Automated Verification

- `npm run lint` passes
- `npm run build` passes with no TypeScript errors in new files

#### Manual Verification

- Components render without console errors when mounted
- Tab switching works (verified in Phase 3 once the page is wired up)

**Implementation Note**: After automated checks pass, confirm before proceeding to Phase 3.

---

## Phase 3: Astro Page Update

### Overview

Update `entries.astro` to server-fetch all four entry types in parallel, mount `EntriesTabs` instead of `RepairEntries`, and update the heading to drop the "Repair Entries" suffix.

### Changes Required

#### 1. Update entries page

**File**: `src/pages/entries.astro`

**Intent**: Expand the server-side pre-fetch from 1 entry type to 4, replace the `RepairEntries` island with `EntriesTabs`, and update the page heading.

**Contract**:
- Import `getOilChangeEntries`, `getInspectionEntries`, `getInsuranceEntries` from `@/lib/services/entries`.
- Import `EntriesTabs` from `@/components/entries/EntriesTabs`.
- Replace the `Promise.all` to fetch all 5 items concurrently:
  ```
  [car, initialRepairEntries, initialOilChangeEntries, initialInspectionEntries, initialInsuranceEntries]
  ```
- All four entry fetches receive `(supabase, selectedCarId, user.id)` — same ownership arguments as `getRepairEntries`.
- Replace `<RepairEntries initialEntries={initialEntries} carId={selectedCarId} client:load />` with `<EntriesTabs initialRepairEntries={initialRepairEntries} initialOilChangeEntries={initialOilChangeEntries} initialInspectionEntries={initialInspectionEntries} initialInsuranceEntries={initialInsuranceEntries} carId={selectedCarId} client:load />`.
- Update the `<Layout title>` to `{car.brand} {car.model} — Entries"` and the `<h1>` text to `{car.brand} {car.model}` (remove "— Repair Entries").
- Update the `<p>` subheading to `"Service history"` (remove "Repair entries").

### Success Criteria

#### Automated Verification

- `npm run build` passes with no type errors

#### Manual Verification (wrangler dev)

- `/entries` with selected car loads; page heading shows car name with "Service history" subtitle
- All four tabs render; tab bar is visible
- Clicking each tab shows the correct add-form and empty-state (or entries list if data exists)
- Repairs tab: submitting an entry prepends it to the list and clears the form
- Oil Changes tab: submitting an oil change entry with oil details works; oil_details shows in the list
- Inspections tab: Pass/Fail select is present; submitting a "Passed" inspection with a next due date shows both in the list
- Insurance tab: submitting with only `renewal_date` (insurer blank) works; submitting without `renewal_date` shows validation error
- All four tabs' entries persist on page reload (server-fetched initial state)
- Switching tabs does not lose entries added in other tabs

**Implementation Note**: This is the definition-of-done for S-04. Do not mark complete until all tab and form interactions are verified in wrangler dev.

---

## Testing Strategy

### Manual Testing Steps

1. Start local Supabase: `npx supabase start`
2. Start dev server: `npm run dev`
3. Sign in and select a car
4. Navigate to `/entries` — confirm 4 tabs visible, Repairs active by default
5. Add a repair entry — confirm it appears; switch to Oil Changes tab
6. Add an oil change entry with oil details — confirm it appears with details shown
7. Switch to Inspections tab — add an entry with result "Passed" and a next due date; confirm both show
8. Switch to Insurance tab — try submitting without renewal_date (expect validation error); then submit with renewal_date; confirm entry appears
9. Reload the page — confirm all previously added entries for each tab are still present
10. Confirm GET `/api/entries/oil-change?car_id=<uuid>` returns the oil change entry; same for inspection and insurance

## Migration Notes

None — all four tables are already live from F-02. This plan is purely additive (service functions, API routes, UI components).

## References

- Roadmap S-04: `context/foundation/roadmap.md`
- PRD FR-005, FR-006, FR-007: `context/foundation/prd.md`
- Schema plan (F-02): `context/changes/entries-schema/plan.md`
- S-03 pattern: `context/changes/repair-entry-logging/plan.md`
- Service pattern: `src/lib/services/entries.ts`
- API route pattern: `src/pages/api/entries/repair.ts`
- Form pattern: `src/components/entries/RepairEntryForm.tsx`
- Orchestrator pattern: `src/components/entries/RepairEntries.tsx`
- Page pattern: `src/pages/entries.astro`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Service + API Routes

#### Automated

- [x] 1.1 `npm run lint` passes with no new errors — b2bc6b9
- [x] 1.2 `npm run build` passes with no TypeScript errors — b2bc6b9

#### Manual

- [x] 1.3 GET /api/entries/oil-change?car_id=<uuid> returns `{ entries: [] }` for a car with no entries — b2bc6b9
- [x] 1.4 GET /api/entries/inspection?car_id=<uuid> returns `{ entries: [] }` — b2bc6b9
- [x] 1.5 GET /api/entries/insurance?car_id=<uuid> returns `{ entries: [] }` — b2bc6b9
- [x] 1.6 POST /api/entries/oil-change returns `{ entry }` 201 — b2bc6b9
- [x] 1.7 POST /api/entries/inspection returns `{ entry }` 201 — b2bc6b9
- [x] 1.8 POST /api/entries/insurance returns `{ entry }` 201 — b2bc6b9
- [x] 1.9 POST /api/entries/insurance without renewal_date returns 400 — b2bc6b9
- [x] 1.10 POST /api/entries/inspection with result "Unknown" returns 400 — b2bc6b9
- [x] 1.11 Unauthenticated requests return 401; wrong car_id returns 403 — b2bc6b9

### Phase 2: React Components

#### Automated

- [x] 2.1 `npm run lint` passes — 60e7925
- [x] 2.2 `npm run build` passes with no TypeScript errors in new files — 60e7925

#### Manual

- [ ] 2.3 Components render without console errors (verified in Phase 3)

### Phase 3: Astro Page Update

#### Automated

- [x] 3.1 `npm run build` passes with no type errors — d027739

#### Manual

- [x] 3.2 `/entries` loads with 4 tabs; Repairs tab is active by default — d027739
- [x] 3.3 Heading shows car name with "Service history" subtitle — d027739
- [x] 3.4 Oil Changes: add form works; entry appears with oil_details — d027739
- [x] 3.5 Inspections: Pass/Fail select present; entry appears with result and next due date — d027739
- [x] 3.6 Insurance: validation blocks submit without renewal_date; valid submit works — d027739
- [x] 3.7 All 4 tab histories persist on page reload — d027739
