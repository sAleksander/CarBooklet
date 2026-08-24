# Data isolation (R3) + CRUD integrity (R5) — Plan Brief

> Full plan: `context/changes/data-isolation-crud-integrity/plan.md`
> Research: `context/changes/data-isolation-crud-integrity/research.md`

## What & Why

Rollout Phase 2 of the test plan. Prove that a user cannot read, edit or delete
another user's car or entry (**R3**, High×High), and that create/edit/delete
enforce ownership and server-side validation regardless of what the client sends
(**R5**). Both are tested against a **real local Supabase stack with RLS** — the
test plan is explicit that mocking the database for IDOR coverage proves nothing.

## Starting Point

The car/entry surface has two defenses applied unevenly: every entry mutation
filters `.eq("id").eq("user_id")` in the service, but `updateCar`/`deleteCar`
have no `user_id` filter at all — isolation there rests on RLS plus a route
pre-check. RLS is the common floor, and nothing at any layer exercises it with
a second user. A Playwright layer landed after research was written and already
covers R3's server-rendered-page slice and R5's delete cascade; its own header
hands the rest to this phase.

## Desired End State

`npm run test:integration` drives the app's own service functions with two
genuinely authenticated users and real RLS deciding every outcome, proving the
full cross-user matrix and the DB-constraint oracle. `npm test` and the
pre-commit hook stay Docker-free. The entry INSERT policies verify car
ownership. The zod schemas and the database agree on what is valid, so no
reachable user input produces a 500.

## Key Decisions Made

| Decision                          | Choice                                            | Why (1 sentence)                                                                                                      | Source |
| --------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------ |
| Test layer                        | Service layer only, real RLS                      | Exactly the gap E2E left; services are import-clean so no env plumbing is needed                                      | Plan   |
| Entry-insert IDOR gap             | Fix it — migration + assert rejection             | Codifying a known hole as expected behavior is a trap for the next reader                                             | Plan   |
| Zod half of R5                    | Pure unit tests, Docker-free                      | Completes R5's stated two-layer contract for near-zero cost                                                           | Plan   |
| Suite gating                      | Vitest projects split; `npm test` stays unit-only | Pre-commit already runs `npm test`; Docker-per-commit would get bypassed                                              | Plan   |
| `updateCar`/`deleteCar` filter    | Leave as-is, test against RLS                     | Adding a service filter would short-circuit before RLS and the policy layer would go unproven                         | Plan   |
| Adjacent error-propagation change | Note the dependency, stay out of the routes       | The service layer never runs the route's 404 swallow, so no signal is lost and no files collide                       | Plan   |
| `insurer` / inspection `result`   | DB is wrong — drop the two NOT NULLs              | The forms send null, the select offers "Not recorded", the list renders conditionally — the constraints outran the UI | Plan   |
| `mileage` zod vs DB               | Zod is wrong — tighten `min(0)` → `min(1)`        | `mileage > 0` is deliberate; `0` currently passes the edge and 500s at the floor                                      | Plan   |

## Scope

**In scope:** integration harness + vitest projects split; full R3 cross-user
matrix over cars and all four entry types; R5 owner CRUD round-trips and the DB
constraint oracle; a migration closing the entry-insert car-ownership gap; a
migration + schema edits closing three zod↔DB parity gaps; zod edge unit tests;
cookbook §6.3.

**Out of scope:** route-handler tests for cars/entries; the `.catch(() => null)`
404 swallow (owned by `swallowed-error-propagation`); adding a `user_id` filter
to `updateCar`/`deleteCar`; the CI gate (test-plan Phase 4); anything E2E
already covers; route 500-body cleanup.

## Architecture / Approach

Two real users per test, each holding their own anon client carrying their own
JWT, so PostgREST evaluates `auth.uid()` and RLS — not a mock — decides every
outcome. A service-role admin client creates, seeds and deletes; it never
appears in an assertion, because it bypasses RLS and would turn every isolation
check into a false pass. Teardown is one `deleteUser` per user, with
`ON DELETE CASCADE` reaching everything they own. The four entry types are
driven from one parametrized table. Specs live in a top-level `integration/`
directory, mirroring `e2e/` — the service-role key must never be imported by
anything under `src/`.

## Phases at a Glance

| Phase                       | What it delivers                                           | Key risk                                                          |
| --------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| 1. Harness + projects split | Two-user fixture, local-URL guard, `test:integration`      | A misconfigured glob makes Docker mandatory on every commit       |
| 2. R3 isolation matrix      | Cross-user read/update/delete/insert, cars + 4 entry types | Asserting "it throws" instead of persisted state passes vacuously |
| 3. Close the IDOR gap       | Red test → policy migration → green                        | A malformed `WITH CHECK` subquery breaks the owner happy path     |
| 4. R5 CRUD + constraints    | Round-trips read back from the DB; constraint oracle       | Over-tightening `mileage: null`, which is legitimately optional   |
| 5. Zod ↔ DB parity          | Two NOT NULLs relaxed, mileage tightened, zod unit tests   | Nullability migrations are hard to reverse later                  |
| 6. Cookbook + status        | §6.3 filled, §6.6 note, Phase 2 marked complete            | —                                                                 |

**Prerequisites:** Docker + `npx supabase start`; `SUPABASE_SERVICE_ROLE_KEY` in
`.env` (already in `.env.example` for E2E).
**Estimated effort:** ~3 sessions across 6 phases; phases 1–2 are the bulk.

## Open Risks & Assumptions

- Phases 3 and 5 add migrations, so this is no longer a tests-only change — both
  need applying to any deployed environment ahead of the app code.
- Relaxing `insurer`/`result` to nullable is easy to ship and hard to reverse;
  the decision rests on UI evidence rather than a stated product requirement.
- The auth rate limit (30 sign-ins / 5 min) bounds how far this suite can grow
  before it needs a test-only config bump.
- Route-level R3 assertions stay uncovered until `swallowed-error-propagation`
  lands and brings its own tests.

## Success Criteria (Summary)

- A second user provably cannot reach any of the first user's data, at the layer
  where RLS is the only defense.
- Input a client can actually send is rejected by the database, not by a mirror
  of the handler under test — and no reachable UI action produces a 500.
- The fast suite stays Docker-free, so the pre-commit gate keeps being used.
