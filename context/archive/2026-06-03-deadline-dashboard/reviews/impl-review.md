<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Deadline Dashboard

- **Plan**: context/changes/deadline-dashboard/plan.md
- **Scope**: All phases (Phase 1–2)
- **Date**: 2026-06-03
- **Verdict**: NEEDS ATTENTION (fixed during triage)
- **Findings**: 0 critical 2 warnings 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

## Findings

### F1 — Lint errors introduced in Phase 2 files

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria / Pattern Consistency
- **Location**: src/components/DeadlineCard.astro:28,30,31 · src/pages/dashboard.astro:90,106
- **Detail**: Phase 2 only listed `npm run build` as an automated check — lint was not re-run. 3 prettier errors (class ordering, stray `{" "}`, unnecessary parens) and 2 `astro/prefer-class-list-directive` warnings introduced by new files.
- **Fix**: `npm run lint:fix` — all 3 errors auto-fixed; class:list directive also applied.
- **Decision**: FIXED

### F2 — getCarById has no user_id filter — ownership check is caller-only

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/cars.ts:10 (pre-existing; surfaced by new caller)
- **Detail**: `getCarById` queried by id only. Any authenticated user who guesses a valid car UUID receives the Car record. All entry services filter by both car_id AND user_id. Also revealed that `api/cars/[id].ts` PATCH and DELETE had no ownership check at all — they called `getCarById`, found it non-null, and proceeded without verifying the car belonged to the caller.
- **Fix**: Added `userId: string` param + `.eq("user_id", userId)` to `getCarById`. Updated all 11 call sites. Simplified ownership checks in entry API routes to `if (!car)` (ownership now enforced at DB level).
- **Decision**: FIXED via Fix A

### F3 — UTC/local date mixing in computeDeadlineStatus

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/entries.ts:274
- **Detail**: `today` was normalized to local midnight via `setHours(0,0,0,0)` while due-date strings are parsed as UTC midnight by V8. On non-UTC servers the delta can be off by ±1 day at boundaries. Cloudflare Workers always runs UTC so no real risk, but the mixing was inconsistent.
- **Fix**: Changed `setHours(0,0,0,0)` → `setUTCHours(0,0,0,0)`.
- **Decision**: FIXED

### F4 — Silent redirect on deadline fetch failure

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:27-32
- **Detail**: On `getCarDeadlines()` failure the page silently redirected to `/cars` with no user-visible explanation.
- **Fix**: Changed redirect target to `/cars?error=load_failed`.
- **Decision**: FIXED
