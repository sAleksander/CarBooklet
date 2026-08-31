<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Propagate Swallowed Errors at the API and SSR Boundary

- **Plan**: `context/changes/swallowed-error-propagation/plan.md`
- **Scope**: Phases 1–6 (all)
- **Date**: 2026-08-27
- **Verdict**: NEEDS ATTENTION → **7 fixed, 3 queued, 1 partially resolved** (triaged 2026-08-27; F4 automated half closed 2026-08-31)
- **Findings**: 0 critical, 7 warnings, 3 observations

## Method and its limits

Two independent sub-agents (plan-drift; safety/quality/patterns) plus direct verification of every
load-bearing claim against source. All six phases were implemented by the same session that ran this
review, so it is **not an independent review** — the two agents and the re-verification exist to
compensate, but a human reviewer should weight F1 accordingly (a defect this change introduced, which
the implementer did not catch unaided).

Automated criteria at review time: `npx astro check` 0 errors (120 files), `npm run lint` exit 0,
`npm test` 289 passed / 8 files, `npm run build` complete. Every grep-based criterion passes.
Integration and E2E suites could not run — no Docker.

**Deliberate-break check** (evidence the new tests are not vacuous), each reverted after:

| Sabotage                                            | Tests failed |
| --------------------------------------------------- | ------------ |
| Map `57014` to 404 as well                          | 3            |
| Return `messageOf(err)` as the response body        | 19           |
| Weaken `z.uuid()` to `z.string()` on the path param | 2            |
| Make `isRealCalendarDay` always return true         | 46           |

## The core promise holds

Both agents independently traced all 34 service call sites in `src/pages`: every one sits inside a
`try` ending in `apiErrorResponse` or `logSsrError`; none is unwrapped. The only strings that can reach
a client are the five literals in `CODE_MAPPINGS`, zod-authored validation messages, and pre-existing
fixed literals. `Response.json({ error: mapping.message })` cannot interpolate `err`; `details`, `hint`
and `message` are read only inside `console.error`. `cars.astro` is not an XSS or open-redirect vector —
`?error=load_failed` is compared with `===` and never rendered.

Confirmed clean on specific questions asked: `userId` logged is always the caller's own uuid, never the
subject's, never in a body. The log is emitted exactly once per failure. No client breaks on the
changed statuses — the only status branch in the entire component tree is `res.status === 204` in
`EntryDetailEditor.tsx:60`, and `DELETE /api/entries/*` still returns 204. Every `ON DELETE CASCADE` FK
was checked, so no `RESTRICT`-based `23503` can be mis-answered as 404. No item in "What We're NOT
Doing" was violated.

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

## Findings

### F1 — `/cars` tells you that you have no cars when the database is down

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/cars.astro:25,43` → `src/components/cars/CarList.tsx:139`
- **Detail**: The Phase 6 guard leaves `cars = []` on failure and passes it to `CarList`, which renders
  `t("cars.noCars")` with a live "Add car" button beside the error banner. A transient `57014` that
  clears leaves the user able to create a duplicate of a car they already own. Introduced by this
  change, not inherited.
- **Fix**: Pass `loadFailed` into `CarList` and suppress the empty state and the add CTA when set.
- **Decision**: **FIXED** — `loadFailed` threaded into `CarList`; empty state and add-car CTA suppressed on failure. Passed `loadFailed` rather than `showError`, so a user redirected here after another page failed still sees their (healthy) list.

### F2 — `42501 → 401` may be the wrong mapping, and the comment's reasoning is inverted

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/api-errors.ts:74`
- **Detail**: The comment and the plan's research argue `42501`'s reachable sense is "the session died
  mid-request". A dead session cannot reach it: `getUser()` returns null and the route answers 401
  before touching PostgREST, and true JWT expiry surfaces as `PGRST301`, mapped separately. A live
  `42501` means a policy or `GRANT` misconfiguration — an operator error. Answering an authenticated
  user "Unauthorized" sends them to sign out and back in, which cannot help; no client has a 401
  handler.
- **Fix A ⭐ Recommended**: Map `42501 → 500`, keep `PGRST301 → 401`
  - Strength: Matches what the code actually signals — something the client cannot act on.
  - Tradeoff: Contradicts a decision the plan brief records as reviewed; needs comment + one test row.
  - Confidence: MED — reachability argument is sound, but a live `42501` cannot be exercised without Docker.
  - Blind spot: Whether a race between `getUser()` and the PostgREST call yields `42501` over `PGRST301`.
- **Fix B**: Leave as-is, correct the comment's justification
  - Strength: No behavior change; preserves the reviewed decision.
  - Tradeoff: Keeps a status that misdirects both user and operator.
  - Confidence: HIGH — purely editorial.
  - Blind spot: None significant.
- **Decision**: **FIXED via Fix A** — `42501 → 500`, `PGRST301 → 401` unchanged. Both route test files now assert the two codes separately so they cannot drift back together. Reversal recorded in `change.md` and annotated on the plan's Phase 2 table.

### F3 — `middleware.ts` still swallows exactly the error class this change exists to remove

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/middleware.ts:11-17`
- **Detail**: `const { data: { user } } = await supabase.auth.getUser()` discards `error`. supabase-js
  returns `AuthRetryableFetchError` in `error` rather than throwing, so an unreachable auth server sets
  `user = null` and line 30 redirects every protected route to `/auth/signin` — the whole app silently
  signs everyone out with zero server-side trace. Same shape as the `.catch(() => null)` this change was
  opened for. The plan never named this file, so it is a gap in the plan rather than a deviation.
- **Fix A ⭐ Recommended**: Capture `error` and `logSsrError` it before falling through
  - Strength: Three lines; gives the operator the signal distinguishing "everyone logged out" from
    "auth is down".
  - Tradeoff: Extends this change past its planned file set.
  - Confidence: HIGH — verified the destructure discards `error`.
  - Blind spot: User-facing behavior is unchanged either way.
- **Fix B**: Record as a follow-up change
  - Strength: Keeps scope exactly as planned.
  - Tradeoff: Ships a known instance of the defect the change is named after.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: **FIXED via Fix A** — `middleware.ts` captures `error` and calls `logSsrError`, excluding `AuthSessionMissingError` (verified at `auth-js/GoTrueClient.js:2497` that `getUser()` returns it for every anonymous request; logging unconditionally would have been a worse defect than the one fixed).

### F4 — Four automated E2E criteria and 13 manual rows never ran

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: Progress rows 1.5, 3.7–3.11, 4.7–4.10, 5.6–5.9, 6.7–6.12
- **Detail**: Every phase carries "pause here for manual confirmation before proceeding"; Phases 3, 4
  and 5 proceeded without those rows flipped. Static analysis is reassuring — no E2E spec asserts a
  status this change altered, and every seed date and mileage in `e2e/` and `integration/` passes the
  new validators — but that argued for running the suite, not for skipping it. Phase 4's 403→404 is
  precisely what the plan named E2E as protecting.
- **Fix**: `npx supabase start`, then `npm run test:integration && npx playwright test`, and work the
  manual rows.
- **Decision**: **AUTOMATED HALF RESOLVED (2026-08-31); manual rows still open.** The stack was started and both suites ran green against `27be677`, i.e. against the post-triage code, so the F1/F2/F3/F6/F7 fixes are now covered: `npm run test:integration` 119 passed / 5 files, `npm run test:e2e` 4 passed (setup + all three specs). Rows 3.7, 4.7, 5.6 and 6.7 are ticked. This closes the gap that mattered most — `integration/isolation-cars.test.ts` is the only oracle for the new `.eq("user_id", userId)` filters on `updateCar`/`deleteCar`, and it passes.
  The 15 manual rows (3.8–3.11, 4.8–4.10, 5.7–5.9, 6.8–6.12) were **not** walked and remain unchecked. They cover the operator-facing half this change exists for — the shape of the structured log line, and the Supabase-stopped banner/503 paths — none of which any automated suite asserts. Archived with that gap recorded rather than silently ticked.

### F5 — The plan still specifies six null guards that were deliberately skipped

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `plan.md:266-268`
- **Detail**: Phase 1 §3 bullet 3 still reads as contract. The skip rationale lives only in `change.md`,
  and no Progress row records it, so anyone reading the plan alone concludes the guards shipped. The
  skip itself is correct — supabase-js's discriminated union narrows `data` after the throw, and
  `no-unnecessary-condition` is error-level here.
- **Fix**: Strike the bullet in `plan.md` and point it at `change.md`'s entry.
- **Decision**: **FIXED** — the null-guard bullet is struck through in `plan.md` with its rationale, and the stale `42501` table row carries a blockquote naming the reversal. Both point at `change.md`.

### F6 — `logSsrError` is untested, and the status it logs is one no response carries

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/lib/api-errors.ts:167-179`
- **Detail**: Two costs of the fourth export added in Phase 6 (Phase 2 specified three). Seven call
  sites across five `.astro` pages and zero test coverage — the only export in the module the suite
  never touches. And it records a mapped status (e.g. 503) that no response carries: the user gets a 302
  or a 200 with a banner, so an operator querying `status:503` gets a mix separable only by `route`.
- **Fix**: Add two cases to `api-errors.test.ts` (ServiceError and non-ServiceError), and either log the
  real status or make the distinction visible beyond the docstring.
- **Decision**: **FIXED** — five test cases added for `logSsrError`, and every log line now carries `surface: "api" | "ssr"` so an operator filtering `status:503` can separate real 503 responses from SSR redirects.

### F7 — `isRealCalendarDay` runs on `NaN` when the shape check fails, and returns false by accident

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/validators.ts:28-37`
- **Detail**: Verified directly — zod runs `.refine` even when `.regex` fails, so `"01/01/2026"` yields
  two issues. The refinement executes on `[NaN]` with `month`/`day` undefined and returns `false` only
  because `undefined < 1`, `DAYS_IN_MONTH[NaN]` and `undefined <= undefined` are all falsy. Routes read
  `issues[0]`, so the user-facing message is correct today, but nothing holds that in place.
  Separately, `0000-01-01` and `0000-02-29` are accepted at the edge; Postgres has no year 0, so the
  module's stated goal of edge/database agreement is not quite met.
- **Fix**: Add `if (!Number.isFinite(month) || !Number.isFinite(day)) return false` and a year floor of
  `0001`.
- **Decision**: **FIXED** — explicit `Number.isFinite` guard and a year floor of `0001`, with tests for both plus one pinning that the shape error is reported first.

### F8 — `auth/signin.ts` and `signup.ts` reflect an unvalidated error string into the page

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/auth/signin.ts:16`, `src/pages/api/auth/signup.ts:16`
- **Detail**: Explicitly out of scope per "What We're NOT Doing", and that boundary was respected.
  Recorded for what it leaves behind: the GoTrue message goes into `?error=` unvalidated and
  `ServerError.tsx` renders it. React escapes it, so no XSS — but attacker-chosen text renders inside
  the app's own sign-in card on the real origin, a credible phishing surface. Neither route logs, so
  credential stuffing leaves no trace.
- **Fix**: Separate change — map GoTrue errors to codes (`?error=invalid_credentials`), translate
  client-side, route the real error through `logApiError`.
- **Decision**: **QUEUED** — `follow-ups/review-fixes.md`. Out of scope by plan decision; recorded with the phishing-surface and enumeration detail.

### F9 — `chat.ts` keeps the unqueryable log form, and can put an API key in Workers Logs

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/api/ai/chat.ts:55,72`
- **Detail**: Pre-existing and plan-protected. Two effects recorded: these are the last two
  string-plus-argument logs, the exact form `api-errors.ts` documents as unqueryable in Workers Logs;
  and the repo's own test output shows the caught value carrying a key —
  `[ai/chat] Service error: Error: 401 Invalid API key: sk-or-test-LEAK`. Response bodies are clean, the
  log is not. The Phase 2 eslint relaxation to `allow: ["error"]` removed the friction that would have
  surfaced these. Minor: four sites use bare `let car;` (evolving-any) where `cars.astro:25` and
  `[id].ts:70` annotate properly.
- **Decision**: **QUEUED** — `follow-ups/review-fixes.md`. Plan-protected. Noted that the secret-in-logs half likely warrants more than its OBSERVATION rating.

### F10 — API errors are English literals while the new SSR banner is translated

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/api-errors.ts:30-34`
- **Detail**: Plan-sanctioned, and strictly better than rendering English Postgres text. But this change
  added `common.loadFailed` to both locales for the banner, so a Polish user now sees a Polish banner on
  `/cars` and "Service unavailable" in a form. The asymmetry is new.
- **Decision**: **QUEUED** — `follow-ups/review-fixes.md`. Recorded with a fix shape (clients key off `res.status`) that avoids both of the plan's non-goals.

## Coverage gaps worth carrying forward

- The new `.eq("user_id", userId)` filters on `updateCar`/`deleteCar` are invisible to unit tests
  (`cars/[id].test.ts` mocks the whole service module). Their only oracle is
  `integration/isolation-cars.test.ts`, which has not been run since the change.
- `/api/cars/index.ts`, `/api/cars/[id]/select.ts` and three of the four entry routes have no
  route-level tests. `repair.test.ts` argues the four entry routes are structurally identical — true
  today, and the assumption a future divergence breaks silently.
