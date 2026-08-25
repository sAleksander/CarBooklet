# Data isolation (R3) + CRUD integrity / server-side validation (R5) Implementation Plan

## Overview

Rollout Phase 2 of `context/foundation/test-plan.md`. Stand up a Vitest
**integration project** that drives `src/lib/services/{cars,entries}.ts` against
the **real local Supabase stack with RLS**, using two genuinely authenticated
users, and prove two things the suite cannot prove today:

- **R3** — a user cannot read, update, or delete another user's car or entry,
  even when the service layer has no `user_id` filter of its own.
- **R5** — create/edit/delete enforce ownership and server-side validation
  regardless of what the client sends, with the **DB constraint** as the oracle.

Along the way the phase closes three defects the research and this planning pass
surfaced: an open IDOR write-vector in the entry INSERT policies, and three
places where the zod schemas at the API edge and the database disagree about
what is valid.

## Current State Analysis

**What exists.** Phase 1 (`testing-bootstrap-ai-chat`) stood up Vitest with a
single project globbing `src/test/**/*.test.ts`, an `astro:env/server` alias
double, and four AI-focused specs. A Playwright layer landed afterwards
(`bbd9b0e`, `db87b35`, `a7c9102`, `6929f31`, `6899ecd`) with per-test Supabase
user fixtures, and it already covers **two slices of this phase's risks**:
`e2e/cross-user-data-isolation.spec.ts` (R3 on the two server-rendered pages)
and `e2e/car-delete-blast-radius.spec.ts` (R5's delete cascade). That spec's own
header states the rest of R3 "is a route contract and belongs in integration
tests — rollout Phase 2 owns it."

**What's missing.** There is no test at any layer that exercises the
service/RLS contract directly with a second user. Everything below the SSR page
and above the browser is unproven.

**The defenses, unevenly applied** (verified at HEAD, unchanged since research):

| Layer                    | cars                                                                        | entries                                                                 |
| ------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Service `user_id` filter | `getCarById` only — `updateCar`/`deleteCar` have **none** (`cars.ts:25,31`) | every read, update and delete filters `.eq("id").eq("user_id")`         |
| Route pre-check          | `getCarById` → 404 before mutate                                            | POST only (`getCarById` → 403); PATCH/DELETE rely on the service filter |
| RLS policy               | per-operation on `auth.uid() = user_id`                                     | same, **except INSERT ignores `car_id` ownership**                      |

RLS is the common floor, and for `updateCar`/`deleteCar` it is very nearly the
only floor. That is precisely why the test must reach it with a real second
user rather than trusting it.

**Three constraints that are the R5 oracle**, all independent of the handlers:
`CHECK (mileage > 0)` on all four entry tables, `insurer NOT NULL`,
`result NOT NULL`, plus the `engine_type` enum.

**Adjacent in-flight work.** `context/changes/swallowed-error-propagation/`
(status: `preparing`) targets `src/pages/api/cars/[id].ts:48,91`. Its notes warn
that the `.catch(() => null)` → 404 swallow "drains the signal" out of a
route-level isolation test. The service-layer harness chosen here never executes
that catch, so the two changes do not collide — see _What We're NOT Doing_.

## Desired End State

`npm run test:integration` brings up nothing, assumes a running local Supabase,
creates two real users per test, and proves — through the app's own service
functions, adjudicated by real RLS — that every cross-user read, update, delete
and impersonating insert fails, and that server-side validation rejects bad
input the client could send. `npm test` and the pre-commit hook stay Docker-free
and unchanged in runtime. The entry INSERT policies verify car ownership. The
zod schemas and the database agree on what is valid, so no reachable user input
produces a 500.

Verify by: running `npm run test:integration` green with Supabase up; running
`npm test` green with Docker **stopped**; and confirming the entry-insert
rejection test fails when the new migration is reverted.

### Key Discoveries:

- `src/lib/services/cars.ts:25,31` — `updateCar`/`deleteCar` filter on `.eq("id")`
  only. The prime R3 regression target.
- `supabase/migrations/20260528000000_entries_schema.sql:22,59,97,136` — all four
  entry INSERT policies are `WITH CHECK (auth.uid() = user_id)` with no `car_id`
  ownership subquery. User B can write an entry against User A's car at the DB
  layer; only the route's 403 pre-check stands in the way today.
- **Cross-user writes produce three different signatures, not one.** Research
  recorded "0 rows, silently, no error" — true at the SQL level, but the service
  wrappers transform it differently: `updateCar` ends in `.single()`, so 0 rows
  surfaces as a **`PGRST116` throw**; `deleteCar` has no `.select()`, so it is
  **genuinely silent**; entry deletes use `.select("id")` and return `[]` → the
  service maps to `false`. Assertions must be written per operation, and the
  **persisted-state check is the assertion that matters** in all three cases.
- `.husky/pre-commit` runs `npm test`. Placing integration specs under the
  existing `src/test/**` glob would make Docker mandatory for every commit.
- `e2e/fixtures/env.ts` — "The service-role key … must never be imported by
  anything under `src/`." This governs where the integration suite lives.
- **Three zod↔DB parity gaps**, exactly what R5's "must challenge: client-side
  zod equals server-side enforcement" predicted:
  - `mileage: z.number().int().min(0)` in all 8 entry schemas vs
    `CHECK (mileage > 0)` — `mileage: 0` passes the edge and 500s at the floor.
  - `insurer: z.…nullish().transform(v => v ?? null)` vs `insurer NOT NULL`.
  - inspection `result: z.…nullable().optional()` vs `result NOT NULL`.
    The last two are **reachable through the normal UI**: `InsuranceEntryForm.tsx:58`
    sends `insurer: null` for a blank field, and `InspectionEntryForm.tsx:26,113`
    defaults `result` to null behind a "Not recorded" option. `InsuranceEntryList.tsx:31`
    renders insurer conditionally. The UI was built for optional; the NOT NULL
    migrations outran it.
- `src/lib/services/*.ts` import only `@supabase/supabase-js` (type-only) and
  `@/types`, which is runtime-import-free — importing them under test pulls in
  no `astro:env/server`.

## What We're NOT Doing

- **No route-handler tests for cars/entries.** The service layer is the chosen
  cost×signal point; route tests would mock Supabase and prove branching, not
  isolation. They would also edit `src/pages/api/cars/[id].ts` concurrently with
  the in-flight `swallowed-error-propagation` change.
- **Not fixing the `.catch(() => null)` → 404 swallow.** Owned by
  `swallowed-error-propagation`. Recorded here as a dependency for whenever
  route-level R3 assertions are written.
- **Not adding a `user_id` filter to `updateCar`/`deleteCar`.** Doing so would
  short-circuit ahead of RLS and stop the test from reaching the policy layer —
  the asymmetry is the thing under test, not a bug to fix first.

  > **⚠️ Conflicts with `context/changes/swallowed-error-propagation/plan.md`.** That change's Phase 1
  > _adds_ the `user_id` filter to both functions (treating its absence as the latent bug behind
  > precedent D7), and also changes `deleteCar` to `.select("id")` + a boolean return so a zero-row
  > delete stops reporting success. **The two plans are mutually exclusive as written and must be
  > reconciled before either is implemented.** One possible resolution: assert RLS through a client
  > that bypasses the service layer, so the policy layer stays under test while the service still
  > carries defense in depth.

- **No CI gate.** test-plan §3 assigns it to Phase 4.
- **No re-testing of what E2E already covers** — the `/cars` garage listing, the
  `/entries/[type]/[id]` direct-URL 404, and the car-delete cascade blast radius.
- **No route-level 500-body cleanup** (raw Postgres text echoed to clients).
  That is R2 territory and belongs to `swallowed-error-propagation` Finding 3.

## Implementation Approach

Two real users per test, each holding their own anon client carrying their own
JWT, so PostgREST evaluates `auth.uid()` correctly and RLS — not a mock — decides
every outcome. A service-role admin client creates and deletes the users; it
**never appears in an assertion**, because it bypasses RLS and would turn every
isolation check into a false pass. Teardown is one `admin.deleteUser` per user;
`ON DELETE CASCADE` reaches every car and entry they own.

The four entry types share an identical query shape, so they are driven from a
single parametrized table rather than written out four times.

Phase 3 is deliberately red-first: the rejection test is written and observed to
fail against today's policies before the migration that makes it pass.

## Critical Implementation Details

**Cross-user writes are not exceptions — assert persisted state.** Under RLS
`USING`, an UPDATE or DELETE against a row you cannot see affects zero rows.
Whether that reaches the caller as an error depends entirely on the service
wrapper's tail (`.single()` throws, bare `.delete()` does not). A test written
as "expect it to throw" would pass today for `updateCar` and silently pass
forever for `deleteCar` even if isolation broke. Every isolation test must
re-read the row as its owner and assert it is unchanged or still present.

**INSERT is the exception.** `WITH CHECK` violations _do_ raise — Postgres
`42501`. The impersonation test (B inserting with `user_id = A`) asserts a
rejection; the read/update/delete tests assert state.

**Auth rate limit.** `supabase/config.toml:189` caps sign-ins at 30 per 5
minutes. The integration project runs single-threaded and creates two users per
test; keep the spec count in this phase within that budget, and if the suite
later grows, raise the limit in config rather than pooling users across tests.

**Never assert through the admin client.** It bypasses RLS. Use it to create
users, seed the foreign user's rows, and to _read back_ ground truth when
confirming a row survived a rejected delete — never to stand in for the user
whose access is under test.

---

## Phase 1: Integration harness + vitest projects split

### Overview

Stand up an integration test project that is invisible to `npm test`, with the
two-user fixture and a fail-fast environment guard, proven by one smoke spec.

### Changes Required:

#### 1. Vitest configuration

**File**: `vitest.config.ts`

**Intent**: Split the single test config into two named projects so the existing
fast suite stays Docker-free and keeps running on pre-commit, while integration
specs are opted into explicitly.

**Contract**: `test.projects` with `unit` (name, `include: ["src/test/**/*.test.ts"]`,
the existing `resolve.alias` and `passWithNoTests`) and `integration` (name,
`include: ["integration/**/*.test.ts"]`, `globalSetup`, `testTimeout: 20_000`,
and a single-fork pool so specs run serially). The `@` alias must be present in
both projects; `astro:env/server` is only needed by `unit`.

#### 2. Environment access for the integration process

**File**: `integration/fixtures/env.ts`

**Intent**: Load `.env` for the Vitest process and expose the three credentials
the harness needs, failing with actionable text when the stack is not running.

**Contract**: Exports `SUPABASE_URL`, `SUPABASE_ANON_KEY` (read from the existing
`SUPABASE_KEY` var — that _is_ the anon key), `SUPABASE_SERVICE_ROLE_KEY`.
Mirror `e2e/fixtures/env.ts`'s `process.loadEnvFile()` + `required()` shape;
this file is the reason the suite lives outside `src/`.

#### 3. Local-stack guard

**File**: `integration/globalSetup.ts`

**Intent**: Refuse to run against anything but a local Supabase. These tests
create and delete real users; pointed at a cloud project they would do real
damage. This guard — not a separate key name — is what makes reusing the app's
env vars safe.

**Contract**: Default export (or `setup` export) that throws unless
`SUPABASE_URL`'s host resolves to localhost/127.0.0.1, and that performs one
cheap round-trip so "Supabase is down" fails here with a clear message rather
than as a timeout inside every spec.

#### 4. Two-user fixture

**File**: `integration/fixtures/users.ts`

**Intent**: Create two email-confirmed users, hand back an authenticated
Supabase client per user plus an admin client, and delete both users on
teardown.

**Contract**: A `withTwoUsers()`-style helper (or `createTestUser`/`disposeUser`
pair) returning `{ userA, userB, admin }` where each user carries `{ id, email,
client }`. Every client is built with `auth: { persistSession: false,
autoRefreshToken: false }` to stop session bleed across files. Emails are unique
per run (timestamp + uuid slice), following `e2e/fixtures/app.ts`. Users are
created via `admin.auth.admin.createUser({ email_confirm: true })` and their
clients authenticated via `signInWithPassword`.

#### 5. Seeding helpers

**File**: `integration/fixtures/seed.ts`

**Intent**: Create a car (and optionally an entry of a given type) owned by a
given user, through that user's own authenticated client, so RLS validates the
seed as well.

**Contract**: `seedCar(client, userId, overrides?)` → `Car`;
`seedEntry(client, type, { userId, carId }, overrides?)` → the created row. Valid
default payloads per entry type, with unique marker strings so "this row leaked"
is unambiguous.

#### 6. npm scripts

**File**: `package.json`

**Intent**: Keep `npm test` meaning "the fast suite" and add an explicit door to
the integration project.

**Contract**: `test` → `vitest run --project unit`; `test:integration` →
`vitest run --project integration`; `test:all` → `vitest run`. The pre-commit
hook and `.github/workflows/ci.yml` keep calling `npm test` and need no edit.

#### 7. Smoke spec

**File**: `integration/harness.test.ts`

**Intent**: Prove the harness itself before any risk depends on it — that two
users exist, each client acts as its own user, and RLS is actually adjudicating.

**Contract**: A + B each seed a car; `getCars(a.client)` returns A's car and not
B's, and symmetrically. This is the positive control every later isolation
assertion leans on: "the foreign row is absent" only means something if "the
own row is present" is asserted in the same breath.

### Success Criteria:

#### Automated Verification:

- Integration suite passes with Supabase up: `npm run test:integration`
- Fast suite passes with Docker stopped: `npm test`
- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`

#### Manual Verification:

- With Supabase stopped, `npm run test:integration` fails with the guard's
  actionable message, not a timeout stack trace
- Temporarily pointing `SUPABASE_URL` at a non-localhost host aborts the run
- `npx supabase status` shows no leftover test users after a run

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: R3 cross-user isolation matrix

### Overview

The core of R3: every read, update, delete and impersonating insert that User B
attempts against User A's data fails, proven against real RLS through the app's
own service functions.

### Changes Required:

#### 1. Car isolation

**File**: `integration/isolation-cars.test.ts`

**Intent**: Pin the cars half of the isolation matrix, with particular weight on
`updateCar`/`deleteCar` — the two mutations with no service-level `user_id`
filter, where RLS is effectively the only defense.

**Contract**: One `it` per row of the matrix, all acting as B against A's car:
`getCars` omits it; `getCarById(b.client, aCar.id, b.id)` → `null`; `updateCar`
→ does not modify (assert by re-reading as A); `deleteCar` → row still present
when re-read as A; `createCar` with `user_id: a.id` → rejected. Each destructive
case ends with a read-back as A asserting the row is byte-identical or still
present. Note in a comment which of these throw and which are silent, and why
the state assertion is the one that carries the signal.

#### 2. Entry isolation, parametrized

**File**: `integration/isolation-entries.test.ts`

**Intent**: Cover all four entry types without four copies of the same file.

**Contract**: A `const ENTRY_TYPES = [{ label, table, get, getById, update,
delete, validPayload }]` table driving `describe.each`. Per type, acting as B
against A's entry: list omits it, `getEntryById` → `null`, update leaves it
unchanged (re-read as A), delete returns `false` and the row survives, insert
with `user_id: a.id` → rejected. `getCarDeadlines` and `getLastEntry` against
A's `car_id` return empty/null.

### Success Criteria:

#### Automated Verification:

- Integration suite passes: `npm run test:integration`
- Linting and type checking pass: `npm run lint && npm run typecheck`

#### Manual Verification:

- The tests bite: temporarily drop one RLS SELECT policy (`supabase db reset`
  afterwards) and confirm the corresponding isolation test fails
- Confirm the delete-isolation test fails if the read-back assertion is removed
  and replaced with "expect it to throw" — the state assertion is load-bearing

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Close the entry-insert car-ownership gap

### Overview

Today User B can insert an entry carrying their own `user_id` but pointing at
User A's `car_id`. The route's 403 pre-check hides it; the database permits it.
Write the rejection test first, watch it fail, then ship the policy migration
that makes it pass.

### Changes Required:

#### 1. The failing test

**File**: `integration/isolation-entries.test.ts`

**Intent**: Assert, for each of the four entry types, that B inserting an entry
against A's car is rejected at the database. This test must be observed failing
before the migration is written — that observation is the proof the gap is real.

**Contract**: Per entry type: `create*Entry(b.client, { user_id: b.id, car_id:
aCar.id, ...valid })` rejects; and a read-back as A confirms no such row is
attached to A's car.

#### 2. Policy migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_entry_insert_car_ownership.sql`

**Intent**: Make the database enforce what the route currently enforces alone —
that an inserted entry's `car_id` belongs to the inserting user.

**Contract**: For each of `repair_entries`, `oil_change_entries`,
`inspection_entries`, `insurance_entries`, replace the INSERT policy's
`WITH CHECK (auth.uid() = user_id)` with the same condition `AND` an `EXISTS`
subquery confirming a row in `public.cars` with `id = car_id AND user_id =
auth.uid()`. Policies must be dropped and recreated (a `WITH CHECK` cannot be
altered in place). Per `CLAUDE.md`, add the `TO authenticated` role clause the
existing policies omit.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly from scratch: `npx supabase db reset`
- Integration suite passes: `npm run test:integration`
- Existing E2E suite still passes: `npm run test:e2e`
- Linting and type checking pass: `npm run lint && npm run typecheck`

#### Manual Verification:

- The rejection test was confirmed **failing** before the migration existed
- Reverting the migration locally turns the rejection test red again
- The owner's own entry creation still works through the UI for all four types
  (the subquery must not break the happy path)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: R5 CRUD integrity + DB-constraint oracle

### Overview

Owner-path CRUD round-trips that read back from the database rather than
trusting a return value, plus the constraint oracle: input the client could send
that the database must reject regardless of what any handler believes.

### Changes Required:

#### 1. Owner CRUD round-trips

**File**: `integration/crud-integrity.test.ts`

**Intent**: Prove create/update/delete actually persist — the assertion E2E's
`seed.spec.ts` makes at the browser level, made here for the four entry types
and cars.

**Contract**: Per surface: create → re-read by id and assert the seeded field
values (oracle is the fixture, never the function's own return); update → re-read
and assert only the intended fields changed; delete → re-read returns null and
sibling rows are untouched.

#### 2. Constraint oracle

**File**: `integration/validation-constraints.test.ts`

**Intent**: Exercise the DB constraints directly, so R5's "independent oracle"
is a real Postgres rejection and not a mirror of the handler under test.

**Contract**: Parametrized over the four entry types — `mileage: 0` rejected,
negative mileage rejected, `mileage: null` **accepted** (a `CHECK` passes on
NULL, and that is intended: mileage is optional). For cars, an invalid
`engine_type` value is rejected. Assert on the rejection, not on the specific
Postgres message text.

### Success Criteria:

#### Automated Verification:

- Integration suite passes: `npm run test:integration`
- Linting and type checking pass: `npm run lint && npm run typecheck`

#### Manual Verification:

- The oracle bites: temporarily drop `repair_entries_mileage_positive`
  (`supabase db reset` afterwards) and confirm the `mileage: 0` case fails
- Confirm the `mileage: null` case is asserted as accepted, not as rejected —
  a test that "tightens" this would contradict the optional-mileage forms

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: R5 zod ↔ DB parity

### Overview

The half of R5 the service layer cannot reach. Three places where the schemas at
the API edge and the constraints at the floor disagree, so input that passes
validation 500s at the database. Two of them are reachable through the normal
UI. Each gap is closed on the side the product's own evidence says is wrong.

### Changes Required:

#### 1. Relax the two NOT NULL constraints

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_relax_optional_entry_fields.sql`

**Intent**: `insurer` and inspection `result` are optional everywhere in the
product — the forms send `null`, the inspection select offers "Not recorded",
the list renders insurer conditionally. Two later migrations made them NOT NULL,
which turned a supported user action into a 500. Restore nullability.

**Contract**: `ALTER TABLE public.insurance_entries ALTER COLUMN insurer DROP
NOT NULL;` and the same for `public.inspection_entries.result`. Add a comment
naming the two migrations this reverses (`20260528000002`, `20260528000003`) so
the history reads as a decision, not a mistake.

#### 2. Tighten the mileage schemas

**File**: `src/pages/api/entries/{repair,oil-change,inspection,insurance}.ts`

**Intent**: The opposite direction — here the database is right. `mileage > 0` is
a deliberate constraint and `min(0)` lets a meaningless zero through to become a 500. Optional-mileage behavior is unaffected: the schemas stay
`.nullable().optional()`.

**Contract**: `.min(0)` → `.min(1)` on the `mileage` field in all eight schemas
(four create, four patch). Add a validation message consistent with the
neighbouring fields' style.

#### 3. Export the schemas for test

**File**: `src/pages/api/cars/index.ts`, `src/pages/api/cars/[id].ts`,
`src/pages/api/entries/{repair,oil-change,inspection,insurance}.ts`

**Intent**: Make the zod schemas callable from a unit test, exactly as Phase 1
did for `sanitise` and `buildSystemPrompt`.

**Contract**: Add `export` to the existing schema consts. Visibility only — no
behavior change, no relocation. (Extracting them to a shared module is explicitly
out of scope; that is a refactor of uncovered code inside a testing phase.)

#### 4. Zod edge unit tests

**File**: `src/test/pages/api/schemas.test.ts`

**Intent**: Pin the edge contract as pure functions — Docker-free, in the fast
`unit` project — and prove the parity gaps are closed.

**Contract**: Per schema: `mileage: 0` now fails, `1` passes, `null` and omitted
pass; `insurer: null` and omitted pass; inspection `result: null` passes and an
out-of-enum value fails; `car_id`/`id` reject a non-uuid; `conducted_at` rejects
a non-`YYYY-MM-DD` string; cars' `engine_type` rejects an out-of-enum value.
Assert on `safeParse().success` and the first issue message, mirroring the
existing chat-route spec's style.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly from scratch: `npx supabase db reset`
- Fast suite passes, including the new schema spec: `npm test`
- Integration suite passes: `npm run test:integration`
- E2E suite passes: `npm run test:e2e`
- Linting and type checking pass: `npm run lint && npm run typecheck`

#### Manual Verification:

- Submit the insurance form with the insurer field blank — the entry saves,
  no 500, and the list renders it without an insurer line
- Submit an inspection with result "Not recorded" — saves cleanly
- Submit an entry with mileage `0` — a 400 with a readable message, not a 500
  carrying Postgres constraint text
- Existing entries with an insurer/result still display unchanged

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 6: Cookbook + test-plan updates

### Overview

Close the rollout phase in the documents that route future contributors, so the
next person writing an isolation test finds the pattern instead of reinventing it.

### Changes Required:

#### 1. Cookbook §6.3

**File**: `context/foundation/test-plan.md`

**Intent**: Replace the "TBD — see §3 Phase 2" placeholder with the second-user
pattern this phase established.

**Contract**: Under §6.3, capture: where integration specs live and why (the
service-role rule in `e2e/fixtures/env.ts`); the two-user + admin client shape;
"never assert through the admin client"; the three cross-user write signatures
and the resulting "assert persisted state, not exceptions" rule; `describe.each`
over the four entry types; the local-URL guard; the auth rate-limit budget.

#### 2. Cookbook §6.2 extension and §6.6 note

**File**: `context/foundation/test-plan.md`

**Intent**: Record that Phase 2 covered R3/R5 at the service layer rather than
extending §6.2's route pattern, and why — plus what the phase taught.

**Contract**: A short §6.2 tail noting the layer split and pointing at §6.3. A
§6.6 "Phase 2" entry covering: the three write signatures; the pre-commit /
projects-split trap; the entry-insert IDOR gap and its migration; the three
zod↔DB parity gaps and which side each was fixed on.

#### 3. Rollout status

**File**: `context/foundation/test-plan.md`

**Intent**: Move §3 Phase 2 to `complete` and refresh the header date.

**Contract**: The §3 table's Phase 2 Status cell → `complete`; the "Last updated"
line in the header block.

#### 4. Change status

**File**: `context/changes/data-isolation-crud-integrity/change.md`

**Intent**: Reflect that the change shipped.

**Contract**: `status: complete`, `updated:` to the landing date.

### Success Criteria:

#### Automated Verification:

- Formatting passes: `npm run format`
- Linting passes: `npm run lint`

#### Manual Verification:

- A reader following §6.3 alone could write a new isolation test without reading
  this plan
- §3 Phase 2 status matches the actual state of the Progress section below

**Implementation Note**: This is the final phase; after it lands the change is ready to archive.

---

## Testing Strategy

### Unit Tests:

- Route zod schemas as pure functions (Phase 5) — boundary values on every
  constrained field, and specifically the three former parity gaps.
- Runs in the `unit` project: no Docker, stays on pre-commit.

### Integration Tests:

- Service functions against real Supabase + RLS, two authenticated users.
- R3: read / update / delete / impersonating insert, cars + four entry types.
- R5: owner CRUD round-trips read back from the DB; DB constraints as an
  independent oracle.
- Runs in the `integration` project, serially, behind `npm run test:integration`.

### Manual Testing Steps:

1. `npx supabase start`, then `npm run test:integration` — green.
2. Stop Docker, `npm test` — green, and noticeably fast.
3. Drop one RLS policy locally, re-run integration — the matching isolation test
   goes red. `npx supabase db reset` to restore.
4. Revert the Phase 3 migration — the cross-car insert rejection test goes red.
5. Through the UI: insurance without an insurer, inspection as "Not recorded",
   and an entry with mileage `0` — first two save, third returns a readable 400.

## Performance Considerations

The integration project runs serially by design — the auth rate limit
(`config.toml:189`, 30 sign-ins / 5 min) and shared-database contention both
argue against parallel workers, and the suite is small enough that wall-clock is
dominated by container round-trips rather than concurrency. `npm test` and the
pre-commit hook are untouched and stay Docker-free, which is the performance
property that actually matters day to day.

## Migration Notes

Two migrations ship in this change, both forward-only and both safe on existing
data:

- **Entry INSERT car-ownership** (Phase 3) — tightens policies. Any pre-existing
  row pointing at a foreign car is unaffected (policies gate new inserts only);
  if such rows exist in a real environment they should be audited separately.
- **Relaxing `insurer` / `result` NOT NULL** (Phase 5) — widens the column
  contract, so no existing row can violate it. Note that this makes re-tightening
  harder later; the product evidence for optionality is recorded in the migration
  comment.

Both must be applied to any deployed environment before the corresponding app
code lands, in that order.

## References

- Research: `context/changes/data-isolation-crud-integrity/research.md`
- Test plan: `context/foundation/test-plan.md` §2 (R3/R5), §4, §6.3
- Phase 1 precedent: `context/archive/2026-06-15-testing-bootstrap-ai-chat/plan.md`
- Fixture pattern to mirror: `e2e/fixtures/app.ts`, `e2e/fixtures/env.ts`
- E2E coverage this phase complements: `e2e/cross-user-data-isolation.spec.ts`,
  `e2e/car-delete-blast-radius.spec.ts`
- Adjacent change: `context/changes/swallowed-error-propagation/change.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Integration harness + vitest projects split

#### Automated

- [x] 1.1 Integration suite passes with Supabase up: `npm run test:integration` — d16fdfc
- [x] 1.2 Fast suite passes with Docker stopped: `npm test` — d16fdfc
- [x] 1.3 Linting passes: `npm run lint` — d16fdfc
- [x] 1.4 Type checking passes: `npm run typecheck` — d16fdfc

#### Manual

- [x] 1.5 Stopped Supabase produces the guard's actionable message, not a timeout — d16fdfc
- [x] 1.6 A non-localhost `SUPABASE_URL` aborts the run — d16fdfc
- [x] 1.7 No leftover test users after a run — d16fdfc

### Phase 2: R3 cross-user isolation matrix

#### Automated

- [x] 2.1 Integration suite passes: `npm run test:integration`
- [x] 2.2 Linting and type checking pass: `npm run lint && npm run typecheck`

#### Manual

- [x] 2.3 Dropping an RLS SELECT policy turns the matching isolation test red
- [x] 2.4 Replacing the delete read-back with "expect it to throw" is confirmed insufficient

### Phase 3: Close the entry-insert car-ownership gap

#### Automated

- [ ] 3.1 Migration applies cleanly from scratch: `npx supabase db reset`
- [ ] 3.2 Integration suite passes: `npm run test:integration`
- [ ] 3.3 E2E suite still passes: `npm run test:e2e`
- [ ] 3.4 Linting and type checking pass: `npm run lint && npm run typecheck`

#### Manual

- [ ] 3.5 The rejection test was observed failing before the migration existed
- [ ] 3.6 Reverting the migration turns the rejection test red again
- [ ] 3.7 Owner entry creation still works through the UI for all four types

### Phase 4: R5 CRUD integrity + DB-constraint oracle

#### Automated

- [ ] 4.1 Integration suite passes: `npm run test:integration`
- [ ] 4.2 Linting and type checking pass: `npm run lint && npm run typecheck`

#### Manual

- [ ] 4.3 Dropping the mileage CHECK turns the `mileage: 0` case red
- [ ] 4.4 `mileage: null` is asserted as accepted, not rejected

### Phase 5: R5 zod ↔ DB parity

#### Automated

- [ ] 5.1 Migration applies cleanly from scratch: `npx supabase db reset`
- [ ] 5.2 Fast suite passes including the new schema spec: `npm test`
- [ ] 5.3 Integration suite passes: `npm run test:integration`
- [ ] 5.4 E2E suite passes: `npm run test:e2e`
- [ ] 5.5 Linting and type checking pass: `npm run lint && npm run typecheck`

#### Manual

- [ ] 5.6 Insurance form with a blank insurer saves and renders correctly
- [ ] 5.7 Inspection with result "Not recorded" saves cleanly
- [ ] 5.8 Entry with mileage `0` returns a readable 400, not a 500
- [ ] 5.9 Existing entries with insurer/result still display unchanged

### Phase 6: Cookbook + test-plan updates

#### Automated

- [ ] 6.1 Formatting passes: `npm run format`
- [ ] 6.2 Linting passes: `npm run lint`

#### Manual

- [ ] 6.3 §6.3 alone is sufficient to write a new isolation test
- [ ] 6.4 §3 Phase 2 status matches the Progress section
