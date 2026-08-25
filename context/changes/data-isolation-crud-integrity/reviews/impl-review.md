<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Data isolation (R3) + CRUD integrity / server-side validation (R5)

- **Plan**: `context/changes/data-isolation-crud-integrity/plan.md`
- **Scope**: Phases 1–6 of 6 (full plan)
- **Date**: 2026-08-25
- **Verdict**: REJECTED — do not archive until F1 is resolved
- **Findings**: 1 critical, 4 warnings, 5 observations
- **Commits reviewed**: `d16fdfc` (p1), `809d5c2` (p2), `2db9804` (p3), `bc57e3d` (p4), `6adbd13` (p5), `ccaa952` (p6), `c459ce5` (epilogue)

> The verdict is mechanical (any critical security FAIL → REJECTED) and should not be
> read as a judgement on the work. The implementation faithfully executed the plan and
> every automated criterion re-ran green. **F1 is a flaw in the plan, not a deviation
> from it** — Phase 3 was scoped as "close the entry-_insert_ car-ownership gap", and it
> closed exactly that. The gap has a second door the plan never named.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | FAIL    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Success criteria — re-run at review time

| Criteria           | Command                    | Result                                          |
| ------------------ | -------------------------- | ----------------------------------------------- |
| 1.2, 5.2           | `npm test`                 | 97 passed (4 files)                             |
| 2.1, 3.2, 4.1, 5.3 | `npm run test:integration` | 114 passed (5 files)                            |
| 3.1, 5.1           | `npx supabase db reset`    | all 7 migrations apply clean; suite green after |
| 3.3, 5.4           | `npm run test:e2e`         | 4 passed                                        |
| 1.3–6.2            | `npm run lint`             | exit 0, no errors                               |
| —                  | `npm run typecheck`        | 0 errors, 0 warnings                            |
| 6.1                | `prettier --check`         | this change's files conform                     |

Teardown hygiene: 1 user in `auth.users` after a full run, 0 matching `integration-*`.

## Findings

### F1 — Entry UPDATE policies leave `car_id` unconstrained; the car-ownership fix is reachable around

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260825000000_entry_insert_car_ownership.sql` vs `20260528000000_entries_schema.sql:25-28,62-65,100-103,139-142`
- **Detail**: The migration hardens the four `FOR INSERT` policies with an `EXISTS` subquery on `public.cars`. The four `FOR UPDATE` policies are untouched and still read `USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)` — no policy inspects `car_id`. A two-step INSERT-then-UPDATE produces a row byte-identical to the one the new INSERT policy refuses.

  Reproduced end-to-end against the live stack:

  ```
  step 1  INSERT on own car            → 201  (allowed, as designed)
  control INSERT straight onto A's car → 403 42501  (BLOCKED by the new policy ✓)
  step 2  UPDATE car_id → A's car      → 200

  ground truth (admin): car_id=A'S CAR, user_id=attacker
  victim A sees 0 entries on her own car
  ```

  Two qualifiers:
  - **Not reachable through the app.** The PATCH routes' zod schemas accept `id`, never `car_id`, so the UI cannot trigger it. It is reachable in one line from any signed-in user's browser console against PostgREST with their own JWT — the exact threat model the INSERT fix addresses.
  - **Not a regression.** These policies predate the change. What is new is that `20260825000000`'s header asserts a guarantee the schema does not provide, and `describe("cross-car insert")` (`integration/isolation-entries.test.ts:304-328`) goes green over the open door. The change added confidence faster than coverage.

- **Fix ⭐**: Mirror the same `EXISTS` predicate into the four UPDATE policies, red-first — extend the cross-car block with a raw-client UPDATE case per entry type, observe it fail, then ship `ALTER POLICY … USING/WITH CHECK` (takes both expressions, so no drop/recreate risk).
  - Strength: exactly the shape Phase 3 already validated.
  - Tradeoff: a seventh migration and a follow-up change folder.
  - Confidence: HIGH — attack and fix shape both verified against the running database.
  - Blind spot: have not checked whether any legitimate flow moves an entry between a user's _own_ cars; the predicate still permits that, but worth confirming.
- **Decision**: PENDING

### F2 — Partial `withTwoUsers()` failure leaks a user and masks its own cause

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `integration/fixtures/users.ts:111-129`
- **Detail**: If creating user B throws (rate-limit 429, transient container hiccup), user A is already created at line 113 with no rollback — orphaned permanently, since emails carry a timestamp+uuid and never collide, so nothing cleans them up and nothing complains. Worse, `users` stays unassigned, so all five specs' `afterAll` throws `TypeError: Cannot read properties of undefined (reading 'dispose')` and the reported failure hides the real one. That defeats `users.ts:88-93`, whose entire purpose is failing where the cause is legible.
- **Fix**: `try/catch` around B's creation that deletes A on throw; `users?.dispose()` in the five `afterAll` hooks.
- **Decision**: PENDING

### F3 — Load-bearing admin assertion has no positive control

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `integration/isolation-entries.test.ts:305-316`
- **Detail**: The one place in the suite where the admin client carries a load-bearing assertion asserts only `expect(landed.data).toHaveLength(0)` — satisfied equally well by an admin client that can see nothing at all. This is precisely the false-pass pattern the sibling file's docblock warns against ("Absence alone would also hold for a client that reads nothing"). `harness.test.ts:61-68` supplies that control for `cars` only, in a different file with different users.
- **Fix**: assert in the same test that `entryA` IS visible through the admin client, pairing the absence claim with a presence claim.
- **Decision**: PENDING

### F4 — 16 of 20 RLS policies lack a role clause

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `pg_policies` — `{public}`: 16, `{authenticated}`: 4
- **Detail**: CLAUDE.md requires "per-operation, per-role policies". The migration added `TO authenticated` to the four INSERT policies it recreated, leaving entries SELECT/UPDATE/DELETE and all four `cars` policies at the default `public`. Security impact is nil (`auth.uid()` is NULL for anon, so `NULL = user_id` is never TRUE), but the split now implies the role clause is meaningful on INSERT and not elsewhere.
- **Fix**: one `ALTER POLICY <name> ON <table> TO authenticated;` per remaining policy — role-list-only, no expressions restated. Fold into F1's migration.
- **Decision**: PENDING

### F5 — Comment contradicts code shipped in the same change

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `integration/validation-constraints.test.ts:150-153`
- **Detail**: The comment says "every route's zod schema currently says `.min(0)`, so this exact value passes validation and arrives here. Phase 5 closes that gap on the schema side; the constraint is what stands until then". Phase 5 landed one commit later (`6adbd13`); all eight schemas now read `.min(1, "Mileage must be greater than 0")`. A reader takes away the opposite of the truth.
- **Fix**: rewrite to the present tense — the edge now rejects 0 with a 400, and this file's job is to pin the constraint _independently_ so the two layers can be shown to agree rather than assumed to.
- **Decision**: PENDING

### F6 — Dead field `markerColumn`

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `integration/crud-integrity.test.ts:53,78,98,120,154`
- **Detail**: Declared on `EntryCase` and populated for all four types; zero read sites. It reads as a load-bearing part of the oracle contract the docstring describes, so it will mislead the next reader into thinking marker placement is verified somewhere.
- **Fix**: delete the field and its four values, or use it in a read-back assertion.
- **Decision**: PENDING

### F7 — Two specs spend an unused second user

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `integration/crud-integrity.test.ts:174-177`, `integration/validation-constraints.test.ts:136-139`
- **Detail**: Both call `withTwoUsers()` but contain zero references to `userB` — 4 of the suite's 10 sign-ins go to users no assertion ever sees. Measured at review time: 4+ full integration runs within ~10 minutes with no rate-limit failures, so `admin.createUser` appears **not** to count against `config.toml:190`'s `sign_in_sign_ups = 30`. Headroom is thinner than it looks (3 runs / 5 min) but not as thin as a worst-case reading suggests.
- **Fix**: add a `withOneUser()` helper so the budget reads correctly as the suite grows.
- **Decision**: PENDING

### F8 — `.env.example` mislabels the service-role key; `.gitignore` misses `.env*.local`

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `.env.example:5-6`, `.gitignore`
- **Detail**: The key is documented as "E2E only (`npm run test:e2e`)", but `integration/fixtures/env.ts:43` hard-requires it and `globalSetup` fails the whole project without it — a fresh clone gets a failure whose docs point at the wrong suite. Separately, `.gitignore` covers `.env`, `.env.production`, `.dev.vars` but not `.env.local`, which Vite/Astro read and which is a common place to stash a service-role key.
- **Fix**: name both suites in the comment; add `.env*.local` to `.gitignore`.
- **Decision**: PENDING

### F9 — Three small slips against the suite's own oracle standard

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `integration/validation-constraints.test.ts:273,166,255`; `integration/crud-integrity.test.ts:80,155-160`
- **Detail**: (a) `expect(created.engine_type).toBe(engineType)` asserts on `createCar`'s return value rather than re-reading the row — the one thing that file's own docblock says not to do. (b) `crud-integrity` omits `policy_start_date` and `cause` from read-back assertions although both are written in the payloads; `toMatchObject` ignores them silently. (c) Raw-error assertions use `error?.code` without a `not.toBeNull()` pre-check, so a real regression reads as "expected undefined to be '23514'" rather than "the insert unexpectedly succeeded" — the isolation files get this right.
- **Fix**: read back through `getCarById`; add the two omitted fields; add the null pre-assert.
- **Decision**: PENDING

### F10 — CI gates neither test suite

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `.github/workflows/ci.yml:18-21`
- **Detail**: CI runs `npm ci`, `astro sync`, `npm run lint`, `npm run build` — no tests. The `unit` project is Docker-free and would cost nothing to add; `.husky/pre-commit` runs it but is bypassable with `--no-verify` and does not run on PRs. **Deferred by design**: the plan's "What We're NOT Doing" states "No CI gate. test-plan §3 assigns it to Phase 4." Recorded as scope, not drift.
- **Fix**: none in this change — carry into rollout Phase 4.
- **Decision**: PENDING

## Verified clean (recorded so it is not re-litigated)

- The `EXISTS` correlation is correct in all four policy blocks, each naming its own table — no copy-paste slip. Postgres evaluates the subquery as the invoking role, so `cars`' own SELECT policy also applies; the explicit `AND cars.user_id = auth.uid()` is redundant but defensively correct.
- `TO authenticated` over-permits nothing: anon is already blocked by the NULL comparison, and `service_role` holds `BYPASSRLS` and never consults policies.
- `DROP POLICY` without `IF EXISTS` is the right call — a name typo aborts the migration loudly instead of silently leaving a table with no INSERT policy. All four names match the originals character for character.
- `DROP NOT NULL` is data-safe and every consumer is already null-tolerant: `types.ts`, `services/entries.ts:377`, `InsuranceEntryList.tsx:31`, `InspectionEntryList.tsx:31`, `EntryDetail.astro:76-78,98`, `LastEntryCard.astro:23-25,32`, `dashboard.astro:112`, `InspectionEntry(Edit)Form.tsx:27,112`.
- The service-role key cannot reach a client bundle: nothing under `src/` imports from `integration/`; the key is absent from the `astro:env` schema; `integration/` is outside Astro's module graph; `.gitignore` covers `.env`.
- No `.skip` / `.only` / `.todo` anywhere in the suite.
- `git diff` on `plan.md` touches only `## Progress` rows — the plan was never rewritten to match the implementation.
- The dual service/raw assertion is present on every cross-user mutation (cars and all four entry types), plus the attacker-supplied-`userId` case the plan did not name.
- Every factual claim in the new §6.3 cookbook was checked against the code; none is contradicted.
