<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Pre-demo Hardening

- **Plan**: `context/changes/pre-demo-fixes/plan.md`
- **Scope**: All 7 phases (68/72 Progress rows complete; 4 pending by decision)
- **Date**: 2026-09-10
- **Verdict**: NEEDS ATTENTION (at review) → APPROVED (post-triage: 10 of 10 fixed)
- **Findings**: 0 critical, 7 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | FAIL    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

## Findings

### F1 — User enumeration survives in production; the fix holds only locally

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/lib/auth-errors.ts:82-84, :86; src/i18n/locales/en.json auth.errors.email_not_confirmed
- **Detail**: Phase 4's stated goal is that a wrong password and a non-existent account are indistinguishable, and `auth-errors.test.ts` asserts it. But `email_not_confirmed` is kept as its own code, defended in-code with "unreachable in this project's local config (`enable_confirmations = false`, supabase/config.toml:209)". That argument covers the local stack only. README.md:132 states Supabase requires email confirmation **by default** and tells the operator to switch it off manually — so on the deployed Worker the code is reachable, and one request per address distinguishes an existing-unconfirmed account (`?error=email_not_confirmed`) from an unknown one (`?error=invalid_credentials`). Still a strict improvement on reflecting `error.message` verbatim, but the headline claim is true in the environment it was tested in and false in the one F8 was written for.
- **Fix A ⭐ Recommended**: Map `email_not_confirmed` → `invalid_credentials` on the sign-in path only, keeping the distinct code for signup/confirm-email.
  - Strength: Closes the oracle unconditionally, independent of any dashboard toggle; one table entry.
  - Tradeoff: An unconfirmed user gets no actionable hint on sign-in.
  - Confidence: HIGH — the mapping table already collapses `user_banned` for exactly this reason.
  - Blind spot: Whether any flow relies on distinguishing the two today (none found).
- **Fix B**: Keep the code, record the production `enable_confirmations` value in deploy-plan.md and assert it.
  - Strength: Preserves the actionable message.
  - Tradeoff: The guarantee rests on a dashboard setting nothing enforces.
  - Confidence: MEDIUM — depends on operator discipline.
  - Blind spot: No integration test reaches the cloud project.
- **Decision**: FIXED via Fix A — `mapAuthError` now takes a `surface`; `email_not_confirmed` collapses into `invalid_credentials` on sign-in and stays distinct on signup. Three new tests pin it.

### F2 — A server-failed AI turn is announced as "Answer interrupted"

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/ai/ChatThread.tsx:183; src/components/hooks/useConversation.ts:129-138, :141-153
- **Detail**: On a non-OK response (500/404/429) and on a fetch rejection the hook clears `pending` **without** calling `commitPending`, so no assistant message is appended and the transcript ends on the user's own turn. `terminalAnnouncement` then takes the `last?.role !== "assistant"` branch and announces `aiChat.interrupted` — telling a screen-reader user _they_ stopped the answer when the server actually failed. Partly mitigated because the error line is also `role="status"`, but the new region contradicts it. Introduced by this change; no test covers the path.
- **Fix**: Pass `error` into `terminalAnnouncement` and prefer `errorMessage(error, t)` when `error !== null`; add a component test for the 500 path.
  - Strength: Uses state the component already holds; makes the two `role="status"` nodes agree.
  - Tradeoff: Couples the announcer to `error`, which an SSE error frame can set without ending the turn — ordering needs care.
  - Confidence: HIGH — both code paths read directly.
  - Blind spot: Whether announcing both regions at once is more confusing than either alone.
- **Decision**: FIXED — `terminalAnnouncement` takes `error` and prefers `errorMessage(error, t)`. Two component tests added; verified by deliberate break (exactly those two fail when the check is removed).

### F3 — Phase 7 did not correct test-plan.md:97-100 as its contract required

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md:100
- **Detail**: plan.md:754-757 required correcting `:128` **and `:97-100`**, and "Mark Phase 4's CI-gate half as landed." `:125`/`:128` were fixed; the §3 rollout table was not touched. Row 4 still reads `not started` with folder `—`, though the CI gate landed in Phases 1-3 and the R6 spec in Phase 6 — so the row is now more wrong than before the change. Cause: the Python replacement for that row had no assertion and silently no-opped while its siblings succeeded.
- **Fix**: Set row 4's Status to `complete` and its Change folder to `context/changes/pre-demo-fixes/`.
- **Decision**: FIXED — row 4 now reads `complete` with the change folder.

### F4 — .env.example now routes a deploy-capable Cloudflare token into the e2e web server

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: .env.example:12-16; playwright.config.ts:4, :58-59
- **Detail**: Phase 7 tells contributors to put a wrangler-authenticating token in `.env`. `playwright.config.ts:4` calls `process.loadEnvFile()`, so `.env` enters the Playwright process and is inherited by `webServer` — which Phase 3 just switched to `npm run build && npm run preview`, a wrangler-backed server. The config's own comment says the command it replaced "is implicated in the 2026-09-07 version_upload to the live Worker". Handing live deploy credentials to the replacement runs against the point of the change.
- **Fix**: Add `env: { CLOUDFLARE_API_TOKEN: "" }` to the `webServer` block, or document the token as shell-session-only rather than `.env`.
  - Strength: Two lines; keeps the token available to wrangler while denying it to the test server.
  - Tradeoff: None material.
  - Confidence: HIGH — `webServer.env` is a documented Playwright option.
  - Blind spot: Whether `astro preview` ever needs Cloudflare auth (it did not in any run here).
- **Decision**: FIXED — `webServer.env` blanks `CLOUDFLARE_API_TOKEN`.

### F5 — zod field-level 400 messages collapsed to one generic string

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/http-error-copy.ts:20-30
- **Detail**: The module reasons only about the five fixed English literals `api-errors.ts` sends. But the converted routes also return zod-derived 400 bodies that are not fixed literals — `src/pages/api/cars/index.ts:73` ("Brand is required", "Production year is required"), `src/pages/api/entries/repair.ts:37,66` ("Date must be YYYY-MM-DD"), `"Invalid JSON"`. All fourteen sites now collapse these to `common.invalidRequest`. Net win for i18n, real loss of field-level specificity, and the module's rationale does not acknowledge it. Low practical impact because the forms validate client-side first.
- **Fix**: State the trade-off in the docstring; optionally have routes send a machine code plus field name so detail can be restored later.
- **Decision**: FIXED — the trade-off is now stated in the module docstring, naming the zod routes and the condition under which it would need revisiting.

### F6 — A red e2e job in CI produces no debuggable artifact

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: playwright.config.ts:18, :24; .github/workflows/ci.yml e2e job
- **Detail**: `trace: "on-first-retry"` with `retries: 0` means a trace is never captured — the two settings cancel out. `screenshot: "only-on-failure"` writes to `test-results/`, and the job has no `actions/upload-artifact` step, so those die with the runner. The job added to guard the demo yields only reporter lines when it fails. The plan flagged this ("if the planner wants CI artifacts, trace must become retain-on-failure") and scoped it out; Phase 3 left it.
- **Fix**: `trace: process.env.CI ? "retain-on-failure" : "on-first-retry"`, plus an `if: failure()` upload of `test-results/` and `playwright-report/`.
- **Decision**: FIXED — `trace: retain-on-failure` on CI, plus an `if: failure()` artifact upload of `test-results/` and `playwright-report/`.

### F7 — The R6 spec's held route is never released on assertion failure

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: e2e/ai-progress.spec.ts:67-78, :93
- **Detail**: If any assertion between the stub and `release()` fails, the route handler stays parked on `await held` and `route.fulfill` is never called. Not a deadlock — the per-test timeout bounds it and fixture teardown still deletes the user — but the test burns the full timeout and the failure screenshot shows a pending request rather than the state under test.
- **Fix**: Wrap the three assertions in `try { … } finally { release(); }`.
- **Decision**: FIXED — the assertions are wrapped in `try/finally`.

### F8 — Several manual Progress rows were verified with scratch specs that were then deleted

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/pre-demo-fixes/plan.md Progress rows 5.6-5.7, 6.11-6.12, 7.9-7.17
- **Detail**: Those rows were verified by throwaway Playwright specs (`zz-scratch-*.spec.ts`) driven against a real browser, then removed. The verification happened and its output was read, but it left no artifact in the diff — the pattern this review exists to catch. A later reader cannot re-run the evidence. Rows 3.9 and 6.8-6.10 are correctly left unchecked with reasons in commit `c098595`.
- **Fix**: Record the scratch-spec approach and its observed results in `follow-ups/`, or promote the delete-flow walk into a real spec (which item 5 deliberately scoped out).
- **Decision**: FIXED — the scratch-spec method and its observed results are recorded in `follow-ups/review-fixes.md`, including the captured a11y structure dump and the two incidental findings from the delete-flow walk.

### F9 — Plan text is wrong in two places and contradicted by the code in a third

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: plan.md:139-141, :571-572, :418-419, :235
- **Detail**: Three separate documentation defects, none affecting behaviour. (a) The plan prescribes deriving the announcement "in a `useEffect`" twice, including as a Critical Implementation Detail; the code uses render-phase state adjustment instead, because `react-hooks/set-state-in-effect` blocks the prescribed route. Justified in-code, unrecorded in the plan. (b) plan.md:418-419 claims 3-level locale nesting is "a deliberate deviation" — false: 91 of 191 leaves on `main` were already depth 3. (c) plan.md:235's exclusion list names `inbucket`, which the CLI renamed to `mailpit` and would reject; the implementation correctly uses `mailpit` and also excludes `postgres-meta`.
- **Fix**: Add a short addendum to the plan recording the render-vs-effect reversal, strike the false nesting claim, and correct the exclusion list.
- **Decision**: FIXED — the false nesting claim and the stale exclusion list are corrected inline; the render-vs-effect reversal is recorded in a new plan Addendum, along with the e2e scope expansion and the F1 surface change.

### F10 — Dead `ErrorMapping.message` values in auth-errors, one a latent wrong-copy trap

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/auth-errors.ts:60-65, :99-110
- **Detail**: Reusing `ErrorMapping` forces a required `message`, but nothing reads it — no auth route returns a body, and `logApiError` logs `messageOf(err)`, never `mapping.message`. Five strings with no consumer. The trap: `email_exists` and `email_not_confirmed` both point at `BAD_REQUEST`, whose message is "Invalid credentials", so anyone who later starts logging or sending `mapping.message` ships visibly wrong copy on the signup form. Related, pre-existing: `src/test/client/useConversation.test.tsx` has the same missing-`cleanup()` problem the new component test had to solve.
- **Fix**: Use a local `{ status: number }` type in auth-errors, or log `mapping.message` so the values have a consumer; separately add `cleanup()` to the existing client test's `afterEach`.
- **Decision**: FIXED — `auth-errors.ts` uses a local `AuthMapping { status }`; `logApiError`'s third parameter is `{ status: number; message?: string }`, which every existing caller still satisfies. `cleanup()` added to `useConversation.test.tsx`.

## Also noted (not raised as findings)

- The failure-path log redaction (`ci.yml`) matches only `sb_secret_`/`sb_publishable_`; JWT-format (`eyJ…`) and S3 keys would pass through on a failed `supabase start`.
- `isAuthErrorCode` is one shared ten-member set, so `/auth/signin?error=not_configured` renders a signup/ops sentence on the sign-in card. Bounded to ten approved strings, but not zero.
- `useConversation.ts:220` still string-matches the server literal "Conversation not found" — the exact dependency `http-error-copy.ts` exists to remove, one directory away.
- `e2e/ai-progress.spec.ts` passes `?car=${id}` which nothing reads; selection comes from the cookie.
- `gotoHydrated`'s docstring says "every island", but `astro-island[ssr]` does not cover `client:only`.
- `locale-parity.test.ts` strips plural suffixes unconditionally; a real key ending in `_one`/`_other` could mask a missing sibling. No live collision today.
- `CarForm.tsx:88` and `CarList.tsx:57` parse the error body without `.catch()`, unlike the other twelve sites.

## Triage outcome (2026-09-10)

All ten findings fixed. Post-triage gate, run after the last fix:

| Check                          | Result                          |
| ------------------------------ | ------------------------------- |
| `npm run lint` / `lint:colors` | pass                            |
| `npm run typecheck`            | 0 errors, 0 warnings            |
| `npm test`                     | 491 passed / 19 files (was 486) |
| `npm run test:integration`     | 142 passed / 6 files            |
| `npm run test:e2e`             | 5 passed                        |
| `npm run build`                | clean, no sitemap warning       |

Dimension verdicts after triage: Plan Adherence PASS (F3 + F9), Scope Discipline
PASS, Safety & Quality PASS (F1, F2, F4, F5, F6, F7), Architecture PASS, Pattern
Consistency PASS (F10), Success Criteria PASS (F8).

Four Progress rows remain unchecked by decision: 3.9 (deliberate e2e break,
skipped — Phase 2 proved the same red path) and 6.8-6.10 (require a screen
reader reading aloud; the region's structure was verified in a browser instead).
