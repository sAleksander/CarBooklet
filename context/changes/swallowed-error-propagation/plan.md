# Propagate Swallowed Errors at the API and SSR Boundary — Implementation Plan

## Overview

Every `catch` in `src/` currently answers with one of two wrong things: an infrastructure fault
downgraded to `404 {"error":"Not found"}` with no trace, or a raw Postgres-authored message echoed
into the HTTP response and rendered verbatim in the DOM. Both are downstream of a single decision in
the service layer — `throw new Error(res.error.message)` at 24 sites, which destroys `.code`,
`.details` and `.hint` and leaves routes with nothing to branch on.

This plan fixes the service error shape first, then maps error codes to statuses at each boundary.
Once the service throws a typed `ServiceError`, the ~38 route-level fixes become mechanical.

## Current State Analysis

**The swallow is proven, not hypothetical.** `getCarById` (`src/lib/services/cars.ts:10-17`) returns
`null` — never throws — for a well-formed uuid owned by another user (research probed this live:
PostgREST answers `406 PGRST116`, which `cars.ts:13` maps to `null`). Therefore the
`.catch(() => null)` at `src/pages/api/cars/[id].ts:48`, `:91` and `src/pages/api/cars/[id]/select.ts:23`
is **incapable** of catching the authorization case. Everything it does catch is a genuine fault —
and `supabase-js` delivers network failures as a populated `res.error` with `code: ""`, not as a
rejection, so a dead database reads to the user as "your car does not exist".

**The consequence for testing.** An isolation test asserting `404` for a foreign car id passes both
when ownership is correctly enforced _and_ when the database is unreachable. The swallow drains the
signal out of the exact oracle that `context/changes/data-isolation-crud-integrity/` (test-plan
Phase 2, risk R3) is about to be written against. This change lands underneath that phase, which has
research but no plan, so nothing is invalidated by going first.

**The leak is bigger than the original audit recorded.** 20 sites (not 14) return
`{ error: (err as Error).message }`, and **14 DOM elements render `json.error` verbatim** —
`CarList.tsx:124`, `CarForm.tsx:226`, eight entry-form error paragraphs, `EntryDetailEditor.tsx:166`.
Postgres constraint and RLS-policy text is on screen today, not merely in a response body.

**Three latent bugs sit alongside the swallow**, each verified against the current source:

- `updateCar` (`cars.ts:25-29`) omits the `.eq("user_id", userId)` filter every sibling carries, and
  does not map `PGRST116` to `null` — so "no such car" becomes a thrown fault whose message is
  `"Cannot coerce the result to a single JSON object"`, shipped as a 500 body. Unreachable today only
  because `[id].ts:48` pre-checks first.
- `deleteCar` (`cars.ts:31-34`) omits both the owner filter and any `.select()`, so PostgREST answers
  `204` with `error: null` even when zero rows matched — the one operation in the codebase that can
  report success for a no-op. This is precedent **D7** recurring (a zero-row DELETE bug already fixed
  once in `context/archive/2026-06-03-entry-management/reviews/impl-review.md:29-30`).
- `entries.ts` dereferences `res.data` without a null guard at six sites (`:264,274,284,294` `.length`;
  `:341-347`, `:413-430` indexing) — a path that puts a JS `TypeError` message in the response body.

**The observability plumbing is already correct; the log _shape_ is not.** `wrangler.jsonc:13-15`
sets `observability.enabled: true` with default 100% sampling, so `console.error` lands in persisted,
queryable Workers Logs. But Cloudflare indexes the top-level keys of a **single logged object** —
`chat.ts`'s `console.error("[ai/chat] Service error:", err)` collapses into one opaque string, and a
second positional argument is not merged into indexed fields. Copying that form 20× produces 20
unqueryable blobs.

## Desired End State

Every failure crossing an API or SSR boundary produces exactly two artifacts: a **structured,
queryable log line** for the operator carrying the full PostgREST detail, and a **generic,
detail-free response** for the client carrying a status code that means what it says.

Specifically, when this plan is complete:

- A dead database, an RLS misconfiguration, or a malformed uuid never returns `404`. `404` means one
  thing only: the row does not exist or is not yours.
- No response body and no DOM element ever contains Postgres-authored text.
- `console.error({ event: "api_error", route, op, userId, status, code, ... })` fires at every catch,
  so `event = "api_error"` returns every failure across the app in one Workers Logs query and
  `group by route` names the broken endpoint.
- An SSR load failure logs, and the user lands on `/cars` seeing a translated error banner rather
  than a silent bounce — and `/cars` itself survives the fault that sent them there.

**Verification:** `npm run lint`, `npx astro check`, and `npm test` pass; the new mapper unit tests
cover every row of the code→status table; the eight existing `toEqual` envelope assertions in
`chat.test.ts` still pass unchanged; `e2e/cross-user-data-isolation.spec.ts` passes unchanged.

### Key Discoveries:

- The codebase **already contains the correct shape**: `getEntryById` (`src/lib/services/entries.ts:150-152`)
  uses `.maybeSingle()` + `if (!res.data) return null`. This is a convergence on an existing in-repo
  pattern, not a redesign.
- `PGRST116` does **not** mean "not found" — it means "not exactly one row". A `.single()` over four
  rows returns the identical code. The current mapping is safe only because every `.single()` here
  filters on a primary key, an undocumented invariant one `.eq("brand", …)` away from turning a
  duplicate-row bug into a 404.
- **`23505` is unreachable.** The schema has zero UNIQUE and zero CHECK constraints (probed against
  `pg_constraint` over all five tables). The original audit listed it as a genuine 4xx case; it cannot
  occur.
- **`42501` maps to 401, not 403.** The anon downgrade in `supabase-js` is silent, so `42501` in this
  app almost always means the session died mid-request.
- The house pattern has **precedent behind it, not preference**: `chat.ts`'s generic-500 +
  `console.error` was produced by an impl-review that explicitly rejected `(err as Error).message` as
  a response body (`context/archive/2026-06-02-ai-car-chat/reviews/impl-review.md:80-88`, fixed in
  `50833b5`). Finding 3's 20 sites are that same defect, already adjudicated once in this repo.
- **`src/test/pages/api/ai/chat.test.ts` has eight exact-shape `toEqual({ error: "…" })` assertions**
  at lines 91, 98, 105, 112, 119, 128, 138, 163. Adding _any_ field to the error envelope — `code`,
  `requestId` — breaks all eight. This is why the envelope stays `{ error: "<generic literal>" }`.
- **`e2e/cross-user-data-isolation.spec.ts:99` requires a genuine `404`** for a foreign entry id. A
  careless 500-split breaks it; the `z.uuid()` path-param guard is what keeps it passing.
- `AppLayout.astro:40` exposes a `<slot />`, so `cars.astro` can render `<Banner variant="error">`
  locally without touching `Layout.astro`. `getT(lang)` is already imported at `cars.astro:6,9`.
- `eslint.config.js:15` is `strictTypeChecked` — a caught `err` is `unknown`, so narrowing needs a
  real type guard, not a cast. `eslint.config.js:79` disables `no-misused-promises` for `.astro`
  files, which matters for Phase 6.

## What We're NOT Doing

- **Not applying the three unapplied migrations** (`CHECK (mileage > 0)` ×4, `insurer NOT NULL`,
  `result NOT NULL`). Their codes `23502`/`23514` are mapped as 400s so the boundary is
  forward-compatible, but the schema change and the `insurer`/`result` zod-vs-`types.ts` contradiction
  stay a separate concern.
- **Not touching `src/pages/api/auth/signin.ts:16` and `signup.ts:16`**, which push raw Supabase auth
  messages into the query string. Same defect class, different subsystem, out of scope by decision.
- **Not adding a `code` field to the response envelope.** It would break the eight `toEqual`
  assertions and hand the client detail it has no use for.
- **Not fixing i18n for API errors.** Clients do `json.error ?? t("common.anErrorOccurred")`, so the
  translated fallback only fires when `error` is absent — sending a generic English literal keeps it
  dead, exactly as today. Fixing that is a separate change. (New i18n keys in Phase 6 are for the SSR
  banner only, which is server-rendered through `getT` and does not go through this mechanism.)
- **Not refactoring `src/pages/api/ai/chat.ts`'s existing catch blocks** (`:43-50`, `:54-73`). They
  already log and propagate correctly. Phase 6 adds a guard around the unprotected `getCarById` call
  at `:38` and nothing else.
- **Not adding alerting, Logpush, Tail Workers, Sentry, or `tail_consumers`.** Workers Logs is
  pull-only and that is accepted; no config change is needed.
- **Not using `Astro.locals.runtime`** — removed in `@astrojs/cloudflare` v13 — and not using
  `ctx.waitUntil()` to flush logs. A synchronous `console.error` before `return` is flushed.
- **Not changing any success-response envelope.** Their non-uniformity was a deliberate prior decision
  (**D5**).
- **Not making CI run `npm test`.** Out of compliance with `test-plan.md:152`, but not this change's job.

## Implementation Approach

Bottom-up, in dependency order: the error _shape_ before the error _mapping_ before the _call sites_.

Phase 1 gives the service layer a typed error and moves absence out of the error channel. Phase 2
builds the single place that decides what an error code means in HTTP and what gets logged. Phases 3–5
rewire the API routes onto it. Phase 6 does the same for the SSR boundary, where the residual bug is
worst — the failure path currently redirects to a page that itself cannot survive the failure.

Each phase leaves the tree green: lint, `astro check`, and `npm test` all pass at every phase
boundary, because `.husky/pre-commit` runs all three and will refuse the commit otherwise.

## Critical Implementation Details

**PostgREST error status is not a reliable field.** The mapping keys on `code` alone, never on an
HTTP status read off the error object. `PostgrestError`'s typed surface is `code`/`message`/`details`/`hint`;
a `status` property is present on some supabase-js versions and not others, and under
`strictTypeChecked` reading an untyped property is a lint error. `ServiceError` preserves the four
typed fields and nothing else — every row of the Layer-1 table is keyed by `code`, including
transport faults, which arrive with `code: ""`.

**Ordering within Phase 1 matters for the build.** Changing `updateCar` to return `Car | null` and
`deleteCar` to return `boolean` breaks the typecheck at `src/pages/api/cars/[id].ts:66` and `:97`. The
minimal call-site adaptations must land in the same phase, or the phase closes red.

**Editing `chat.ts` at all fires a repo hook.** `.claude/settings.json` defines an "R1 tripwire"
`PostToolUse` hook that re-runs both AI specs whenever `ai.ts`, `chat.ts`, or either spec is edited —
so Phase 6's one-line guard immediately runs the eight `toEqual` envelope assertions. That is a
feature here: it is the fastest possible confirmation that the envelope is intact.

**`.astro` frontmatter has a lint exemption that Phase 6 depends on.** `eslint.config.js:79` disables
`no-misused-promises` for `.astro` files because the parser crashes on top-level `return Astro.redirect()`.
Phase 6 edits exactly those frontmatter catches; do not "fix" the returns.

---

## Phase 1: Service Error Contract

### Overview

Introduce `ServiceError`, convert all 24 flattening throw sites to it, and move absence out of the
error channel by converting `.single()` + `PGRST116`-string-match to `.maybeSingle()` + `!res.data`.
Fix the three latent service bugs found alongside. After this phase the error channel of every
service function contains faults and nothing else.

### Changes Required:

#### 1. The error type

**File**: `src/lib/services/errors.ts` (new)

**Intent**: Give the service layer a single error type that preserves what PostgREST said, so routes
have something to branch on. It must be HTTP-ignorant — the service layer knows about databases, not
status codes.

**Contract**: Export `class ServiceError extends Error` carrying readonly `code: string`,
`details: string | null`, `hint: string | null`, and the originating `op: string` (the service
function name, for log attribution). Export a factory that builds one from a PostgREST error object
plus an `op` label, and a type guard `isServiceError(e: unknown): e is ServiceError`.

The guard is load-bearing: under `strictTypeChecked` a caught `err` is `unknown`, and `instanceof`
alone is the correct narrowing — no casts anywhere in the consuming code. Set `name = "ServiceError"`
so a serialized log line is self-identifying.

#### 2. Cars service

**File**: `src/lib/services/cars.ts`

**Intent**: Replace all five `throw new Error(res.error.message)` sites with `ServiceError`, and fix
the two functions whose behavior is wrong independent of error handling.

**Contract**: Four distinct changes:

- `getCarById` (`:10-17`): `.single()` → `.maybeSingle()`; drop the `PGRST116` string comparison; the
  body becomes `if (res.error) throw …; if (!res.data) return null;`. Return type is unchanged
  (`Car | null`), so no call site moves.
- `updateCar` (`:25-29`): add the missing `.eq("user_id", userId)` filter (the signature gains a
  `userId: string` parameter), switch to `.maybeSingle()`, and widen the return to `Car | null` so
  "no such car" is absence rather than a thrown coercion error.
- `deleteCar` (`:31-34`): add `.eq("user_id", userId)` (signature gains `userId`) and `.select("id")`,
  return `boolean` for whether a row was actually deleted. Mirrors `deleteRepairEntry`
  (`entries.ts:261-265`), which already does this.
- `getCars` (`:4-8`) and `createCar` (`:19-23`): throw-site swap only.

> **⚠️ Conflicts with `context/changes/data-isolation-crud-integrity/plan.md`.** That change
> deliberately _keeps_ `updateCar` and `deleteCar` missing their `user_id` filter, on the grounds that
> adding one would short-circuit ahead of RLS and leave the policy layer unproven — the asymmetry is
> what its R3 tests are designed to exercise. This plan adds those filters. **The two are mutually
> exclusive and must be reconciled before either phase is implemented.** The likely resolution is that
> the isolation tests assert on RLS through a client that bypasses the service layer, freeing the
> service to carry defense in depth — but that is a decision, not an assumption, and neither plan
> should be implemented until it is made.

#### 3. Entries service

**File**: `src/lib/services/entries.ts`

**Intent**: Same throw-site swap across ~19 sites, the same `.maybeSingle()` conversion for the four
update functions, and null guards on the six unchecked `res.data` dereferences.

**Contract**: Three groups:

- All `if (res.error) throw new Error(res.error.message)` → `ServiceError` (lines 27, 42, 58, 76, 92,
  110, 126, 151, 176, 197, 216, 235, 254, 263, 273, 283, 293, 341-343, 413-416).
- `updateRepairEntry` / `updateOilChangeEntry` / `updateInspectionEntry` / `updateInsuranceEntry`
  (`:183-257`): drop the `if (res.error?.code === "PGRST116") return null` line, switch `.single()` →
  `.maybeSingle()`, and return `null` on `!res.data`. External return types are unchanged.
- Guard `res.data` before dereferencing at `:264, :274, :284, :294` (`.length`) and in the aggregate
  functions at `:341-347` and `:413-430` (indexing). Treat a `null` data with no error as an empty
  result, not a crash.

`getEntryById` (`:145-152`) is already correct except for its throw site — leave its structure alone.

#### 4. Route call-site adaptations

**File**: `src/pages/api/cars/[id].ts`

**Intent**: Keep the typecheck green after `updateCar` and `deleteCar` change signatures. This is the
minimum needed to close the phase; the full route rewrite is Phase 3.

**Contract**: Pass `user.id` to both calls (`:66`, `:97`); handle `updateCar` returning `Car | null`
with a 404 on null; handle `deleteCar` returning `false` with a 404. Leave the `catch` blocks and the
`.catch(() => null)` swallows exactly as they are — Phase 3 owns those.

#### 5. Unit tests

**File**: `src/test/lib/services/errors.test.ts` (new)

**Intent**: Lock the error type's contract before anything depends on it.

**Contract**: Assert that the factory preserves `code`, `message`, `details`, `hint` and `op`; that a
transport-fault error (`code: ""`) round-trips with an empty code rather than being coerced; that
`isServiceError` narrows a `ServiceError` and rejects a plain `Error`, a string, and `null`; and that
`instanceof Error` still holds (so any existing `catch (err)` handling is not broken by the change).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Unit tests pass: `npm test`
- New error-type tests pass: `npx vitest run src/test/lib/services/errors.test.ts`
- No `throw new Error(res.error.message)` remains: `grep -rn "throw new Error(res\|throw new Error(oilRes\|throw new Error(inspRes\|throw new Error(insRes\|throw new Error(repairRes" src/lib/services/` returns nothing
- No `.single()` paired with a `PGRST116` string match remains: `grep -rn "PGRST116" src/lib/services/` returns nothing

#### Manual Verification:

- Existing app flows still work end to end: list cars, create, edit, delete, and the entry CRUD for all four entry types
- Deleting a car still clears the `selected_car_id` cookie and the sidebar updates
- No regression in the dashboard or entries pages, which call these services during SSR

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful before proceeding to the
next phase.

---

## Phase 2: The Mapping Layer

### Overview

Build the one place that decides what a database error code means in HTTP and what the operator sees.
Nothing consumes it yet — this phase is the helper plus its full test coverage, so Phases 3–6 are pure
wiring.

### Changes Required:

#### 1. The API error helper

**File**: `src/lib/api-errors.ts` (new)

**Intent**: Convert an unknown caught value into a logged, mapped `Response`. This is the route layer's
counterpart to `ServiceError` — it is the only module in the codebase that knows a `22P02` is a client
fault and a `57014` is not.

**Contract**: Three exports.

A pure mapper from an error code to a `{ status, message }` pair, implementing this table exactly:

| Code                                    | Status | Client message        |
| --------------------------------------- | ------ | --------------------- |
| `22P02` malformed uuid                  | 400    | `Invalid request`     |
| `22008` bad date                        | 400    | `Invalid request`     |
| `22003` numeric out of range            | 400    | `Invalid request`     |
| `23502` not-null violation              | 400    | `Invalid request`     |
| `23514` check violation                 | 400    | `Invalid request`     |
| `23503` FK violation                    | 404    | `Not found`           |
| `42501` RLS denial                      | 401    | `Unauthorized`        |
| `PGRST301` JWT failure                  | 401    | `Unauthorized`        |
| `PGRST116` (>1 row under `maybeSingle`) | 500    | `Server error`        |
| `PGRST204` schema cache                 | 500    | `Server error`        |
| `57014` statement timeout               | 503    | `Service unavailable` |
| `""` transport/DNS/abort                | 503    | `Service unavailable` |
| anything else                           | 500    | `Server error`        |

A structured logger that emits **a single object** — never a string plus a second argument, which
Cloudflare does not merge into indexed fields:

```ts
console.error({
  event: "api_error", // constant: one query returns every failure app-wide
  route, // e.g. "/api/entries/repair"
  op, // the service function that failed
  method, // HTTP verb
  userId, // may be undefined
  status, // the status we are about to return
  code, // "" for transport faults
  message, // err.message — operator only
  details, // PostgREST details — operator only, may contain a full row
  hint,
});
```

`details` **must never** reach the response body: `23502`'s details carries the entire failing row
including `user_id`.

And a `Response`-returning convenience that composes the two, so a route's catch block is one line.
A caught value that is not a `ServiceError` (a genuine JS `TypeError`, a thrown string) maps to
500 `Server error` and logs with `code: ""` — it must never throw from inside the error handler.

#### 2. Lint configuration

**File**: `eslint.config.js`

**Intent**: Allow the logging this change is built on, without scattering twenty
`// eslint-disable-next-line no-console` comments that quietly discourage the pattern they enable.

**Contract**: `"no-console": "warn"` at `:23` becomes `"no-console": ["warn", { "allow": ["error"] }]`.
`console.log` stays warned. The existing per-site disable comments in `chat.ts` become redundant;
leave them for now — Phase 6 touches that file and can drop them there.

#### 3. Mapper unit tests

**File**: `src/test/lib/api-errors.test.ts` (new)

**Intent**: The table is the specification. Every row gets a test, because the whole change is worth
nothing if a code silently falls through to the default branch.

**Contract**: One assertion per table row (13 cases). Plus four properties that matter more than the
individual rows:

- A `ServiceError` whose `message` contains Postgres text (e.g. a constraint or policy name) produces
  a response body that does **not** contain it.
- `details` never appears in the body.
- A non-`ServiceError` input (plain `Error`, string, `null`, `undefined`) yields 500 and does not throw.
- No mapping produces `404` except `23503` — this is the assertion that encodes the entire point of
  the change.

Spy on `console.error` to assert the logged value is a single object with `event: "api_error"` and the
expected `code`. Note this is the first `console` spy in the repo; `test-plan.md:225-228` had
deliberately deferred that, and this is the narrow case where it is worth it.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Mapper tests pass: `npx vitest run src/test/lib/api-errors.test.ts`
- Full suite passes: `npm test`
- Every table row is covered: the test file contains one case per code in the mapper's table

#### Manual Verification:

- Reading `src/lib/api-errors.ts` alongside the table above, confirm no code is missing and no status
  disagrees with the decisions recorded in the plan brief

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful before proceeding to the
next phase.

---

## Phase 3: Cars API Routes

### Overview

The original finding. Split fault from absence at the three `.catch(() => null)` sites, validate the
path parameter so a malformed uuid stays a 4xx, and route the four cars-side raw echoes through the
new helper.

### Changes Required:

#### 1. Car detail route

**File**: `src/pages/api/cars/[id].ts`

**Intent**: Make `404` mean exactly one thing. Today a dead database, an RLS misconfiguration, and a
malformed uuid all answer `404 {"error":"Not found"}` with no server-side trace.

**Contract**: For both `PATCH` (`:48`) and `DELETE` (`:91`):

- Validate `context.params.id` with `z.uuid()` before use, returning 400 on failure. This is what
  keeps a malformed id a client fault rather than surfacing as a newly-introduced 500 — and it is
  what keeps `e2e/cross-user-data-isolation.spec.ts:99` passing, since that spec uses a well-formed
  foreign uuid and must still receive a genuine 404.
- Replace `.catch(() => null)` with a real `try`/`catch`: the catch delegates to the Phase 2 helper;
  a `null` return still yields `404 { error: "Not found" }`.
- The two raw-echo catches at `:69` (PATCH) and `:105` (DELETE) delegate to the helper.

The `} catch { … "Invalid JSON" … }` block at `:56` is already correct — leave it.

#### 2. Car selection route

**File**: `src/pages/api/cars/[id]/select.ts`

**Intent**: Same split at the third swallow site (`:23`).

**Contract**: `z.uuid()` on the path param → 400; `try`/`catch` around `getCarById` delegating to the
helper; `if (!car)` → 404. This route currently imports no zod; it will.

#### 3. Car collection route

**File**: `src/pages/api/cars/index.ts`

**Intent**: Stop echoing Postgres text on the two collection endpoints.

**Contract**: The catches at `:44` (GET) and `:77` (POST) delegate to the helper. The GET one is
UI-invisible — `CarList.tsx:70,80` discards its message — so it is the safest site in the change; the
POST one is rendered in the DOM at `CarForm.tsx:226`.

#### 4. Route tests

**File**: `src/test/pages/api/cars/[id].test.ts` (new)

**Intent**: Prove the wiring, not just the mapper. Phase 2 tests that a `22P02` maps to 400; this
tests that the route actually calls the mapper — which is exactly what the original code got wrong.

**Contract**: Extend the `makeContext` recipe from `src/test/pages/api/ai/chat.test.ts:44-56`. Note
that `cars/*` routes self-authenticate via `supabase.auth.getUser()` rather than reading
`locals.user`, so the Supabase mock needs an `auth.getUser` layer that `chat.test.ts` does not have.

Assert, with `getCarById` mocked:

- Mock resolves `null` → **404** (absence still works)
- Mock rejects with a `ServiceError` code `22P02` → **400**, not 404
- Mock rejects with a `ServiceError` code `""` (transport fault) → **503**, not 404
- Mock rejects with a `ServiceError` whose message contains Postgres text → that text is absent from
  the body
- A malformed path param never reaches `getCarById` → **400**, and the service mock was not called

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- New route tests pass: `npx vitest run src/test/pages/api/cars`
- Full suite passes: `npm test`
- No swallows remain in the cars routes: `grep -rn "catch(() => null)" src/pages/api/cars/` returns nothing
- No raw echoes remain in the cars routes: `grep -rn "(err as Error).message" src/pages/api/cars/` returns nothing
- E2E isolation spec still passes: `npx playwright test e2e/cross-user-data-isolation.spec.ts`

#### Manual Verification:

- Editing and deleting your own car still works from the UI, and the success paths are unchanged
- Requesting a car id belonging to another user still yields 404 with no hint the id exists
- Requesting a malformed id (e.g. `/api/cars/abc`) yields 400, not 404 and not 500
- With the local Supabase stack stopped, a car edit yields 503 and a structured line appears in the
  dev console — the failure this change exists to make visible

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful before proceeding to the
next phase.

---

## Phase 4: Entries API Routes

### Overview

The bulk of the leak: 16 raw-echo catches across four files, twelve of which render straight into the
DOM. Plus the 403/404 convention, which the repo currently gets both ways.

### Changes Required:

#### 1. All four entry routes

**Files**: `src/pages/api/entries/repair.ts`, `oil-change.ts`, `inspection.ts`, `insurance.ts`

**Intent**: Route every catch through the helper, and settle the ownership-failure status on 404.

**Contract**: Per file, four catch blocks (GET, POST, PATCH, DELETE — e.g. `repair.ts:45, :85` and
the PATCH/DELETE equivalents) delegate to the Phase 2 helper. The `} catch { … "Invalid JSON" … }`
blocks are already correct and stay.

Separately, the foreign-`car_id` response changes from `403 { error: "Forbidden" }` to
`404 { error: "Not found" }` — one site per file (`repair.ts:75`, `inspection.ts:86` and the two
siblings). This adopts the reviewed **D3** anti-enumeration decision uniformly across the API and
matches what the cars routes already do. The four GET catches are UI-dead (entry lists are
SSR-hydrated from `entries.astro:38-49`), so only the POST/PATCH/DELETE changes are user-visible.

These routes already validate ids with `z.uuid()` (`repair.ts:7-8,11`), so `22P02` is unreachable
here — no path-param work is needed.

#### 2. Route tests

**File**: `src/test/pages/api/entries/repair.test.ts` (new)

**Intent**: Cover one entry route thoroughly rather than four shallowly — all four are structurally
identical, and the `makeContext` recipe transfers as-is because these routes read `locals.user` exactly
like `chat.ts`.

**Contract**: Assert a foreign `car_id` (mocked `getCarById` → `null`) yields **404**, not 403; that a
`ServiceError` from `createRepairEntry` maps by code rather than to a blanket 500; and that no response
body contains the mocked Postgres message.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- New entry-route tests pass: `npx vitest run src/test/pages/api/entries`
- Full suite passes: `npm test`
- No raw echoes remain anywhere in the API: `grep -rn "(err as Error).message" src/pages/api/` returns nothing
- No 403 remains in the entry routes: `grep -rn "Forbidden" src/pages/api/entries/` returns nothing
- E2E suite passes: `npx playwright test`

#### Manual Verification:

- Creating, editing, and deleting entries of all four types still works from the UI
- Forcing a failure (stop the local Supabase stack, then submit an entry form) shows a generic message
  in the form's error paragraph — no table, column, or constraint names on screen
- The structured log line for that failure names the correct `route` and `op`

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful before proceeding to the
next phase.

---

## Phase 5: Validator Tightening

### Overview

Two validators look strict but let bad input reach Postgres, where it becomes a 500. Two refinements
turn them into 400s at the right layer — the cheapest correctness win in the change.

### Changes Required:

#### 1. Date and mileage validation

**Files**: `src/pages/api/entries/repair.ts`, `oil-change.ts`, `inspection.ts`, `insurance.ts`

**Intent**: Reject impossible dates and out-of-range mileage locally instead of round-tripping to the
database to be told. Beyond the status code, this preserves the signal that test-plan risk **R5**
reads — validation enforced independently of the client.

**Contract**: Two changes applied across all eight schemas (a create and a patch schema per file):

- `conducted_at`'s `/^\d{4}-\d{2}-\d{2}$/` regex accepts `2026-02-30`, which Postgres rejects with
  `22008`. Add a refinement that the string is a real calendar date, not merely well-shaped. Keep the
  existing `"Date must be YYYY-MM-DD"` message for shape failures so no current test or UI string
  changes; the refinement needs its own message.
- `mileage`'s `z.number().int().min(0)` has no upper bound, so `99999999999` reaches Postgres and
  returns `22003`. Add a `.max()` bounded by the column's integer range.

Note the schemas also permit `mileage: 0`, which an unapplied migration would reject with `23514`.
That contradiction is out of scope by decision; `23514` is already mapped as a 400 in Phase 2, so the
boundary is ready for it.

#### 2. Validator tests

**File**: `src/test/pages/api/entries/repair.test.ts` (extend)

**Intent**: Lock both refinements, since they are the kind of thing a future schema edit silently
reverts.

**Contract**: `conducted_at: "2026-02-30"` → 400 and the service mock was never called; `mileage:
99999999999` → 400, likewise. Both currently produce 500s, so these tests fail before the change and
pass after — the clearest red-to-green signal in the plan.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Validator tests pass: `npx vitest run src/test/pages/api/entries`
- Full suite passes: `npm test`
- E2E suite passes: `npx playwright test`

#### Manual Verification:

- Submitting an entry form with a valid date still works for every entry type — including a leap day
  (`2028-02-29`), which must be accepted
- Submitting `2026-02-30` via the API yields 400 with a field-specific message rather than 500

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful before proceeding to the
next phase.

---

## Phase 6: SSR Boundary

### Overview

The five SSR catches log nothing and bounce the user to `/cars?error=load_failed`, a parameter no page
reads. Worse, `/cars` itself has no error handling — so the fault that bounced the user hits `getCars`
on arrival and produces Astro's raw 500 page. This phase fixes the operator half (structured logs),
the user half (a translated banner), and the structural bug (the error path leading to a page that
cannot survive the error).

### Changes Required:

#### 1. Guard the redirect target

**File**: `src/pages/cars.astro`

**Intent**: This is the priority fix of the phase. `/cars` is where every SSR failure sends the user,
and it is the one page with no error handling at all.

**Contract**: Wrap the `getCars` call at `:16` in `try`/`catch`. On failure, log via the Phase 2
structured logger and render the page with an empty car list plus the error banner, rather than
redirecting (a redirect to itself would loop). Then read `Astro.url.searchParams.get("error")` and
render `<Banner variant="error">` above the `CarList` when either the local catch fired or the param
is present. `AppLayout` exposes a `<slot />`, so the banner goes inside `cars.astro`'s own markup —
`Layout.astro` and `AppLayout.astro` are not touched. `getT(lang)` is already imported at `:6,9`.

#### 2. Log the five silent catches

**Files**: `src/pages/dashboard.astro` (`:26-34`), `src/pages/entries.astro` (`:28-32`, `:39-49`),
`src/pages/entries/[type]/[id].astro` (`:26-30`, `:39-45`)

**Intent**: A catch that neither logs nor tells the user anything is invisible from both ends.

**Contract**: Each `} catch {` becomes `} catch (err) {` with a structured log call before the
existing `return Astro.redirect("/cars?error=load_failed")`. The redirect target and query parameter
stay as they are — they now mean something, because `cars.astro` reads them. Do not restructure the
top-level `return Astro.redirect(...)` calls; `eslint.config.js:79` exempts `.astro` files from
`no-misused-promises` precisely because the parser cannot handle them.

#### 3. Guard the two remaining unprotected service calls

**Files**: `src/pages/ai-chat.astro` (`:21`), `src/pages/api/ai/chat.ts` (`:38`)

**Intent**: Both call `getCarById` with an unvalidated `selected_car_id` cookie — client-settable
regardless of `httpOnly` — and neither has a handler, so a malformed value produces an uncaught throw
and a raw Astro 500.

**Contract**: `ai-chat.astro` gets the same catch-log-and-redirect treatment as the five above.
`chat.ts:38` gets a `try`/`catch` delegating to the Phase 2 helper. Its two existing catch blocks
(`:43-50`, `:54-73`) are correct and stay untouched; their now-redundant `eslint-disable` comments can
be dropped since Phase 2 allowed `console.error`.

Be aware that editing `chat.ts` triggers the repo's R1 tripwire hook, which immediately re-runs both
AI specs including the eight `toEqual` envelope assertions. Those must stay green — the guard adds a
new failure path but changes none of the tested ones.

#### 4. Banner copy

**Files**: `src/i18n/locales/en.json`, `src/i18n/locales/pl.json`

**Intent**: The banner is server-rendered through `getT`, so unlike the API envelope it can be
translated today at no cost.

**Contract**: One new key pair under the existing `common` namespace (alongside `networkError` and
`anErrorOccurred` at `:23-24`) for the load-failure message — something that tells the user their data
could not be loaded and to try again, without naming a cause. Both locales must be updated together;
`pl.json` is not optional.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Full suite passes: `npm test` — in particular the eight `toEqual` assertions in `src/test/pages/api/ai/chat.test.ts`
- No silent SSR catch remains: `grep -rn "} catch {" src/pages/*.astro src/pages/entries` returns nothing
- Both locales have the new key: `grep -c "<new key>" src/i18n/locales/en.json src/i18n/locales/pl.json` returns 1 for each
- Build succeeds: `npm run build`
- E2E suite passes: `npx playwright test`

#### Manual Verification:

- With the local Supabase stack stopped, visiting `/dashboard` redirects to `/cars` and the error
  banner is visible there — rather than the raw Astro 500 page that appears today
- The same flow in Polish (`pl`) shows Polish banner text
- Setting `selected_car_id` to a malformed value (e.g. `abc`) in devtools and loading `/ai-chat` and
  `/dashboard` produces a handled redirect, not an uncaught 500
- The structured log lines for all of the above are single objects with `event: "api_error"` and a
  correct `route`
- Normal navigation with a healthy database shows no banner anywhere

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- **Error type** (`src/test/lib/services/errors.test.ts`): field preservation including the empty-code
  transport case, `isServiceError` narrowing against non-errors, `instanceof Error` still holding.
- **Mapper** (`src/test/lib/api-errors.test.ts`): one case per table row; Postgres text absent from
  bodies; `details` never in a body; non-`ServiceError` inputs yield 500 without throwing; **no
  mapping yields 404 except `23503`**.
- **Route wiring** (`src/test/pages/api/cars/[id].test.ts`, `src/test/pages/api/entries/repair.test.ts`):
  that the routes actually call the mapper — `null` → 404, `22P02` → 400, `""` → 503, foreign `car_id`
  → 404, malformed path param → 400 without touching the service.
- **Validators** (extending the repair route tests): impossible date and out-of-range mileage → 400.

Harness: extend `makeContext` from `chat.test.ts:44-56`. Entry routes read `locals.user` and transfer
directly; `cars/*` routes self-authenticate via `supabase.auth.getUser()` and need one extra mock layer.

### Integration Tests:

None added. The existing E2E suite is the integration layer, and Phase 2 of the test-plan rollout
(`context/changes/data-isolation-crud-integrity/`) owns cross-user integration coverage — it is
researched but unplanned, so it will be written against the corrected behavior this change ships.

### Manual Testing Steps:

1. With a healthy database, exercise every CRUD path for cars and all four entry types — confirm no
   behavior changed on the success paths.
2. Stop the local Supabase stack (`npx supabase stop`), then: edit a car (expect 503, not 404), load
   `/dashboard` (expect a redirect to `/cars` showing the banner, not a raw 500), and submit an entry
   form (expect a generic message, no Postgres text).
3. `curl` a malformed car id (`/api/cars/abc`) — expect 400.
4. `curl` a well-formed car id belonging to another user — expect 404 with no signal the id exists.
5. Set `selected_car_id` to `abc` in devtools; load `/dashboard` and `/ai-chat` — expect handled
   redirects.
6. Switch to Polish and repeat step 2's dashboard case — expect a Polish banner.
7. Read the dev console output for each failure above: one object per failure, `event: "api_error"`,
   correct `route` and `op`, and `details` present in the log but absent from every response body.

## Performance Considerations

Negligible. The mapper is a synchronous lookup, and `console.error` is a synchronous call flushed
before `return` — no `waitUntil` is needed or wanted.

Two small wins: `.maybeSingle()` avoids the error-construction path PostgREST takes for `PGRST116` on
absence, and Phase 5's validator tightening removes two round-trips to Postgres for input that can be
rejected locally.

Workers Logs is at 100% sampling with `observability.enabled: true` already set. Adding ~38 log sites
raises volume only on the failure path, well inside the 200k logs/day Free-tier allowance for an app
at this traffic level.

## Migration Notes

No database migration. The three unapplied migrations (`CHECK (mileage > 0)`, `insurer NOT NULL`,
`result NOT NULL`) stay out of scope; their codes `23502` and `23514` are mapped as 400s so the
boundary is ready when they land.

No rollback plan is needed beyond `git revert` — the change is additive at the helper level and
mechanical at the call sites, with no data or schema effect.

**Two behavioral changes are user-visible and worth calling out at review time:**

1. Foreign `car_id` on entry POST changes from `403` to `404` (4 sites). No test asserts the old
   status, but the change is deliberate and should be recorded — this is the clearest `/10x-lesson`
   candidate in the change, since the repo currently does it both ways and the plan that introduced
   the 403 contradicts itself.
2. Failures that previously returned `404` or a raw-message `500` now return `400`/`401`/`404`/`503`
   as mapped. Any consumer relying on "everything is a 404 or a 500" would notice; there are none
   today.

## References

- Change identity: `context/changes/swallowed-error-propagation/change.md`
- Research (per-boundary decision table, probed failure modes): `context/changes/swallowed-error-propagation/research.md`
- Plan brief: `context/changes/swallowed-error-propagation/plan-brief.md`
- The house pattern this generalizes: `src/pages/api/ai/chat.ts:43-50`
- **D1** — generic 500 body, rejecting `(err as Error).message`: `context/archive/2026-06-02-ai-car-chat/reviews/impl-review.md:80-88`
- **D2** — logging mandated, a silent catch is invisible: `context/archive/2026-06-01-ai-integration-scaffold/reviews/impl-review.md:83-88`
- **D3** — 404 not 403, anti-enumeration: `context/archive/2026-06-02-ai-car-chat/reviews/impl-review.md:23-31`
- **D6** — "null from a service means 404", the assumption this change repairs: `context/archive/2026-06-03-entry-management/plan.md:23,30,52`
- **D7** — the zero-row DELETE precedent behind the `deleteCar` fix: `context/archive/2026-06-03-entry-management/reviews/impl-review.md:29-30`
- The correct in-repo shape to converge on: `src/lib/services/entries.ts:145-152`
- Test harness recipe: `context/foundation/test-plan.md:192-231`; live example at `src/test/pages/api/ai/chat.test.ts:44-56`
- Risks this serves: `context/foundation/test-plan.md:50-51` (R2 secret leakage, R3 IDOR), `:53,86` (R5 server-side validation)
- Downstream phase landing on top of this: `context/changes/data-isolation-crud-integrity/research.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Service Error Contract

#### Automated

- [ ] 1.1 Type checking passes: `npx astro check`
- [ ] 1.2 Linting passes: `npm run lint`
- [ ] 1.3 Unit tests pass: `npm test`
- [ ] 1.4 New error-type tests pass: `npx vitest run src/test/lib/services/errors.test.ts`
- [ ] 1.5 No `throw new Error(res.error.message)` remains in `src/lib/services/`
- [ ] 1.6 No `PGRST116` string match remains in `src/lib/services/`

#### Manual

- [ ] 1.7 Existing app flows work end to end (cars CRUD, all four entry types)
- [ ] 1.8 Deleting a car still clears the `selected_car_id` cookie and updates the sidebar
- [ ] 1.9 No regression on the dashboard or entries pages

### Phase 2: The Mapping Layer

#### Automated

- [ ] 2.1 Type checking passes: `npx astro check`
- [ ] 2.2 Linting passes: `npm run lint`
- [ ] 2.3 Mapper tests pass: `npx vitest run src/test/lib/api-errors.test.ts`
- [ ] 2.4 Full suite passes: `npm test`
- [ ] 2.5 Every table row is covered by a test case

#### Manual

- [ ] 2.6 Mapper reviewed against the plan's table — no missing code, no disagreeing status

### Phase 3: Cars API Routes

#### Automated

- [ ] 3.1 Type checking passes: `npx astro check`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 New route tests pass: `npx vitest run src/test/pages/api/cars`
- [ ] 3.4 Full suite passes: `npm test`
- [ ] 3.5 No `catch(() => null)` remains in `src/pages/api/cars/`
- [ ] 3.6 No `(err as Error).message` remains in `src/pages/api/cars/`
- [ ] 3.7 E2E isolation spec passes: `npx playwright test e2e/cross-user-data-isolation.spec.ts`

#### Manual

- [ ] 3.8 Own-car edit and delete still work from the UI
- [ ] 3.9 Foreign car id still yields 404 with no existence hint
- [ ] 3.10 Malformed car id yields 400, not 404 and not 500
- [ ] 3.11 With Supabase stopped, a car edit yields 503 and logs a structured line

### Phase 4: Entries API Routes

#### Automated

- [ ] 4.1 Type checking passes: `npx astro check`
- [ ] 4.2 Linting passes: `npm run lint`
- [ ] 4.3 New entry-route tests pass: `npx vitest run src/test/pages/api/entries`
- [ ] 4.4 Full suite passes: `npm test`
- [ ] 4.5 No `(err as Error).message` remains anywhere in `src/pages/api/`
- [ ] 4.6 No `Forbidden` remains in `src/pages/api/entries/`
- [ ] 4.7 E2E suite passes: `npx playwright test`

#### Manual

- [ ] 4.8 Entry create, edit, delete work for all four types
- [ ] 4.9 A forced failure shows a generic message — no table, column, or constraint names on screen
- [ ] 4.10 The structured log line names the correct `route` and `op`

### Phase 5: Validator Tightening

#### Automated

- [ ] 5.1 Type checking passes: `npx astro check`
- [ ] 5.2 Linting passes: `npm run lint`
- [ ] 5.3 Validator tests pass: `npx vitest run src/test/pages/api/entries`
- [ ] 5.4 Full suite passes: `npm test`
- [ ] 5.5 E2E suite passes: `npx playwright test`

#### Manual

- [ ] 5.6 Valid dates still accepted for every entry type, including a leap day (`2028-02-29`)
- [ ] 5.7 `2026-02-30` yields 400 with a field-specific message, not 500

### Phase 6: SSR Boundary

#### Automated

- [ ] 6.1 Type checking passes: `npx astro check`
- [ ] 6.2 Linting passes: `npm run lint`
- [ ] 6.3 Full suite passes: `npm test`, including the eight `toEqual` assertions in `chat.test.ts`
- [ ] 6.4 No `} catch {` remains in the SSR pages
- [ ] 6.5 Both locales carry the new banner key
- [ ] 6.6 Build succeeds: `npm run build`
- [ ] 6.7 E2E suite passes: `npx playwright test`

#### Manual

- [ ] 6.8 With Supabase stopped, `/dashboard` redirects to `/cars` and the banner is visible
- [ ] 6.9 The same flow in Polish shows Polish banner text
- [ ] 6.10 A malformed `selected_car_id` cookie produces handled redirects on `/ai-chat` and `/dashboard`
- [ ] 6.11 Every failure logs a single object with `event: "api_error"` and a correct `route`
- [ ] 6.12 Normal navigation with a healthy database shows no banner
