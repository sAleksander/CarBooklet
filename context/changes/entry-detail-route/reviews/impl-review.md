<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Entry Detail Route

- **Plan**: context/changes/entry-detail-route/plan.md
- **Scope**: All 3 phases
- **Date**: 2026-06-10
- **Verdict**: NEEDS ATTENTION
- **Findings**: 1 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Soft 404 leaves entry data in scope; null case handled implicitly

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality / Plan Adherence
- **Location**: src/pages/entries/[id].astro:28-29
- **Detail**: Two related issues. (1) `Astro.response.status = 404` does not stop execution — `entry` (potentially real data from the wrong car) stays in scope for the full frontmatter and template. Template ternary currently prevents rendering it, but the pattern is fragile. (2) The null-entry case is handled implicitly: `entry?.car_id !== selectedCarId` evaluates to `undefined !== selectedCarId` when entry is null. Works via JS coercion but is non-obvious. Not-found message only describes the wrong-car case.
- **Fix A ⭐ Recommended**: Restructure frontmatter into explicit two-branch guard: check `!entry || entry.car_id !== selectedCarId` immediately after fetch, set status 404, early-return to render the not-found panel, null entry out of scope entirely. Removes template ternary.
  - Strength: Matches plan intent; entry out of scope for happy-path; in-app panel preserved.
  - Tradeoff: Splits frontmatter into two render paths.
  - Confidence: HIGH — mirrors entries.astro:32-34 pattern.
  - Blind spot: None significant.
- **Fix B**: Change line 28 to `if (!entry || entry.car_id !== selectedCarId)` and update not-found copy to "doesn't exist or belongs to a different car." Minimal diff; doesn't resolve data-in-scope root issue.
  - Confidence: MED.
- **Decision**: FIXED via Fix A — restructured `[id].astro` to use `rawEntry`/`entry` split; entry is only assigned in the valid path, keeping wrong-car data out of template scope.

### F2 — Guard structure deviates from entries.astro pattern

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/entries/[id].astro:11-19
- **Detail**: `!supabase` and `!user` are split across two guards instead of one. Second guard redirects to `/cars` without `?error=` param (inconsistent with rest of file). Secondary car ownership assertion (`car.user_id !== user.id`) present in entries.astro:32-34 is missing.
- **Fix**: Consolidate into `if (!id || !selectedCarId || !supabase || !user)`. Add car ownership assertion after `getCarById`.
- **Decision**: FIXED — consolidated guard; car ownership assertion added.

### F3 — 4 parallel queries on every detail-page load

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (Performance)
- **Location**: src/lib/services/entries.ts:133-150
- **Detail**: `getEntryById` always fires 4 queries; 3 always return nothing. Negligible at current scale; plan knowingly chose this over `/entries/[type]/[id]`. Forward-looking concern as entry history grows.
- **Fix A ⭐ Recommended**: Add a one-line comment `// Queries all 4 tables in parallel — type not in URL.` to document the deliberate trade-off.
  - Confidence: HIGH — plan explicitly accepted this.
- **Fix B**: Restructure URL to `/entries/[type]/[id]` — single targeted query. Changes URL contract, deviates from PRD spec. Confidence: LOW.
- **Decision**: FIXED via Fix B — route restructured to `/entries/[type]/[id]`; `getEntryById` now accepts `entryType` and queries a single table; all 4 list component hrefs updated; old `[id].astro` removed.

### F4 — conducted_at is semantically wrong as headline date for insurance

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/entries/EntryDetail.astro:23, src/components/entries/InsuranceEntryList.tsx:21
- **Detail**: "Date" common field shows `conducted_at` for all entry types. For insurance, the meaningful date is `policy_start_date` or `renewal_date`. The type-specific section shows those fields anyway, so the date appears twice for insurance with different semantics.
- **Fix**: In EntryDetail.astro and InsuranceEntryList, show `policy_start_date ?? renewal_date` with label "Policy start" for insurance entries.
- **Decision**: PENDING

### F5 — getEntryById breaks the get/create/update/delete grouping

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/entries.ts:133
- **Detail**: Function was inserted before `createInsuranceEntry`, separating it from its three sibling create-functions. All gets should be grouped together above creates.
- **Fix**: Move `getEntryById` to immediately after `getInsuranceEntries` (line 131), before `createInsuranceEntry`.
- **Decision**: PENDING
