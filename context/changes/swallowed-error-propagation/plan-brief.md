# Propagate Swallowed Errors at the API and SSR Boundary — Plan Brief

> Full plan: `context/changes/swallowed-error-propagation/plan.md`
> Research: `context/changes/swallowed-error-propagation/research.md`

## What & Why

Every `catch` in `src/` answers with one of two wrong things: an infrastructure fault downgraded to
`404 {"error":"Not found"}` with no server-side trace, or a raw Postgres-authored message echoed into
the response and rendered verbatim in the DOM. Both are downstream of one decision — 24 service sites
do `throw new Error(res.error.message)`, destroying `.code`, `.details` and `.hint`, leaving routes
with nothing to branch on. A dead database currently reads to the user as "your car does not exist",
and constraint and RLS-policy names are on screen today.

## Starting Point

`getCarById` returns `null` for a car owned by someone else and _throws_ only on genuine faults — so
the `.catch(() => null)` at three route sites is incapable of catching the authorization case and
catches nothing but real failures. Network faults arrive from supabase-js as a populated `res.error`
with `code: ""`, not as a rejection, so they land in that same swallow. Separately, 20 sites return
`(err as Error).message`, feeding 14 DOM elements. The observability plumbing is already correct
(`wrangler.jsonc:13-15`); nothing logs into it.

## Desired End State

Every failure crossing an API or SSR boundary produces exactly two artifacts: a structured, queryable
log line carrying the full PostgREST detail for the operator, and a generic, detail-free response
carrying a status code that means what it says. `404` means one thing — the row does not exist or is
not yours. No response body or DOM element contains Postgres-authored text. An SSR failure logs, and
the user lands on `/cars` seeing a translated banner rather than a silent bounce — on a page that now
survives the fault that sent them there.

## Key Decisions Made

| Decision             | Choice                                                             | Why (1 sentence)                                                                                                               | Source                   |
| -------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| Scope                | Service layer + all three findings                                 | One root cause; Finding 3 is mechanical once the service throws typed, and Finding 2 is where the worst residual bug lives     | Plan                     |
| Service error shape  | `ServiceError extends Error` carrying `code`/`details`/`hint`/`op` | Satisfies `only-throw-error` under `strictTypeChecked`, needs no cast, keeps `throw` control flow so no call site restructures | Plan                     |
| Response body        | Generic English literal per status                                 | Exact D1/`chat.ts` precedent; keeps all eight `toEqual` assertions alive; zero client edits                                    | Plan (Research Option A) |
| Ownership failure    | 404 everywhere (was 403 at 4 entry sites)                          | Adopts the reviewed D3 anti-enumeration decision uniformly; the repo currently does it both ways                               | Plan (Research OQ1)      |
| `23503` FK violation | 404                                                                | Same answer the ownership pre-check would have given a moment earlier; the client's correct reaction is identical              | Plan (Research OQ3)      |
| Validators           | Date refinement + mileage `.max()` only                            | `.min(1)` already shipped in `6adbd13`; the date check now covers 14 regex-guarded fields via a shared `isoDate` helper        | Revision                 |
| Unapplied migrations | Moot — resolved upstream                                           | The mileage `CHECK` is applied and the `NOT NULL` pair was reversed, so `23514` is live rather than speculative                | Revision                 |
| Owner filter         | Add it to `updateCar`/`deleteCar`                                  | The isolation suite double-asserts every mutation, so the raw-JWT half keeps RLS proven even when the service short-circuits   | Revision                 |
| Isolation tests      | Rewrite the 3 service assertions shape-agnostic                    | The file already calls the read-back load-bearing; pinning return values is what made this a conflict in the first place       | Revision                 |
| Integration gate     | Phase 1 only                                                       | That is the only phase changing a service signature; gating all six would make Docker a prerequisite for every commit          | Revision                 |
| `42501` reachability | Stays 401, with the argument recorded                              | New ownership predicates give it a second meaning, but every entry route pre-checks ownership so only session-death reaches it | Revision                 |
| SSR surfacing        | Guard `/cars`, render existing `Banner`                            | Fixes the real residual bug (the redirect target cannot survive the error) and reuses a component already in the tree          | Plan (Research S3)       |
| Test coverage        | Mapper unit tests + route-wiring tests                             | Locks the oracle Finding 1 destroyed at the cheapest layer, and proves routes actually call the mapper                         | Plan                     |
| Absence vs fault     | `.maybeSingle()` + `!res.data`                                     | The codebase already contains this shape at `entries.ts:150-152` — a convergence, not a redesign                               | Research                 |
| Log shape            | One object, not string + error                                     | Cloudflare indexes the top-level keys of a single logged object; a second argument is not merged                               | Research                 |
| `42501` status       | 401, not 403                                                       | The anon downgrade is silent, so it almost always means the session died mid-request                                           | Research                 |
| `23505` handling     | Not mapped — unreachable                                           | The schema has zero UNIQUE and zero CHECK constraints (probed)                                                                 | Research                 |

## Scope

**In scope:** `ServiceError` and the 24 throw sites; `.maybeSingle()` conversions; the `updateCar`
missing-owner-filter and `deleteCar` no-op-success bugs; six unchecked `res.data` derefs; a
code→status mapper and structured logger; three `.catch(() => null)` swallows; `z.uuid()` on car path
params; 20 raw-echo catches; 403→404 at four sites; a shared `isoDate` refinement across 14 date
fields plus a mileage `.max()`; five silent SSR catches; three entirely unguarded service calls; an
error banner on `/cars` with new i18n keys; an eslint `no-console` scoping change; and adapting five
`integration/` call sites to the new service signatures.

**Out of scope:** any migration (the three formerly-pending ones resolved upstream); `auth/signin.ts`
and `signup.ts`'s raw auth messages;
adding a `code` field to the envelope; translating API errors; refactoring `chat.ts`'s existing
catches; alerting, Logpush, or Tail Workers; success-response envelopes; making CI run `npm test`.

## Architecture / Approach

Bottom-up, in dependency order. `src/lib/services/errors.ts` holds `ServiceError` and stays
HTTP-ignorant — the service layer knows about databases, not status codes. `src/lib/api-errors.ts`
holds the code→status table, the single-object logger, and a `Response`-returning helper — it is the
only module that knows a `22P02` is a client fault and a `57014` is not. Every route catch becomes one
line delegating to it. Absence travels in the data channel (`null`), faults travel in the error
channel (`ServiceError`), and only the route decides what either means in HTTP.

## Phases at a Glance

| Phase                     | What it delivers                                                                                | Key risk                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1. Service error contract | `ServiceError`, `.maybeSingle()` conversions, three latent bug fixes, `integration/` adaptation | Signature changes break the typecheck at **seven** sites — two routes and five in `integration/`; all must land in this phase |
| 2. Mapping layer          | Code→status table, structured logger, `Response` helper, eslint scoping                         | Getting a status wrong here propagates to every route; the table is the specification and needs a test per row                |
| 3. Cars API routes        | The three swallows split, `z.uuid()` path guards, 4 echoes fixed                                | `e2e/cross-user-data-isolation.spec.ts:99` needs a genuine 404 — the uuid guard is what keeps it passing                      |
| 4. Entries API routes     | 16 echoes fixed, 403→404 at four sites                                                          | A user-visible status change with no test asserting the old value either way                                                  |
| 5. Validator tightening   | Shared `isoDate` helper across 14 date fields, mileage `.max()`                                 | The helper touches `renewal_date`/`policy_start_date`/`next_inspection_date`, which no test covers end to end today           |
| 6. SSR boundary           | `/cars` guarded, 5 catches logged, banner + i18n, 3 unguarded calls fixed                       | Editing `chat.ts` fires the R1 tripwire hook, immediately running the eight `toEqual` envelope assertions                     |

**Prerequisites:** local Supabase stack running (`npx supabase start`) — Phase 1's integration gate
requires it, and several manual verification steps require deliberately stopping it to observe the
failure path. No new dependencies.

**Estimated effort:** ~4–6 sessions across 6 phases. Phases 1 and 2 are the design work; 3–5 are
largely mechanical once the helper exists; 6 is the only phase touching UI.

## Open Risks & Assumptions

- **The `data-isolation-crud-integrity` conflict is resolved, not deferred.** That change shipped
  first and its `integration/isolation-cars.test.ts:31-44` anticipated this one by path, double-asserting
  every cross-user mutation so the raw-JWT half pins RLS regardless of what the service does. Phase 1
  adds the filter and adapts the tests. The residual risk is narrow: if a future edit deletes a raw-half
  assertion, the service filter would mask a genuine policy regression — that file's header comment is
  the only thing recording why the pairs exist, which is why Phase 1 updates rather than deletes it.
- **Phases 2–6 have no integration gate.** By design, but it means a later phase could break
  `integration/` and close green. `npx astro check` still covers the directory, so only a semantic
  break slips through.
- **`PostgrestError` has no reliably-typed `status` field** across supabase-js versions, so the entire
  mapping keys on `code`. If a code arrives that is not in the table, it falls to 500 — the mapper
  test asserting "no mapping yields 404 except `23503`" is what keeps that failure mode safe.
- **Newly-surfaced statuses could break an unknown consumer.** Failures that returned 404 or a
  raw-message 500 now return 400/401/404/503. No client depends on the old behavior today, but any
  reviewer should sanity-check the 14 DOM surfaces.
- **The 403→404 change is a convention decision, not a bug fix.** It is deliberate and unasserted by
  any test; Phase 2 of the test-plan rollout will encode whatever ships.
- **Logging ships without a test**, by design — Workers Logs is pull-only, nothing alerts, and
  `e2e/README.md:3-5` holds that a test that cannot name its risk should not be written. There is no
  test-plan risk row for "operator cannot diagnose a production failure".
- **Retention is 3 days on the Free tier**, which rarely survives a weekend. Upgrading to Paid (7 days)
  is worth considering separately if debugging user-reported bugs becomes a real workflow.

## Success Criteria (Summary)

- A user hitting a broken database sees "something went wrong", not "your car does not exist" — and
  the operator can find that failure in one Workers Logs query.
- No Postgres table, column, constraint, or policy name is ever visible to a user.
- An isolation test asserting 404 for a foreign id now fails when the database is broken — the oracle
  Phase 2 of the test rollout depends on is restored.
