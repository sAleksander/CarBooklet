---
date: 2026-06-15T21:36:32+0200
researcher: Aleksander (via Claude Code)
git_commit: f2cd160cc9680710b7fbabb810ea5b7b8ceafa25
branch: main
repository: CarBooklet
topic: "Data isolation (R3/IDOR) + CRUD integrity & server-side validation (R5) — service-layer RLS integration tests against local Supabase"
tags: [research, codebase, rls, idor, supabase, vitest, data-isolation, validation, test-plan-phase-2]
status: complete
last_updated: 2026-06-15
last_updated_by: Aleksander (via Claude Code)
---

# Research: Data isolation (R3) + CRUD integrity / server-side validation (R5)

**Date**: 2026-06-15T21:36:32+0200
**Researcher**: Aleksander (via Claude Code)
**Git Commit**: f2cd160cc9680710b7fbabb810ea5b7b8ceafa25
**Branch**: main
**Repository**: CarBooklet

## Research Question

Rollout Phase 2 of `context/foundation/test-plan.md`: prove cross-user data
isolation (R3 / IDOR) and CRUD integrity + server-side validation (R5) on the
car/entry surface, tested at the **service/client layer** against a **local
Supabase stack with real RLS** (not mocked). Scope confirmed with the user:
cars + all 4 entry types; probe the entry-insert car-ownership gap.

## Summary

The surface is well-structured and mostly defended, but the research surfaced
**one real IDOR write-vector** and a **defense asymmetry** that together define
the highest-signal tests:

1. **Entry-insert car-ownership gap (confirmed, all 4 entry tables).** Every
   entry INSERT RLS policy checks only `WITH CHECK (auth.uid() = user_id)` —
   none verifies the referenced `car_id` belongs to the user. At the RLS layer,
   User B can insert an entry with B's own `user_id` pointing at User A's
   `car_id`. The app **route** masks this (entry POST does a `getCarById(car_id,
user.id)` → 403 pre-check), but the service/RLS layer does not. Since the
   chosen harness is service-layer, a faithful test will show this INSERT
   **succeeds today** — a documented gap the plan must decide to either pin as
   known-behavior or fix by adding a car-ownership `WITH CHECK` subquery.
2. **`updateCar` / `deleteCar` have no `user_id` filter** (`cars.ts:25-34`) —
   the only two app-layer-unguarded mutations. Isolation rests entirely on RLS
   `USING (auth.uid() = user_id)` + the route's `getCarById` 404 pre-check. By
   contrast, **every** entry update/delete filters `.eq("id").eq("user_id")`
   (defense-in-depth). This divergence is the prime R3 regression target.
3. **R3 test-assertion nuance:** cross-user UPDATE/DELETE under RLS `USING`
   return **0 rows affected, silently — no error**. Only INSERT/`WITH CHECK`
   violations raise `42501`. Tests must therefore assert **persisted state /
   row counts**, not "did it throw," for update/delete isolation.
4. **R5 oracle = DB constraints**, all independent of the handlers:
   `mileage > 0` (0 and negatives rejected, NULL allowed; all 4 entry tables),
   `insurer` NOT NULL, `result` NOT NULL, the `engine_type` enum. The
   service-layer harness exercises these directly. **Caveat:** the service layer
   bypasses the route **zod** schemas — the _other_ half of R5 ("zod at the API
   edge"). See Open Questions.
5. **The harness is feasible and cheap.** Local Supabase is already running;
   email confirmation is off; the service fns are import-clean (no
   `astro:env/server`), so they're directly importable in tests. Two real users
   via `admin.createUser` + `signInWithPassword`, each with their own anon
   client carrying their JWT, makes RLS adjudicate correctly. Teardown is a
   single `admin.deleteUser` per user — `ON DELETE CASCADE` removes their cars
   and entries automatically.

## Detailed Findings

### 1. Mutation surface — routes + service-layer ownership matrix

**Route inventory** (two distinct auth styles):

| Route                                                     | Methods                  | Auth                                      |
| --------------------------------------------------------- | ------------------------ | ----------------------------------------- |
| `api/cars/index.ts`                                       | GET, POST                | self-auth `supabase.auth.getUser()` → 401 |
| `api/cars/[id].ts`                                        | PATCH, DELETE            | self-auth `getUser()` → 401               |
| `api/cars/[id]/select.ts`                                 | POST                     | self-auth `getUser()` → 401               |
| `api/entries/{repair,oil-change,inspection,insurance}.ts` | GET, POST, PATCH, DELETE | middleware `locals.user` → 401            |
| `pages/entries/[type]/[id].astro`                         | page render only         | `locals.user`; no mutation                |

There is **no `api/entries/[id]` route** — entry mutations are one file per
`entry_type`, with the entry id in the body (PATCH) or query string (DELETE).
The `cars/*` routes re-derive the user via `getUser()`; the `entries/*` routes
trust middleware `locals.user`. (Irrelevant to a service-layer harness, which
calls services directly — but it matters if any route-level test is added.)

**Service ownership matrix** (the R3 core):

| Fn                  | File:line                    | `.eq()` filters                        | user_id-scoped?                 |
| ------------------- | ---------------------------- | -------------------------------------- | ------------------------------- |
| `getCars`           | `cars.ts:4-8`                | _(none)_                               | **NO — RLS only**               |
| `getCarById`        | `cars.ts:10-17`              | `.eq("id").eq("user_id")`              | YES (PGRST116→null)             |
| `createCar`         | `cars.ts:19-23`              | insert; route injects `user_id`        | RLS `WITH CHECK`                |
| **`updateCar`**     | **`cars.ts:25-29`**          | **`.eq("id")` ONLY**                   | **NO — RLS + route pre-check**  |
| **`deleteCar`**     | **`cars.ts:31-34`**          | **`.eq("id")` ONLY**                   | **NO — RLS + route pre-check**  |
| `get*Entries` (×4)  | `entries.ts:16,47,81,115`    | `.eq("car_id").eq("user_id")`          | YES                             |
| `getEntryById`      | `entries.ts:133-163`         | `.eq("id").eq("user_id")`              | YES                             |
| `create*Entry` (×4) | `entries.ts:31,65,99,165`    | insert `{user_id, car_id, ...}`        | RLS `WITH CHECK` (user_id only) |
| `update*Entry` (×4) | `entries.ts:183,202,221,240` | `.eq("id").eq("user_id")`              | **YES** (defense-in-depth)      |
| `delete*Entry` (×4) | `entries.ts:261-295`         | `.eq("id").eq("user_id").select("id")` | **YES**                         |
| `getCarDeadlines`   | `entries.ts:316-380`         | `.eq("car_id").eq("user_id")`          | YES                             |
| `getLastEntry`      | `entries.ts:382-446`         | `.eq("car_id").eq("user_id")`          | YES                             |

Entry **POST** has a route-layer pre-check: `getCarById(car_id, user.id)` → 403
"Forbidden" (`repair.ts:73-76`, `oil-change.ts:77-80`, `inspection.ts:84-87`,
`insurance.ts:84-87`). Entry **PATCH/DELETE** have no pre-check — they rely on
the service `.eq("user_id")` filter (null/false → 404).

### 2. RLS + DB constraint oracle (R3 & R5)

All 5 tables have RLS enabled with per-operation policies keyed on
`auth.uid() = user_id` (`cars_schema.sql:19-36`; `entries_schema.sql:15-146`).
No policy carries a `TO authenticated` clause, so they default to role `public`;
benign because `auth.uid()` is NULL for anon (anon matches nothing on
read/update/delete, fails `WITH CHECK` on insert).

**R3 isolation oracle** (User B acting on User A's row):

| Op by B on A's row                                  | Expected result                                           |
| --------------------------------------------------- | --------------------------------------------------------- |
| SELECT A's car / entry                              | **empty set** (0 rows; PostgREST 200 `[]`, no error)      |
| UPDATE A's car / entry                              | **0 rows affected, no error** (RLS `USING` hides the row) |
| DELETE A's car / entry                              | **0 rows affected, no error**; row persists               |
| INSERT car/entry with `user_id = A` (impersonation) | **REJECTED** — `42501` RLS violation                      |
| INSERT entry with `user_id = B`, `car_id = A's car` | **ACCEPTED today — IDOR gap**                             |

**R5 validation oracle** (DB constraints, independent of handlers):

| Constraint                                                      | File:line                       | Bad input                | Postgres error                      |
| --------------------------------------------------------------- | ------------------------------- | ------------------------ | ----------------------------------- |
| `*_mileage_positive` `CHECK (mileage > 0)` (all 4 entry tables) | `entries_mileage_check.sql:1-4` | `mileage = 0` or `< 0`   | `23514` check_violation             |
| (same)                                                          |                                 | `mileage = NULL`         | **accepted** (CHECK passes on NULL) |
| `insurer` NOT NULL                                              | `insurance_..._not_null.sql:1`  | `insurer = NULL`/omitted | `23502` not_null                    |
| `result` NOT NULL                                               | `inspection_..._not_null.sql:1` | `result = NULL`/omitted  | `23502` not_null                    |
| `engine_type` enum                                              | `cars_schema.sql:1`             | invalid enum value       | `22P02` invalid enum                |

FK cascade is total: `cars.user_id → auth.users ON DELETE CASCADE`
(`cars_schema.sql:5`); every entry table has both `car_id → cars ON DELETE
CASCADE` and `user_id → auth.users ON DELETE CASCADE` (`entries_schema.sql:5-6`
etc.). Deleting a car cascades to its entries; deleting a user cascades to
everything they own — the test cleanup lever.

### 3. The entry-insert car-ownership gap (highlighted)

Confirmed on all four entry INSERT policies (`entries_schema.sql:21-23, 58-60,
96-98, 135-137`): `WITH CHECK (auth.uid() = user_id)` with **no** `EXISTS`
subquery against `cars`. Severity is mitigated — because every SELECT policy
keys on `user_id`, User A never _sees_ B's planted row, so it does not leak A's
data — but B can write rows pointing at foreign cars (integrity / orphan-style
abuse). The route's entry-POST 403 pre-check is the only thing blocking it
today. **Decision for the plan:** (a) pin current behavior (insert succeeds) and
log the gap as a known defect, or (b) close it by adding a car-ownership
`WITH CHECK` subquery in a migration and assert it now rejects. Either way the
service-layer test makes the gap observable.

### 4. Test-harness design (service/client layer)

**Why it's clean:** `cars.ts`/`entries.ts` import only `@supabase/supabase-js`
(type-only) + `@/types`, and `src/types.ts` is runtime-import-free → importing
the services under test does **not** pull in `astro:env/server`. The `@` alias
is still needed (for `@/types`); the env double is irrelevant to the DB
connection (the test builds its own clients).

**Auth pattern (most deterministic):** service_role `admin.createUser({ email,
password, email_confirm: true })` to create A and B, then a **separate anon
client per user** doing `signInWithPassword` → that client carries the user's
JWT so PostgREST runs queries as `auth.uid() = thatUser`. Pass that client to
the service fns. The service_role `adminClient` **bypasses RLS** — use it only
for create/delete, **never in assertions** (false-pass risk).

**Credentials:** read `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
`SUPABASE_SERVICE_ROLE_KEY` from env with local CLI demo-default fallbacks
(`npx supabase status -o env` emits both legacy JWTs and new
`sb_publishable_`/`sb_secret_` keys; both stable locally). Do **not** reuse the
app's `SUPABASE_KEY`.

**Vitest config:** split into **projects** so the fast unit suite stays
Docker-free and CI-green:

- project `unit`: `include: src/test/**/*.test.ts`, `exclude:
src/test/integration/**`, `passWithNoTests` — Phase 1 unchanged.
- project `integration`: `include: src/test/integration/**/*.test.ts`,
  `globalSetup` (fail clearly if Supabase is down), `testTimeout: 20_000`,
  run **serially** (auth rate limit, see risks).
- scripts: `test` → `--project unit` (existing CI command stays unit-only);
  `test:integration` → `--project integration`; `test:all` → both.

**Isolation/cleanup:** unique emails per run
(`it+<label>-<Date.now()>-<uuid8>@example.test`); create A/B per test; seed via
the authed clients (so RLS validates the seed too); `afterEach`
`admin.deleteUser` both → cascade cleans cars + entries. `persistSession:false`

- `autoRefreshToken:false` on every test client to stop cross-file session
  bleed.

**CI/Docker:** deferred to test-plan §3 Phase 4 (CI gate). Keep `npm test` =
unit project only until then.

### 5. R5 two-layer tension

R5's directive is "zod schemas at the API edge **and** DB constraints as the
independent oracle" (`test-plan.md:86`). The chosen **service-layer** harness
exercises the **DB-constraint** half directly (the independent oracle) but
**bypasses the route zod schemas**. The zod schemas are pure functions
(`cars/index.ts:6-25`, `cars/[id].ts:6-28`, the 4 entry route schemas) and could
be covered by **cheap pure-unit tests** (no DB, mirroring Phase 1's
`buildSystemPrompt` pattern) — high cost×signal. See Open Questions for the
decision.

## Code References

- `src/lib/services/cars.ts:25-34` — `updateCar`/`deleteCar`: `.eq("id")` only, no user_id filter (R3 prime target)
- `src/lib/services/cars.ts:10-17` — `getCarById`: the `.eq("id").eq("user_id")` ownership oracle
- `src/lib/services/cars.ts:4-8` — `getCars`: no user_id filter, pure RLS reliance
- `src/lib/services/entries.ts:183-295` — entry update/delete: all `.eq("id").eq("user_id")` (defense-in-depth)
- `src/pages/api/cars/[id].ts:48-51,91-94` — route ownership pre-check → 404 before mutate
- `src/pages/api/entries/repair.ts:73-76` — entry POST car-ownership pre-check → 403 (masks the RLS gap)
- `supabase/migrations/20260527000000_cars_schema.sql:19-36` — cars RLS policies
- `supabase/migrations/20260528000000_entries_schema.sql:21-23,58-60,96-98,135-137` — entry INSERT policies (the gap: user_id-only)
- `supabase/migrations/20260528000001_entries_mileage_check.sql:1-4` — `CHECK (mileage > 0)` ×4
- `supabase/migrations/20260528000002_insurance_insurer_not_null.sql:1` — `insurer` NOT NULL
- `supabase/migrations/20260528000003_inspection_result_not_null.sql:1` — `result` NOT NULL
- `supabase/config.toml:169,204,209` — signup enabled, email confirmation off
- `src/lib/supabase.ts:1-24` — SSR cookie client (NOT what the harness uses)
- `vitest.config.ts:1-22` — Phase 1 config to convert to projects
- `src/types.ts` — runtime-import-free; safe to import in tests

## Architecture Insights

- **Two-layer defense, unevenly applied.** Car writes lean on RLS + a route
  pre-check (no service user_id filter); entry writes add a third layer (service
  `.eq("user_id")`). The RLS layer is the common floor — which is exactly why
  the test must exercise it directly with a second user, per the R3 anti-pattern
  "trusting RLS without exercising a second user" (`test-plan.md:84`).
- **RLS isolation is silent on writes.** The single most important test-design
  fact: cross-user update/delete do not error — they affect 0 rows. Asserting
  state, not exceptions, is mandatory.
- **The service layer is the cost×signal sweet spot.** Importable without env
  plumbing, talks to real RLS, and the only meaningful thing it skips (route
  zod) is independently unit-testable.

## Historical Context (from prior changes)

- `context/foundation/test-plan.md:51,53` — R3 (High×High) and R5 (Medium×High)
  risk rows; §2 Risk Response: R3 "must challenge: authenticated == authorized",
  R5 "must challenge: client-side zod equals server-side enforcement".
- `context/foundation/test-plan.md:127` — "Real Postgres + RLS for Phase 2
  isolation tests; do not mock the DB for IDOR coverage."
- `context/foundation/test-plan.md:235-238` — §6.3 cookbook placeholder (this
  phase fills it): "second-user IDOR pattern against local Supabase + RLS".
- `context/foundation/prd.md:37` — "Data isolation is unconditional — no
  sharing, cross-account access, or admin-viewable user data in v1."
- `context/foundation/prd.md:72,76` — FR-007 (log insurance entry), FR-008
  (view/edit/delete any entry with delete confirmation).
- `context/changes/testing-bootstrap-ai-chat/plan.md:79,85` — Phase 1 explicitly
  deferred real-RLS IDOR (R3) and the `cars/[id]/select.ts` ownership endpoint
  to Phase 2.
- `CLAUDE.md:35` — "Enable RLS on every new table with per-operation, per-role
  policies." (The existing policies omit the role clause — see §2 note.)
- No contradictions across test-plan / prd / prd-v2 / roadmap / Phase 1 plan.

## Related Research

- `context/changes/testing-bootstrap-ai-chat/research.md` — Phase 1 research
  (chat envelope R1/R2; established the Vitest runner + `astro:env/server`
  alias double this phase extends).
- `context/foundation/test-plan.md` §1 (principles), §2 (R3/R5), §4 (stack),
  §6.3 (cookbook target), §7 (exclusions).

## Open Questions

1. **Entry-insert IDOR gap — pin or fix?** Does Phase 2 (a) assert the cross-car
   insert _succeeds today_ and record the gap as a known defect, or (b) ship a
   migration adding a car-ownership `WITH CHECK` subquery to the 4 entry INSERT
   policies and assert it now rejects? (b) widens scope from "tests only" to a
   schema change — a deliberate decision for `/10x-plan`.
2. **Zod edge coverage (R5 second half).** Add cheap pure-unit tests for the
   create/patch zod schemas (no DB), or treat the DB constraints alone as
   sufficient R5 signal for this phase and defer zod-edge unit tests? The
   service-layer harness does not touch zod.
3. **Auth rate limit (30 sign-ins / 5 min, `config.toml:189`).** Create A/B per
   test (simplest, isolation-clean) vs a small reused user pool (faster, risks
   cross-test state). Run integration serially regardless. Bump the limit in a
   test-only config if the suite grows.
4. **Cars-only vs full entry matrix breadth.** User chose cars + all 4 entry
   types. Confirm whether the 4 entry types are written explicitly or
   parametrized over a `[{type, table, service fns}]` table (they share an
   identical query shape — parametrize recommended to keep the suite DRY).
