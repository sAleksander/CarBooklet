<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Entries Schema

- **Plan**: context/changes/entries-schema/plan.md
- **Scope**: Phases 1–2 of 2 (full plan)
- **Date**: 2026-05-28
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical 2 warnings 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | WARNING |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — entry_type discriminant absent from DB schema

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/types.ts:45
- **Detail**: The TypeScript Entry union uses entry_type as its discriminant, but none of the four DB tables have an entry_type column. A raw Supabase SELECT \* returns rows where entry_type is undefined at runtime, silently breaking any switch(entry.entry_type) or if(entry.entry_type === 'repair') guard. This class of bug will appear in every S-03/S-04 service function unless the convention is established now.
- **Fix A ⭐ Recommended**: Inject the literal at the return site of each service function: `return { ...res.data, entry_type: 'repair' as const }`.
  - Strength: Zero schema change; each service function knows which table it queried; mirrors the established cars.ts service pattern.
  - Tradeoff: Convention must be followed by every S-03/S-04 implementer — not enforced by the DB.
  - Confidence: HIGH — separate-table patterns universally use this approach.
  - Blind spot: None significant — S-03/S-04 haven't been written yet so no code to retrofit.
- **Fix B**: Add `entry_type TEXT NOT NULL DEFAULT 'repair'` (etc.) column to each table in a new migration.
  - Strength: Enforced at DB level; no service-layer convention needed.
  - Tradeoff: Redundant column (table name IS the type); requires a new migration for 4 columns.
  - Confidence: MED — correct but adds denormalized column that can drift.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — convention comment added above Entry union in src/types.ts:69

### F2 — No CHECK constraint on mileage column

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260528000000_entries_schema.sql
- **Detail**: All four tables have `mileage INTEGER` with no CHECK constraint. Negative mileage values are valid to the DB. A bad API call can persist nonsense odometer readings that the AI will then reason about.
- **Fix**: Add a follow-up migration with `ALTER TABLE <table> ADD CONSTRAINT <table>_mileage_positive CHECK (mileage > 0)` for all four tables.
- **Decision**: FIXED — created supabase/migrations/20260528000001_entries_mileage_check.sql

### F3 — insurer nullable while renewal_date is NOT NULL

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260528000000_entries_schema.sql:121
- **Detail**: insurance_entries requires renewal_date NOT NULL but allows insurer TEXT nullable. A valid insurance entry can be logged with no insurer name — practically unidentifiable in a list view. Product call.
- **Fix**: If insurer should always be known at entry time, ALTER TABLE in a follow-up migration.
- **Decision**: FIXED — created supabase/migrations/20260528000002_insurance_insurer_not_null.sql

### F4 — inspection result column nullable (product call)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260528000000_entries_schema.sql:84
- **Detail**: inspection_entries.result is nullable. A completed inspection logically has an outcome; nullable allows logging an inspection with no result.
- **Fix**: If result is always known at log time, ALTER TABLE inspection_entries ALTER COLUMN result SET NOT NULL in a follow-up migration.
- **Decision**: FIXED — created supabase/migrations/20260528000003_inspection_result_not_null.sql
