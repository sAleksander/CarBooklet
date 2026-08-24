# Cars Schema — Plan Brief

> Full plan: `context/changes/cars-schema/plan.md`

## What & Why

Create the `cars` table in Supabase — the first application-level schema in a project that currently has no database tables beyond Supabase Auth's `auth.users`. This is foundation F-01: without it, no car management UI (S-01), no AI chat (S-02, the north star), and no entries table (F-02) can be built.

## Starting Point

The repo has `supabase/config.toml` and an SSR Supabase client (`src/lib/supabase.ts`) but no migrations directory, no application tables, and no `src/types.ts`. The auth layer is complete; the data layer is blank.

## Desired End State

`public.cars` is live in the local Supabase instance with 13 columns, a `engine_type` PostgreSQL enum, and four per-operation RLS policies ensuring strict user isolation. A `Car` TypeScript type and `EngineType` union in `src/types.ts` give downstream slices a typed entity to import.

## Key Decisions Made

| Decision                               | Choice                                                                        | Why (1 sentence)                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| "Other identifying data" (FR-002)      | 9 columns: brand, model, year, reg. no., engine type/capacity/power/code, VIN | User specified these fields explicitly; all are load-bearing for S-01 UI and S-02 AI context |
| Year field type                        | TEXT                                                                          | Roadmap F-01 risk note resolved: free-text strings for make, model, year in v1               |
| engine_type storage                    | PostgreSQL enum (`electric`, `gas`, `diesel`, `lpg`)                          | Database enforces valid values; AI prompt gets a clean identifier                            |
| engine_capacity / engine_power storage | TEXT ("1.2L", "75hp")                                                         | No numeric queries exist in any v1 roadmap slice; frontend validates format in S-01          |
| Timestamps                             | created_at + updated_at (trigger)                                             | Enables sort-by-recently-modified in S-01; standard pattern for F-02 reuse                   |
| TypeScript types                       | Included in this change                                                       | Single source of truth for `Car` shape available to all downstream slices from day one       |
| Delete behaviour                       | ON DELETE CASCADE (user → cars)                                               | User deletion cleans up all rows; no orphan data                                             |

## Scope

**In scope:**

- `supabase/migrations/20260527000000_cars_schema.sql` — enum, table, RLS, trigger
- `src/types.ts` — `Car` interface, `EngineType` union

**Out of scope:**

- UI or API routes (S-01)
- Seed data or test fixtures
- Database-level validation of `engine_capacity` / `engine_power` format (frontend, S-01)
- VIN checksum validation
- Car sharing or multi-user access (PRD Non-Goal)

## Architecture / Approach

Single SQL migration file in dependency order (enum → table → RLS → policies → trigger function → trigger). The `set_updated_at()` function is created in the `public` schema so F-02 and future tables can reuse it without duplication. TypeScript types are a thin mirror of the schema — no Supabase-generated types required.

## Phases at a Glance

| Phase                         | What it delivers                                                | Key risk                                                                          |
| ----------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1. Database Migration         | `cars` table live in local Supabase with enum, RLS, and trigger | Local Supabase must be running (`npx supabase start` requires Docker + ~7 GB RAM) |
| 2. TypeScript Type Definition | `Car` + `EngineType` exported from `src/types.ts`               | File doesn't exist yet — must be created, not edited                              |

**Prerequisites:** Docker running, `npx supabase start` completed, local Supabase accessible at http://localhost:54323  
**Estimated effort:** ~1 session, 2 phases (migration file is the bulk of the work; types are minutes)

## Open Risks & Assumptions

- The `supabase/migrations/` directory does not exist — it will be created when the migration file is added; Supabase CLI handles this automatically
- `engine_capacity` and `engine_power` are mandatory (NOT NULL) — S-01 must provide a UI input for both; leaving them blank is a schema violation
- Adding a new fuel type (e.g. `hybrid`) later requires `ALTER TYPE public.engine_type ADD VALUE '...'` — non-blocking but costs a migration step

## Success Criteria (Summary)

- `npx supabase migration up` exits 0 and the `cars` table appears in Studio with 4 RLS policies
- An unauthenticated INSERT is rejected by RLS
- `npm run lint` exits 0 with `Car` and `EngineType` importable via `@/types`
