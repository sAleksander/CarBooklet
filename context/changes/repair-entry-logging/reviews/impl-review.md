<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Repair Entry Logging

- **Plan**: context/changes/repair-entry-logging/plan.md
- **Scope**: All Phases (1–3 of 3)
- **Date**: 2026-06-01
- **Verdict**: REJECTED
- **Findings**: 2 critical · 2 warnings · 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — GET endpoint exposes other users' entries

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/entries/repair.ts:34-44 + src/lib/services/entries.ts:4
- **Detail**: GET /api/entries/repair?car_id=<uuid> returns all entries for any valid car UUID — no ownership check. Any authenticated user who guesses or learns another user's car_id (a non-secret UUID) can read their repair history. The service queries only by car_id, not by user_id, and relies entirely on RLS for isolation.
- **Fix**: Add `.eq("user_id", userId)` to the SELECT in getRepairEntries. Update signature to `getRepairEntries(supabase, carId, userId)` and pass `context.locals.user.id` from the GET handler.
- **Decision**: FIXED

### F2 — POST allows inserting entries on another user's car

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/entries/repair.ts:71
- **Detail**: POST accepts any car_id UUID in the request body without verifying that the authenticated user owns that car. The insert passes user_id correctly (entry is attributed to the caller), but it is attached to a car the caller may not own — violating data isolation per the PRD Access Control section. Note: RLS on repair_entries enforces user_id = auth.uid() for INSERT, which would also block cross-user car_id since the user_id wouldn't match. However, relying on RLS alone is fragile — the application layer should enforce it.
- **Fix**: Before calling createRepairEntry, call `getCarById(supabase, car_id)` and verify `car?.user_id === context.locals.user.id`. Return 403 if the check fails. (getCarById is already used in entries.astro — import it in the API route too.)
- **Decision**: FIXED

### F3 — Sequential Supabase calls in entries.astro

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/entries.astro:16,22
- **Detail**: getCarById and getRepairEntries are awaited sequentially. They are independent reads — each adds latency to the server-side render time, doubling DB round-trip cost on every page load.
- **Fix**: Parallelise with `const [car, initialEntries] = await Promise.all([getCarById(supabase, selectedCarId), getRepairEntries(supabase, selectedCarId, user.id)])`. (userId available from Astro.locals.user after F1/F2 fixes.)
- **Decision**: FIXED

### F4 — types.ts contains stub types for three unimplemented entry kinds

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/types.ts
- **Detail**: OilChangeEntry, InspectionEntry, InsuranceEntry (and their FormData variants) are declared in types.ts but have no corresponding service, API route, or UI. These belong to S-04 which is explicitly out of scope for this change. However, these types were placed by F-02 (entries-schema), not by S-03 — no code in S-03 added them. This finding is informational.
- **Fix**: No action required. These types were placed by F-02. Dismiss at triage.
- **Decision**: SKIPPED — types placed by F-02, not S-03; no action needed

### F5 — getRepairEntries signature inconsistency with cars.ts

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/entries.ts
- **Detail**: createRepairEntry(supabase, userId, carId, data) passes userId as a separate positional arg. The sibling cars.ts uses createCar(supabase, data: CarFormData & { user_id }) — userId embedded in data. Minor inconsistency; will be naturally resolved when F1 fix adds userId to getRepairEntries.
- **Fix**: Acceptable as-is. Align in a future service-layer cleanup.
- **Decision**: SKIPPED

### F6 — cause: "" initial state with "" → null coercion on submit

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/entries/RepairEntryForm.tsx:17-19, :52
- **Detail**: cause initialises as "" in form state, then converts "" to null before sending. This is correct and intentional but the intent is non-obvious from the types alone.
- **Fix**: No change needed — the coercion is correct and explicit.
- **Decision**: SKIPPED

### F7 — RepairEntries adds section headings not in plan

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/entries/RepairEntries.tsx
- **Detail**: "Log a repair" and "History" h2 headings added for visual grouping — not in the plan's component contract. Purely presentational, no behavioral impact.
- **Fix**: No change needed.
- **Decision**: SKIPPED
