<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Cars Schema — Supabase Migration + RLS

- **Plan**: context/changes/cars-schema/plan.md
- **Scope**: Phases 1–2 of 2 (full plan)
- **Date**: 2026-05-28
- **Verdict**: APPROVED
- **Findings**: 0 critical 0 warnings 1 scope discipline 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — CarFormData type added without plan documentation

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/types.ts:19
- **Detail**: The plan explicitly states "Export two named types — EngineType and Car." A third type, CarFormData, was added silently. It's used by S-01 (CarForm.tsx and cars.ts service) and logically belongs in types.ts — but the plan wasn't updated to document it. Since S-01 is already complete and depends on this type, there is no code risk; the gap is documentation.
- **Fix**: No code change needed — S-01 is done and the type is correct. Retrospectively amend the plan (or note in change.md) to acknowledge CarFormData as an out-of-band addition discovered during S-01 implementation.
- **Decision**: FIXED — noted in change.md as out-of-band addition

### F2 — No index on user_id column

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260527000000_cars_schema.sql
- **Detail**: All four RLS policies filter on user_id = auth.uid(). Without an index on user_id, every policy check is a sequential scan. At current scale (a personal car booklet, 5–20 cars per user) this is completely negligible. The plan did not mention indexes — flagging so it isn't forgotten when F-02 (entries table) adds its FK reference and row counts grow.
- **Fix**: Add `CREATE INDEX cars_user_id_idx ON public.cars(user_id)` in a follow-up migration (e.g., alongside F-02) rather than patching this migration.
- **Decision**: SKIPPED — negligible at current scale; revisit alongside F-02
