# Entries Schema Implementation Plan

## Overview

Create four separate PostgreSQL entry tables in Supabase — `repair_entries`, `oil_change_entries`, `inspection_entries`, `insurance_entries` — each with RLS, an `updated_at` trigger, and matching TypeScript interfaces in `src/types.ts`. This is foundation F-02 — it unlocks S-03 (repair entry logging), S-04 (additional entry types), and S-05 (entry management).

## Current State Analysis

F-01 (cars-schema) is complete: `public.cars` table and `public.set_updated_at()` trigger function both exist. No entry tables or TypeScript entry types are present. `src/types.ts` already exports `Car`, `CarFormData`, and `EngineType`.

## Desired End State

- `supabase/migrations/20260528000000_entries_schema.sql` applies cleanly via `npx supabase migration up`
- Four entry tables present in `public` schema, each with 9–11 columns
- 16 RLS policies total (4 per-operation policies × 4 tables), all enforcing `user_id = auth.uid()`
- `updated_at` auto-update trigger on all four tables (reusing `public.set_updated_at()`)
- `src/types.ts` exports `EntryType`, `BaseEntry`, `RepairEntry`, `OilChangeEntry`, `InspectionEntry`, `InsuranceEntry`, `Entry` (union), and four `*EntryFormData` interfaces
- `npm run lint` exits 0 with the new types in place

### Key Discoveries

- `public.set_updated_at()` already exists from F-01 — do NOT recreate it; just create new triggers referencing it
- `src/types.ts` exists — append entry types after the existing `Car`/`CarFormData` exports
- Service pattern: `src/lib/services/cars.ts` — downstream entry services (S-03/S-04) will mirror this pattern
- Oil change "next due" is computed at query time from `conducted_at + 1 year` and `mileage + 10 000 km` — no next-date column is needed on `oil_change_entries`

## What We're NOT Doing

- No UI, no API routes, no service files — those belong to S-03, S-04, S-05
- No seed data or test fixtures
- No entry_type enum at the database level (separate tables make a shared enum redundant)
- No `next_change_date` column on `oil_change_entries` — dashboard derives this at query time
- No policy number, coverage details, or document storage on insurance entries (PRD non-goal)
- No shared base table / table inheritance — four independent tables
- No mileage interval configuration — the 10 000 km and 1-year oil change thresholds are dashboard-layer constants, not schema concerns

## Implementation Approach

One SQL migration file creates all four tables in dependency order (each table is independent — no cross-entry-table FKs). Each table follows the same structure: shared base columns, type-specific columns, RLS enable, four per-operation policies, one trigger. TypeScript interfaces share a `BaseEntry` type and are extended per entry type, with a discriminated `Entry` union for callers that handle multiple types.

## Critical Implementation Details

**Trigger reuse**: `set_updated_at()` was created in F-01's migration as a `public` function. This migration calls `CREATE TRIGGER … EXECUTE FUNCTION public.set_updated_at()` four times — do not add a `CREATE OR REPLACE FUNCTION` block.

**Migration filename**: Use the date the migration is actually applied (`YYYYMMDD000000_entries_schema.sql`). If implementing today (2026-05-28), use `20260528000000_entries_schema.sql`. If implementing on a later date, update the prefix accordingly — Supabase applies migrations in lexicographic order and a stale date before a newer migration will cause ordering issues.

---

## Phase 1: Database Migration

### Overview

Create `supabase/migrations/20260528000000_entries_schema.sql` (adjust date prefix as needed) with all four entry tables. Apply to local Supabase to confirm it executes cleanly.

### Changes Required

#### 1. Migration file

**File**: `supabase/migrations/20260528000000_entries_schema.sql`

**Intent**: Define the four entry tables with their type-specific columns, enable RLS on each, create 16 per-operation policies, and install `updated_at` triggers. This file is the authoritative schema contract for all entry-related downstream slices.

**Contract**: Migration executes in this order: table definitions → RLS enables → policies → triggers. All four tables share the same base column set; type-specific columns follow. The complete schema:

```sql
-- ─── repair_entries ───────────────────────────────────────────────────────────

CREATE TABLE public.repair_entries (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id       UUID        NOT NULL REFERENCES public.cars(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conducted_at DATE        NOT NULL,
  mileage      INTEGER,
  description  TEXT        NOT NULL,
  cause        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.repair_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own repair entries"
  ON public.repair_entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own repair entries"
  ON public.repair_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own repair entries"
  ON public.repair_entries FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own repair entries"
  ON public.repair_entries FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER repair_entries_updated_at
  BEFORE UPDATE ON public.repair_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ─── oil_change_entries ───────────────────────────────────────────────────────

CREATE TABLE public.oil_change_entries (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id       UUID        NOT NULL REFERENCES public.cars(id) ON DELETE CASCADE,
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conducted_at DATE        NOT NULL,
  mileage      INTEGER,
  oil_details  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.oil_change_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own oil change entries"
  ON public.oil_change_entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own oil change entries"
  ON public.oil_change_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own oil change entries"
  ON public.oil_change_entries FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own oil change entries"
  ON public.oil_change_entries FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER oil_change_entries_updated_at
  BEFORE UPDATE ON public.oil_change_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ─── inspection_entries ───────────────────────────────────────────────────────

CREATE TABLE public.inspection_entries (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id               UUID        NOT NULL REFERENCES public.cars(id) ON DELETE CASCADE,
  user_id              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conducted_at         DATE        NOT NULL,
  mileage              INTEGER,
  result               TEXT,
  next_inspection_date DATE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.inspection_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own inspection entries"
  ON public.inspection_entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own inspection entries"
  ON public.inspection_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own inspection entries"
  ON public.inspection_entries FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own inspection entries"
  ON public.inspection_entries FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER inspection_entries_updated_at
  BEFORE UPDATE ON public.inspection_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ─── insurance_entries ────────────────────────────────────────────────────────

CREATE TABLE public.insurance_entries (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id             UUID        NOT NULL REFERENCES public.cars(id) ON DELETE CASCADE,
  user_id            UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conducted_at       DATE        NOT NULL,
  mileage            INTEGER,
  insurer            TEXT,
  policy_start_date  DATE,
  renewal_date       DATE        NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.insurance_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own insurance entries"
  ON public.insurance_entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own insurance entries"
  ON public.insurance_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own insurance entries"
  ON public.insurance_entries FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own insurance entries"
  ON public.insurance_entries FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER insurance_entries_updated_at
  BEFORE UPDATE ON public.insurance_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

### Success Criteria

#### Automated Verification

- Migration applies cleanly: `npx supabase migration up` exits 0 with no errors
- Build still passes: `npm run build` exits 0

#### Manual Verification

- Supabase Studio → Table Editor shows all four entry tables, each with the correct columns
- Studio → Authentication → Policies shows 4 policies on each of the four tables (16 total)
- Studio SQL editor: `SELECT * FROM public.repair_entries;` returns empty result set without error (repeat for each table)
- Studio SQL editor: INSERT into any entry table without `auth.uid()` context produces a FK constraint error (23503) — not an RLS error. This is expected; Studio runs as superuser. Authoritative RLS verification is the 4 policies per table visible in Authentication → Policies.

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation that the Studio checks pass before proceeding to Phase 2.

---

## Phase 2: TypeScript Type Definitions

### Overview

Extend `src/types.ts` with entry-related types: a `BaseEntry` interface, four typed entry interfaces, an `Entry` discriminated union, and four form data interfaces. All downstream slices (S-03, S-04, S-05, S-06) import from here.

### Changes Required

#### 1. Entry types

**File**: `src/types.ts` (append after existing `CarFormData` export)

**Intent**: Export a `BaseEntry` interface capturing the shared columns of all four entry tables, four concrete entry interfaces extending it (one per table), an `Entry` union type for callers handling multiple entry types, and four form data interfaces for entry creation/edit forms.

**Contract**: `EntryType` is the literal union of all four table names used as discriminants. `BaseEntry` is not exported as a standalone type for construction — it's a shared structural base only. The `Entry` union uses the `entry_type` discriminant for TypeScript narrowing. Nullable DB columns map to `string | null` (or `number | null` for mileage); `renewal_date` is `string` (not `string | null`) because it is `NOT NULL` in the DB. All date fields are `string` (ISO 8601 `YYYY-MM-DD`, as Supabase returns them).

```typescript
export type EntryType = "repair" | "oil_change" | "inspection" | "insurance";

interface BaseEntry {
  id: string;
  car_id: string;
  user_id: string;
  conducted_at: string;
  mileage: number | null;
  created_at: string;
  updated_at: string;
}

export interface RepairEntry extends BaseEntry {
  entry_type: "repair";
  description: string;
  cause: string | null;
}

export interface OilChangeEntry extends BaseEntry {
  entry_type: "oil_change";
  oil_details: string | null;
}

export interface InspectionEntry extends BaseEntry {
  entry_type: "inspection";
  result: string | null;
  next_inspection_date: string | null;
}

export interface InsuranceEntry extends BaseEntry {
  entry_type: "insurance";
  insurer: string | null;
  policy_start_date: string | null;
  renewal_date: string;
}

export type Entry = RepairEntry | OilChangeEntry | InspectionEntry | InsuranceEntry;

export interface RepairEntryFormData {
  conducted_at: string;
  mileage?: number | null;
  description: string;
  cause?: string | null;
}

export interface OilChangeEntryFormData {
  conducted_at: string;
  mileage?: number | null;
  oil_details?: string | null;
}

export interface InspectionEntryFormData {
  conducted_at: string;
  mileage?: number | null;
  result?: string | null;
  next_inspection_date?: string | null;
}

export interface InsuranceEntryFormData {
  conducted_at: string;
  mileage?: number | null;
  insurer?: string | null;
  policy_start_date?: string | null;
  renewal_date: string;
}
```

### Success Criteria

#### Automated Verification

- Lint passes: `npm run lint` exits 0 (ESLint with type-checked rules, no TypeScript errors)

#### Manual Verification

- `import type { Entry, RepairEntry, OilChangeEntry, InspectionEntry, InsuranceEntry } from '@/types'` resolves without error in any `src/` file

**Implementation Note**: After lint passes and the import resolves cleanly, this change is complete and S-03/S-04 (entry logging) can begin.

---

## Testing Strategy

### Manual Testing Steps

1. Ensure local Supabase is running: `npx supabase start`
2. Apply the migration: `npx supabase migration up`
3. Open Studio at http://localhost:54323 → Table Editor → confirm all four entry tables exist with correct columns
4. Open Studio → Authentication → Policies → confirm 4 policies per table (16 total)
5. In Studio SQL editor, run `SELECT * FROM public.repair_entries;` — expect empty result without error (repeat for each table)
6. Run `npm run lint` — confirm no TypeScript errors on the new types

## Migration Notes

This migration depends on F-01 (`public.cars` table and `public.set_updated_at()` function) being already applied. Do not apply this migration to a database where F-01 has not run — the `REFERENCES public.cars(id)` and `EXECUTE FUNCTION public.set_updated_at()` calls will fail.

S-06 (deadline dashboard) will query `inspection_entries.next_inspection_date` and `insurance_entries.renewal_date` directly — the column names established here are the query contract for that slice.

## References

- Roadmap F-02: `context/foundation/roadmap.md` — `#f-02-entries-data-schema`
- PRD FR-003, FR-005, FR-006, FR-007, FR-008: `context/foundation/prd.md`
- Prerequisite migration: `supabase/migrations/20260527000000_cars_schema.sql`
- TypeScript type base: `src/types.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Database Migration

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase migration up` exits 0
- [x] 1.2 Build still passes: `npm run build` exits 0

#### Manual

- [x] 1.3 Studio shows all four entry tables with correct columns
- [x] 1.4 Studio shows 16 RLS policies (4 per table)
- [x] 1.5 SELECT from each table returns empty set without error

### Phase 2: TypeScript Type Definitions

#### Automated

- [ ] 2.1 Lint passes: `npm run lint` exits 0

#### Manual

- [ ] 2.2 `import type { Entry, RepairEntry, ... }` resolves without error
