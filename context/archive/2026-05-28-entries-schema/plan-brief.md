# Entries Schema — Plan Brief

> Full plan: `context/changes/entries-schema/plan.md`

## What & Why

Create the four PostgreSQL entry tables that power all of CarBooklet's entry-logging features. Without these tables, S-03 (repair logging), S-04 (oil change / inspection / insurance), S-05 (entry management), and the FR-012 dashboard are all blocked. This is a pure foundation slice — no UI, no API routes.

## Starting Point

F-01 (cars-schema) is complete: `public.cars` and `public.set_updated_at()` both exist. No entry tables or TypeScript entry types are present yet.

## Desired End State

Four entry tables are live in Supabase, each with RLS, triggers, and a FK to `public.cars`. `src/types.ts` exports typed interfaces for all four entry types plus a discriminated `Entry` union. S-03 and S-04 can begin immediately after this lands.

## Key Decisions Made

| Decision              | Choice                                                                          | Why (1 sentence)                                                                | Source |
| --------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------ |
| Schema shape          | Separate table per entry type                                                   | Avoids nullable spread and keeps each table's contract clean                    | Plan   |
| RLS approach          | `user_id` directly on each table                                                | Consistent with cars-schema pattern; simpler policy expressions                 | Plan   |
| Oil change "next due" | Computed at query time (conducted_at + 1y, mileage + 10 000 km)                 | No extra column needed; derivable from the entry data that's already stored     | Plan   |
| Shared base columns   | `conducted_at DATE NOT NULL` + optional `mileage INTEGER` on all tables         | User can backdate any entry; mileage enables interval-based oil change tracking | Plan   |
| TypeScript types      | Separate interfaces + `Entry` discriminated union                               | Enables TypeScript narrowing per entry type; maps 1:1 to the four tables        | Plan   |
| Insurance fields      | `policy_start_date` (nullable) + `renewal_date NOT NULL` + `insurer` (nullable) | Covers PRD "policy period" and the dashboard-critical renewal date              | Plan   |

## Scope

**In scope:**

- `repair_entries` table: `conducted_at`, `mileage`, `description NOT NULL`, `cause`
- `oil_change_entries` table: `conducted_at`, `mileage`, `oil_details`
- `inspection_entries` table: `conducted_at`, `mileage`, `result`, `next_inspection_date`
- `insurance_entries` table: `conducted_at`, `mileage`, `insurer`, `policy_start_date`, `renewal_date NOT NULL`
- 16 RLS policies (4 per table), 4 triggers reusing `set_updated_at()`
- TypeScript types: `EntryType`, 4 entry interfaces, `Entry` union, 4 form data interfaces

**Out of scope:**

- No UI, API routes, or service files
- No `entry_type` enum at DB level (separate tables make it redundant)
- No next-change-date column on oil_change_entries
- No policy number or coverage details on insurance entries
- No mileage interval configuration (10 000 km threshold is a dashboard-layer constant)

## Architecture / Approach

One SQL migration file creates all four tables sequentially (they have no mutual dependencies). Each table follows the same structural template: base columns → type-specific columns → `ALTER TABLE … ENABLE ROW LEVEL SECURITY` → 4 policies → trigger. `set_updated_at()` is reused from F-01 — no recreation. TypeScript types are appended to the existing `src/types.ts` after the car exports.

## Phases at a Glance

| Phase                 | What it delivers                                                           | Key risk                                                                                      |
| --------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1. Database Migration | 4 tables, 16 RLS policies, 4 triggers in one SQL file                      | Migration filename must match the actual apply date (prefix must be after F-01's `20260527…`) |
| 2. TypeScript Types   | BaseEntry + 4 entry interfaces + Entry union + 4 form DTOs in src/types.ts | None significant — lint confirms correctness                                                  |

**Prerequisites:** F-01 must be applied (`public.cars` and `public.set_updated_at()` must exist)
**Estimated effort:** ~1 session across 2 phases (mirrors the cars-schema effort)

## Open Risks & Assumptions

- `renewal_date NOT NULL` on insurance entries means the user must supply this date at creation time — the S-04 form must treat it as required
- `next_inspection_date` is nullable — the dashboard must gracefully handle inspections logged without a next-due date
- Oil change interval constants (1 year / 10 000 km) are hardcoded assumptions; a future slice could make them configurable per car

## Success Criteria (Summary)

- `npx supabase migration up` applies the migration without errors
- Supabase Studio shows 4 entry tables and 16 RLS policies
- `npm run lint` passes with no TypeScript errors on the new types
