# Cars Schema Implementation Plan

## Overview

Create the `cars` PostgreSQL table in Supabase with all vehicle-identifying fields (brand, model, production year, registration number, engine details, VIN), a `engine_type` PostgreSQL enum, row-level security policies restricting each user to their own rows, and a matching TypeScript type in `src/types.ts`. This is foundation F-01 — it unlocks S-01 (car management UI), S-02 (AI car chat, the north star), and F-02 (entries table FK dependency).

## Current State Analysis

No application-level schema exists. The `supabase/migrations/` directory has not been created — only `supabase/config.toml` is present. Only Supabase Auth's `auth.users` table is in the database. `src/types.ts` does not exist. The Supabase SSR client in `src/lib/supabase.ts` is wired and ready.

## Desired End State

- `supabase/migrations/20260527000000_cars_schema.sql` exists and applies cleanly via `npx supabase db push`
- `public.cars` table is present with 13 columns and all constraints
- `engine_type` PostgreSQL enum (`electric`, `gas`, `diesel`, `lpg`) is defined in the `public` schema
- RLS is enabled; four per-operation policies enforce user isolation (`user_id = auth.uid()`)
- `updated_at` auto-updates via trigger on every row modification
- `Car` and `EngineType` TypeScript types in `src/types.ts` match the migration schema exactly

### Key Discoveries:

- `supabase/migrations/` does not exist — the migration file will implicitly create it (`supabase/migrations/20260527000000_cars_schema.sql`)
- CLAUDE.md convention: `YYYYMMDDHHmmss_short_description.sql`, RLS on every new table with per-operation per-role policies — this plan follows that exactly
- `user_id` FK references `auth.users(id)` with `ON DELETE CASCADE` — deleting a user removes their cars cleanly with no orphan rows
- `src/types.ts` does not exist yet — Phase 2 creates it from scratch
- The `set_updated_at()` trigger function is defined in `public` schema so F-02 and future tables can reuse it

## What We're NOT Doing

- No UI, no API routes — those belong to S-01 (car-management)
- No seed data or test fixtures
- No lookup tables or dropdown constraints for brand/model — free text as resolved in roadmap F-01 risk note
- No database-level validation for `engine_capacity` or `engine_power` format — frontend validates in S-01
- No car sharing, co-ownership, or multi-user access (PRD Non-Goal)
- No VIN checksum validation at the database level

## Implementation Approach

A single SQL migration file defines the complete schema in dependency order: enum → table → RLS enable → four policies → trigger function → trigger. TypeScript types are added immediately after in `src/types.ts` so downstream slices can import a typed `Car` entity without coupling to Supabase-generated types.

## Critical Implementation Details

The `set_updated_at()` trigger function must be created before the trigger that references it. The migration already ensures this ordering. F-02's migration will reuse `set_updated_at()` — do not rename or replace it.

## Phase 1: Database Migration

### Overview

Create `supabase/migrations/20260527000000_cars_schema.sql` with the complete `cars` schema. Apply to local Supabase to confirm it executes cleanly.

### Changes Required:

#### 1. Migration file

**File**: `supabase/migrations/20260527000000_cars_schema.sql`

**Intent**: Define the `engine_type` enum, the `cars` table with all columns and FK constraint, enable RLS, create four per-operation policies, and install the `updated_at` auto-update trigger. This file is the authoritative schema contract that all downstream slices (S-01, S-02, F-02) depend on.

**Contract**: Migration executes in dependency order. The schema all downstream code must treat as stable:

```sql
CREATE TYPE public.engine_type AS ENUM ('electric', 'gas', 'diesel', 'lpg');

CREATE TABLE public.cars (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand               TEXT        NOT NULL,
  model               TEXT        NOT NULL,
  production_year     TEXT        NOT NULL,
  registration_number TEXT,
  engine_type         public.engine_type NOT NULL,
  engine_capacity     TEXT        NOT NULL,
  engine_power        TEXT        NOT NULL,
  engine_code         TEXT,
  vin_number          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.cars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own cars"
  ON public.cars FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own cars"
  ON public.cars FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own cars"
  ON public.cars FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own cars"
  ON public.cars FOR DELETE
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cars_updated_at
  BEFORE UPDATE ON public.cars
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db push` exits 0 with no errors
- Build still passes: `npm run build` exits 0 (schema addition must not break anything)

#### Manual Verification:

- Supabase Studio (http://localhost:54323) → Table Editor shows `public.cars` with 13 columns
- Studio → Authentication → Policies shows 4 policies on `cars` table
- Studio SQL editor: `SELECT * FROM public.cars;` returns empty result set (no error)
- Studio SQL editor: INSERT without `auth.uid()` context is rejected by RLS (expected error: "new row violates row-level security policy")

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation that the Studio checks pass before proceeding to Phase 2.

---

## Phase 2: TypeScript Type Definition

### Overview

Create `src/types.ts` with the `Car` interface and `EngineType` union type matching the migration schema. All downstream slices (S-01, S-02, F-02) import from here.

### Changes Required:

#### 1. Car type

**File**: `src/types.ts` (new file — does not exist yet)

**Intent**: Export a `Car` interface mirroring the `public.cars` table and an `EngineType` union type matching the PostgreSQL enum, so the rest of the codebase has a single source of truth for the car entity shape.

**Contract**: Export two named types — `EngineType` (the literal union, usable standalone by form inputs) and `Car` (the full row interface with all 13 fields). Nullable columns (`registration_number`, `engine_code`, `vin_number`) are typed as `string | null`. Timestamps are `string` (ISO 8601, as Supabase returns them).

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint` exits 0 (ESLint with type-checked rules, no TypeScript errors)

#### Manual Verification:

- `import type { Car, EngineType } from '@/types'` resolves without error in any `src/` file

**Implementation Note**: After lint passes and the import resolves cleanly, this change is complete and S-01 (car-management) can begin.

---

## Testing Strategy

### Manual Testing Steps:

1. Ensure local Supabase is running: `npx supabase start`
2. Apply the migration: `npx supabase db push`
3. Open Studio at http://localhost:54323 → Table Editor → confirm `cars` exists with 13 columns
4. Open Studio → Authentication → Policies → confirm 4 policies on `cars`
5. In Studio SQL editor, run: `INSERT INTO public.cars (brand, model, production_year, engine_type, engine_capacity, engine_power, user_id) VALUES ('Renault', 'Clio II', '2001', 'gas', '1.2L', '75hp', gen_random_uuid());` — confirm RLS rejects it
6. Run `npm run lint` — confirm no TypeScript errors on the new types file

## Migration Notes

This is the first application-level migration. The `supabase/migrations/` directory will be created automatically when the file is added. F-02 (entries schema) will add a FK column referencing `public.cars(id)` — the table name and `id` column name established here are the FK contract.

## References

- Roadmap F-01: `context/foundation/roadmap.md` — `#f-01-cars-data-schema`
- PRD FR-002, FR-009: `context/foundation/prd.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Database Migration

#### Automated

- [x] 1.1 Migration applies cleanly: `npx supabase db push` exits 0 — b7df5ef
- [x] 1.2 Build still passes: `npm run build` exits 0 — b7df5ef

#### Manual

- [x] 1.3 Studio shows `public.cars` with 13 columns — b7df5ef
- [x] 1.4 Studio shows 4 RLS policies on `cars` — b7df5ef
- [x] 1.5 `SELECT * FROM public.cars` returns empty set without error — b7df5ef
- [x] 1.6 INSERT without auth context is rejected by RLS — b7df5ef

### Phase 2: TypeScript Type Definition

#### Automated

- [x] 2.1 Lint passes: `npm run lint` exits 0

#### Manual

- [x] 2.2 `import type { Car, EngineType } from '@/types'` resolves without error
