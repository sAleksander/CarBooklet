<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Additional Entry Types

- **Plan**: `context/changes/additional-entry-types/plan.md`
- **Scope**: All phases (1–3)
- **Date**: 2026-06-02
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical 2 warnings 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — InspectionEntry.result typed as string, not narrowed to the enum

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/types.ts:58
- **Detail**: `InspectionEntry.result` is `string | null` but the API schema constrains it to `z.enum(["Passed", "Failed"])`. `InspectionEntryForm` already redeclares its own local `"Passed" | "Failed" | null` state — the shared type should match. `InspectionEntryFormData.result` has the same mismatch.
- **Fix**: Change `InspectionEntry.result` and `InspectionEntryFormData.result` in `src/types.ts` to `"Passed" | "Failed" | null`.
- **Decision**: FIXED — fa75376

### F2 — InsuranceEntry.insurer typed as non-nullable but API sends null

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/types.ts:64
- **Detail**: `InsuranceEntry.insurer` is `string` (non-nullable) in `types.ts`, but the API schema uses `.nullish()` and the form sends `null` when left blank. TypeScript won't warn on null-unsafe usage. `InsuranceEntryFormData.insurer` has the same mismatch.
- **Fix**: Change `InsuranceEntry.insurer` and `InsuranceEntryFormData.insurer` in `src/types.ts` to `string | null`.
- **Decision**: FIXED — fa75376

### F3 — OilChangeEntryForm omits fieldErrors (minor pattern divergence)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/entries/OilChangeEntryForm.tsx
- **Detail**: Oil change and inspection forms omit `fieldErrors` and `validate()` because they have no required fields. Intentional but diverges from the forms that do have required fields.
- **Fix**: Accept as-is — intentional omission; no correctness impact.
- **Decision**: SKIPPED

### F4 — entries.astro fetches all 4 entry lists before the ownership check

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/entries.astro:26–37
- **Detail**: The 5-way `Promise.all` runs before `if (car?.user_id !== user.id)`. An invalid car_id causes 4 wasteful DB queries. No data leak (service layer filters by user_id). Matches pre-existing pattern.
- **Fix**: Accept as-is — no security risk; matches established pattern.
- **Decision**: SKIPPED

### F5 — InsuranceEntryList renders renewal_date without invalid-date guard

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/entries/InsuranceEntryList.tsx:33
- **Detail**: `new Date(entry.renewal_date).toLocaleDateString()` would render "Invalid Date" if a malformed string arrives. Field is API-validated; consistent with all other list components.
- **Fix**: Accept as-is — consistent with existing pattern; field is API-validated.
- **Decision**: SKIPPED
