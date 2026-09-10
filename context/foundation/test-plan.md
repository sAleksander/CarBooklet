# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-08-25 (Phase 2 complete)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression. For CarBooklet this has a concrete edge: the AI chat is
   the headline-fear surface, but its _answer quality_ is the model's job —
   test the deterministic envelope (right car grounded, ownership enforced,
   no key leak, input validated, visible progress), never the LLM's prose.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data. Here the interview
   put the top fear (AI leaks/misgrounds) and the lowest-confidence area
   (the AI chat path) on the same surface — that is why it is Phase 1.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/components/entries/`,
`src/pages/api/`, `src/lib/services/`, `src/middleware.ts` (last 30 days,
50 commits — sufficient signal).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #   | Risk (failure scenario)                                                                                                                                     | Impact | Likelihood | Source (evidence — not anchor)                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1   | AI chat answers grounded in the **wrong car**, or a user steers the assistant to a car they do not own                                                      | High   | High       | interview Q1 + Q3; PRD Success Criteria (grounded answer must be the user's car); hot-spot dir `src/lib/services/` (17 commits/30d) |
| 2   | **OpenRouter API key / secrets leak** into logs, error response bodies, or the client bundle                                                                | High   | Medium     | interview Q1; PRD Guardrails (data isolation, minimal data); hot-spot dir `src/pages/api/` (27 commits/30d)                         |
| 3   | **Cross-user data access (IDOR)** — a user reads, edits, or deletes another user's car or entry by id                                                       | High   | High       | PRD Access Control "data isolation is unconditional"; abuse lens (authorization); hot-spot dir `src/pages/api/` (27 commits/30d)    |
| 4   | **Auth bypass** — an unauthenticated request reaches a protected page or API route, including the new `/entries/[id]`                                       | High   | Medium     | PRD Access Control + prd-v2 Constraints; roadmap S-03 guard note; `src/middleware.ts` churn (6 commits/30d)                         |
| 5   | **Entry/car CRUD regression** — edit/delete corrupts or wipes data, or server-side validation (mileage, not-null) is not enforced independent of the client | Medium | High       | prd-v2 Guardrails FR-007/FR-008; abuse lens (untrusted input); hot-spot dir `src/components/entries/` (65 commits/30d) + migrations |
| 6   | **AI progress-feedback regression** — no continuous visible feedback during streaming response (PRD names its absence a regression)                         | Medium | Medium     | PRD NFR "AI query feedback"; prd-v2 Secondary success criterion (loading state)                                                     |

**Impact × Likelihood rubric.** Score both axes on a coarse High / Medium /
Low scale so two readers agree on the same row. Do not invent finer
gradations — the goal is ordering, not false precision.

| Rating | Impact                                                          | Likelihood                                               |
| ------ | --------------------------------------------------------------- | -------------------------------------------------------- |
| High   | user loses access, data, or money; failure is publicly visible  | area changes weekly, or we have already been burned here |
| Medium | feature degrades, a workaround exists, only some users affected | touched occasionally, has been a source of bugs          |
| Low    | cosmetic, easily reverted, no data effect                       | stable code, rarely touched                              |

Order is by impact × likelihood; protect High × High first (R1, R3).
Resource abuse — mass calls against the `openrouter/free` model — is a real
exposure but belongs to rate-limiting / observability, not a unit test; it
is recorded in §7 rather than padding this map.

**Abuse / security lens.** CarBooklet has auth and accepts free-text user
input, so the map carries three abuse scenarios on the same two axes:
authorization/IDOR (R3), secret leakage (R2), and untrusted-input /
server-side validation parity (folded into R5; the AI free-text surface is
covered by R1's grounding + R2's leakage rows). No abuse class with a real
surface is left unrepresented.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                                                                             | Must challenge                                                                              | Context `/10x-research` must ground                                                                                        | Likely cheapest layer                           | Anti-pattern to avoid                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| #1   | Chat endpoint loads only the _owned_ selected car; a foreign/selected car id the user does not own resolves to nothing (e.g. 404), never to another user's car; the system prompt is built from that owned car's fields | "the `user.id` filter on the car lookup is enough, and the selected-car id is trustworthy"  | Where the selected-car id originates (cookie / `locals`), how ownership is enforced on lookup, how the prompt is assembled | integration (API route) + unit (prompt builder) | asserting the LLM's answer text; mirroring the prompt string instead of asserting which car's data it draws from |
| #2   | No error path, log line, or response body emits the OpenRouter key; the secret stays server-only                                                                                                                        | "`astro:env/server` import means it can never leak"                                         | Error-handling and logging paths in the chat route + AI service; what reaches the client on failure                        | integration                                     | over-mocking the AI client so the real error/response body is never asserted                                     |
| #3   | Every car/entry route rejects reads, updates, and deletes of ids the caller does not own                                                                                                                                | "authenticated == authorized"                                                               | RLS policies + the per-query user filter on each car/entry operation                                                       | integration (vs Supabase local / RLS)           | testing only the owner's happy path; trusting RLS without exercising a second user                               |
| #4   | Protected routes redirect (or 401) without a valid session, including `/entries/[id]`; API routes reject unauthenticated calls                                                                                          | "`startsWith` matching in middleware covers every protected path and the new dynamic route" | `PROTECTED_ROUTES` matching logic + whether the detail route is actually guarded                                           | middleware unit / integration                   | brittle full-page snapshot; testing redirect for one route and assuming the rest                                 |
| #5   | Create/edit/delete enforce ownership and server-side validation (mileage check, not-null constraints) regardless of client input                                                                                        | "client-side zod equals server-side enforcement"                                            | zod schemas at the API edge + DB constraints as the independent oracle                                                     | integration                                     | oracle copied from the handler under test (tautology); over-mocking the DB so constraints never fire             |
| #6   | The user sees continuous progress from submit through to streamed response                                                                                                                                              | "HTTP 200 means the user saw feedback"                                                      | The streaming response wiring and the UI's loading-state transitions                                                       | one Playwright e2e                              | `waitForTimeout`; asserting answer content instead of the presence of progress                                   |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| #   | Phase name                      | Goal (one line)                                                                                                                                   | Risks covered | Test types         | Status      | Change folder                                  |
| --- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------ | ----------- | ---------------------------------------------- |
| 1   | Bootstrap + AI chat envelope    | Stand up the test runner and prove the chat endpoint grounds only on the owned car, guards auth / no-car / invalid input, and never leaks the key | #1, #2        | unit + integration | complete    | context/changes/testing-bootstrap-ai-chat/     |
| 2   | Data isolation + CRUD integrity | Every car/entry route rejects non-owned ids; create/edit/delete enforce ownership + server-side validation                                        | #3, #5        | integration        | complete    | context/changes/data-isolation-crud-integrity/ |
| 3   | Auth & route protection         | Protected routes redirect/401 without a session, including `/entries/[id]`                                                                        | #4            | unit + integration | not started | —                                              |
| 4   | E2E critical path + CI gate     | One browser flow (sign-in → navigate → ask AI → see visible progress → grounded answer) and wire the suite into CI                                | #6            | e2e + gates        | complete    | context/changes/pre-demo-fixes/                |

**Status vocabulary** (fixed — parser literals):

| Value           | Meaning                                                             |
| --------------- | ------------------------------------------------------------------- |
| `not started`   | No change folder for this rollout phase yet.                        |
| `change opened` | `context/changes/<id>/` exists with `change.md`; research not done. |
| `researched`    | `research.md` exists in the change folder.                          |
| `planned`       | `plan.md` exists with a `## Progress` section.                      |
| `implementing`  | Progress section has at least one `[x]` and at least one `[ ]`.     |
| `complete`      | Progress section is fully `[x]`.                                    |

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.

**Current test base: `none`** — no test-runner config, no test dependencies
in `package.json`, and zero `*.test.*` / `*.spec.*` files. The project has a
test _culture_ of none; Phase 1 bootstraps the runner before any assertion
is written.

| Layer                 | Tool                                            | Version                | Notes                                                                                                     |
| --------------------- | ----------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------- |
| unit + integration    | Vitest                                          | 3.2.6                  | Vite-native; aligns with the Astro + `@tailwindcss/vite` build already in the repo                        |
| API / network mocking | MSW (or OpenAI client stub at the network edge) | none yet — see Phase 1 | Mock the OpenRouter HTTP edge only; never mock internal services                                          |
| Supabase integration  | local Supabase stack (`npx supabase start`)     | n/a                    | Real Postgres + RLS for Phase 2 isolation tests; do not mock the DB for IDOR coverage                     |
| e2e                   | Playwright                                      | 1.61.1                 | Project's stated E2E path (CLAUDE.md `/10x-e2e`); DOM-snapshot default, vision only for visual-only risks |
| (optional) AI-native  | not adopted                                     | n/a                    | LLM answer quality is out of scope (§7); no vision/AI-judge layer planned                                 |

**Stack grounding tools (current session):**

- Docs: no Context7 / framework-docs MCP exposed — not available in current session; relied on local manifests + repo config; checked: 2026-06-14
- Search: WebSearch / WebFetch available — not used for this initial write; reserve for verifying Vitest/Playwright setup against current Astro v6 + Cloudflare adapter docs at Phase 1; checked: 2026-06-14
- Runtime/browser: no Playwright MCP exposed; Playwright itself is the planned Phase 4 e2e tool via `/10x-e2e`; checked: 2026-06-14
- Provider/platform: Supabase MCP available (read/verify local DB + RLS) and Cloudflare Workers runtime — relevant to Phase 2 isolation tests and future CI gating; checked: 2026-06-14

Use docs MCPs for current framework/library APIs and setup details. Use
search MCPs for discovery or current status only, then prefer official docs
as the evidence. Do not use MCP docs/search to infer code failure anchors;
those belong in per-phase `/10x-research`.

## 5. Quality Gates

> **Corrected 2026-09-10 (`pre-demo-fixes`).** Three rows in this document were
> stale and are fixed above. §5 claimed typecheck was "already wired —
> husky/lint-staged + CI"; it was in the pre-commit hook only, and CI ran lint
> and build and nothing else. §5's unit + integration row had been in force
> since Phase 1 completed while neither suite ran on a PR. §4 listed Vitest and
> Playwright as "none yet" long after both were in the repo. CI now runs
> typecheck, unit + client, integration (Docker Supabase) and e2e; `deploy`
> gates on the first three but deliberately not on e2e. R6's spec exists and is
> stubbed — see `e2e/README.md` for why that one reverses the real-model rule.

The full set of gates that must pass before a change reaches production.
"Required for §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate                        | Where                | Required?                                       | Catches                                                |
| --------------------------- | -------------------- | ----------------------------------------------- | ------------------------------------------------------ |
| lint + typecheck            | local + CI           | required (wired — husky/lint-staged + CI)       | syntactic / type drift                                 |
| unit + integration          | local + CI           | required (wired — CI `ci` + `integration` jobs) | logic regressions, AI grounding, ownership, validation |
| e2e on critical flow        | CI on PR             | wired — CI `e2e` job (does not gate `deploy`)   | broken sign-in → navigate → AI progress path           |
| post-edit hook              | local (agent loop)   | optional                                        | regressions at edit time                               |
| visual diff (deterministic) | CI on PR             | optional                                        | rendering regressions (not prioritized — see §7)       |
| pre-prod smoke              | between merge + prod | optional                                        | Cloudflare edge / env-specific failures                |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase N."

### 6.1 Adding a unit test

Pattern established by Phase 1 (`src/test/lib/services/ai.test.ts`), for pure
TypeScript helpers like the prompt builder (R1 grounding):

- **Location mirrors source.** A spec for `src/lib/services/ai.ts` lives at
  `src/test/lib/services/ai.test.ts`. The `src/test/**/*.test.ts` glob in
  `vitest.config.ts` is what discovers it.
- **Export the helper, don't reach into the module.** `buildSystemPrompt` and
  `sanitise` were made `export`s purely so the unit test can call them
  directly. No behavior change — just widened visibility.
- **Oracle from the fixture, never the function (R1).** Build a fixture `Car`
  and assert the prompt `toContain`s the fixture's own field values. Never call
  `buildSystemPrompt` twice and compare outputs, and never assert the LLM's
  answer text (test-plan §1, R1 anti-pattern).
- **Sanitisation has teeth.** Feed a field a value with `\n` and a `\x01`
  control char; assert the prompt contains neither raw char and that the value
  survives as readable text (control chars collapsed to spaces). This is the
  prompt-injection-via-stored-field guard. Verify the test bites by temporarily
  making `sanitise` return its input unchanged — the case must fail.
- **Optional-omission.** With `engine_code` / `vin_number` null _or
  whitespace-only_ (the builder uses `?.trim()`), assert the `engine code:` /
  `VIN:` labels are absent.
- **No mocks needed.** The `astro:env/server` alias in `vitest.config.ts`
  satisfies `ai.ts`'s top-level OpenAI construction at import time.
- **Import vitest symbols explicitly** (`import { describe, it, expect } from
"vitest"`) — `globals` is off, which keeps eslint and tsconfig clean.

### 6.2 Adding an integration test (API route)

Pattern established by Phase 1 (`src/test/pages/api/ai/chat.test.ts`) for the
chat endpoint's guard table + key non-leak (R1/R2):

- **Invoke the real handler directly — no HTTP server.** Import `POST` from
  `@/pages/api/ai/chat` and call it with a hand-built context. The route reads
  only `locals.user`, `locals.selectedCarId`, `request.json()`/`headers`, and
  `cookies`, so a `makeContext()` helper that returns those fields
  `as unknown as APIContext` is enough. No miniflare, no Supabase.
- **Mock the boundary services, not the route.** `vi.mock` the three modules
  the route imports — `@/lib/supabase` (`createClient`), `@/lib/services/cars`
  (`getCarById`), `@/lib/services/ai` (`createChatStream`). Mocking the whole
  `ai`/`supabase` modules also stops their top-level side effects from running
  on import. Use `vi.mocked(fn)` to set per-test return values;
  `vi.resetAllMocks()` in `beforeEach`, then re-establish happy-path defaults.
- **Pin the full guard table.** One `it` per branch in route order: 401 (no
  user) → 400 (bad JSON: `json` rejects) → 400 (zod: assert the _first issue
  message_) → 400 (no car) → 503 (`createClient` null) → 404 (`getCarById`
  null) → 500 (`createChatStream` throws) → 200 (stream). Assert `res.status`
  and the parsed body.
- **"Dependency not called" is the R1 guard.** On the 404 foreign-car case,
  assert `expect(createChatStream).not.toHaveBeenCalled()` — ownership must
  short-circuit _before_ the model is touched, not merely return 404. On the
  200 case, assert `createChatStream` received the resolved owned `Car`.
- **Drain SSE with `res.text()`.** The success path returns
  `new Response(readable)`; `await res.text()` collects the frames. Assert it
  contains `data: {"text":"…"}` and `data: [DONE]`. Mock `createChatStream` to
  return a generator of `{ choices: [{ delta: { content } }] }` chunks — a
  **sync** `function*` works because the route consumes it with `for await`.
- **Key non-leak (R2) is a body assertion.** Make `createChatStream` throw
  `new Error("… sk-or-test-LEAK")`; assert status 500, body exactly
  `{ error: "AI service error" }`, and `JSON.stringify(body)` does **not**
  contain the secret. The route's `console.error` firing server-side is
  expected (R2 allows the secret in server logs) — don't suppress it; the
  stderr noise during the run is correct. Same for the mid-stream failure: the
  SSE carries `{"error":"Stream failed"}`, never the SDK detail.
- **Typing tip.** `res.json()` is `Promise<any>`; under `strictTypeChecked`,
  funnel it through a `readJson(res): Promise<unknown>` helper so the body is
  `unknown`, not `any`, before `expect`.

Phase 2 did **not** extend this section to the car/entry routes. It put R3/R5 at
the **service layer** against real Supabase + RLS instead — route tests would
have had to mock Supabase, which proves branching, not isolation, and an
isolation test against a stubbed database proves only that the stub agrees with
the test. See §6.3 for that pattern. What the routes still own — the zod edge —
is covered as pure functions in the Docker-free `unit` project
(`src/test/pages/api/schemas.test.ts`, §6.1 style), so the two halves of "does
the edge agree with the floor?" are testable independently.

### 6.3 Adding a Supabase isolation test

The R3/R5 pattern, established in rollout Phase 2
(`context/changes/data-isolation-crud-integrity/`). Read this before writing
any test that asks "can user B reach user A's row?".

**Where these specs live, and why.** Top-level `integration/`, not `src/test/`.
Two independent reasons: the suite needs the **service-role key**, and
`e2e/fixtures/env.ts` sets the rule that it "must never be imported by anything
under `src/`"; and `.husky/pre-commit` runs `npm test`, so a spec under
`src/test/**` would make Docker mandatory for every commit. `vitest.config.ts`
splits this by directory into two projects — `npm test` is the Docker-free
`unit` project, `npm run test:integration` is this one.

**Two real users, plus an admin client that never asserts.** `withTwoUsers()`
(`integration/fixtures/users.ts`) creates two email-confirmed users and hands
back an anon-key client per user carrying that user's own JWT, so PostgREST
evaluates `auth.uid()` for real. The service-role client has exactly three
jobs: create the users, delete them, and read back ground truth. **Never assert
through it** — it bypasses RLS, so standing it in for the user under test turns
every isolation check into a false pass.

**Seed through the owner's own client**, never through admin
(`integration/fixtures/seed.ts`). A seed that skips the INSERT policies can
land a row RLS would have rejected, and every test built on it then measures a
state the app cannot produce.

**Assert persisted state, not exceptions.** Under an RLS `USING` clause, a
cross-user UPDATE or DELETE matches zero rows — which is not an error. Whether
the caller sees one depends entirely on the service wrapper's tail, and this
codebase has _four different answers_:

| service                 | tail                 | what the attacker observes |
| ----------------------- | -------------------- | -------------------------- |
| `updateCar`             | `.select().single()` | throws (`PGRST116`)        |
| `deleteCar`             | bare `.delete()`     | nothing — silent `void`    |
| `update*Entry`          | `.single()`, mapped  | resolves to `null`         |
| `delete*Entry`          | `.select("id")`      | resolves to `false`        |
| any INSERT `WITH CHECK` | —                    | throws (`42501`)           |

So every destructive case must re-read the row **as its owner** and assert it
is byte-identical or still present. This was verified load-bearing: with the
cars DELETE policy made permissive, `deleteCar` still resolved without throwing
while the row was gone — a test written as `.rejects.toThrow()` would have
stayed green through a real breach. INSERT is the one exception: `WITH CHECK`
violations genuinely raise, so impersonation tests assert a rejection.

**Assert twice — through the service, and around it.** Service functions may
carry their own `user_id` filter (every function in `services/entries.ts` does),
which short-circuits _ahead_ of RLS. A service-only test then passes whether or
not the policy exists. Pair each case with a raw `client.from(table)…` call
carrying the attacker's JWT, which reaches the policy directly. Measured: with
`repair_entries` RLS fully permissive, only the raw and attacker-supplied-userId
cases went red — every service-path test stayed green.

**Also test the userId argument as attacker-controlled.** `getCarById(b.client,
aCar.id, a.id)` is the sharp case: the service's `.eq("user_id", userId)` filter
cannot refuse it, because B is asking for exactly the row that filter admits.
Only RLS says no.

**Always assert the pair.** "B cannot see A's row" is satisfied just as well by
a broken fixture that sees nothing at all. Every absence assertion needs a
presence assertion beside it — see `integration/harness.test.ts`, which exists
solely to prove the harness before any risk leans on it.

**One `describe.each` table, not four files.** The four entry types share an
identical query shape; hand-copied files drift, and the drift lands in whichever
type someone forgot to update.

**Guards and budget.** `integration/globalSetup.ts` refuses any non-localhost
`SUPABASE_URL` (these tests create and delete real users) and fails fast with
actionable text when the stack is down. `supabase/config.toml` caps sign-ins at
**30 per 5 minutes per IP** and `withTwoUsers()` spends two — so call it in
`beforeAll`, once per file, never in `beforeEach`. If the suite outgrows the
budget, raise the limit in config rather than pooling users across files.

**Prove the test bites.** A green isolation suite is exactly when to be
suspicious. Break the policy reversibly and confirm the right tests go red:

```sql
DROP POLICY "Users can view own cars" ON public.cars;
CREATE POLICY "Users can view own cars" ON public.cars FOR SELECT USING (true);
-- run the spec, then restore (or `npx supabase db reset`)
```

Note one Postgres subtlety found doing this: breaking the **UPDATE** policy
alone turns nothing red, because SELECT policies also gate the `WHERE`-clause
reads and the `RETURNING` of an UPDATE. The update cases only go red when
SELECT _and_ UPDATE are both permissive. An UPDATE-policy regression in
isolation is therefore not independently detectable at this layer.

### 6.4 Adding a middleware / route-protection test

- TBD — see §3 Phase 3 (unauthenticated redirect/401 across protected
  routes incl. `/entries/[id]` for R4).

### 6.5 Adding an e2e test

- TBD — see §3 Phase 4 (sign-in → navigate → AI progress feedback for R6;
  follow `/10x-e2e` rules — role/label locators, wait-for-state, no
  `waitForTimeout`).

### 6.6 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line note
here capturing anything surprising the rollout phase taught.)

**Phase 1 (Bootstrap + AI chat envelope):**

- Vitest 3 exits **1** on an empty suite by default; the bootstrap commit
  (runner up, no specs) needs `test.passWithNoTests: true` to satisfy a
  "green with no tests" gate.
- `astro:env/server` is a virtual module that doesn't exist in Vitest's Node
  runtime — `resolve.alias` it to `src/test/__mocks__/astro-env-server.ts`
  (non-empty placeholder secrets) _before_ any spec imports a service, or the
  import throws at module evaluation.
- A streaming mock can be a **sync** `function*`; `for await` accepts sync
  iterables. An `async function*` with no `await` trips
  `@typescript-eslint/require-await` under the repo's strict lint.

**Phase 2 (Data isolation + CRUD integrity):**

- **Cross-user writes have no single signature.** Research recorded "0 rows,
  silently, no error" — true in SQL, but the service wrappers transform it four
  different ways (throw / silent void / `null` / `false`). Assertions must be
  written per operation, and the persisted-state read-back is the only one that
  holds across all of them. See the table in §6.3.
- **A service-level `user_id` filter hides whether RLS works.** Measured: with
  `repair_entries` RLS fully permissive, every service-path test stayed green.
  Pair each case with a raw client call. This also dissolved a live conflict
  with `swallowed-error-propagation`, which wants to _add_ such a filter to
  `updateCar`/`deleteCar` as defense in depth — with the raw assertions in
  place, both changes can proceed.
- **The pre-commit trap.** `.husky/pre-commit` runs `npm test`; integration
  specs placed under the existing `src/test/**` glob would make Docker
  mandatory for every commit. Hence the `unit` / `integration` projects split
  in `vitest.config.ts`.
- **An IDOR write-vector at the DB.** All four entry INSERT policies checked
  `auth.uid() = user_id` and nothing else, so a user could attach an entry to
  someone else's `car_id`. Only the POST route's 403 pre-check stood in the way.
  Closed by `20260825000000_entry_insert_car_ownership.sql`. Worth noting the
  asymmetry: the injected row carries the attacker's `user_id`, so RLS hides it
  from the car's owner entirely — invisible to the victim is not the same as
  absent.
- **Three zod ↔ DB parity gaps**, all producing 500s from supported user
  actions. `mileage` was fixed at the edge (`.min(0)` → `.min(1)`; the
  constraint was right and 0 is meaningless); `insurer` and inspection `result`
  were fixed at the database (`DROP NOT NULL`; the forms send null and the list
  renders conditionally, so two earlier migrations had outrun the product).
  Direction matters more than the fix — decide it from the product's own
  evidence, not from whichever side is easier to edit.
- **A migration needs its own oracle.** `schemas.test.ts` proves zod accepts
  null — but zod accepted null _before_ `DROP NOT NULL` too, so reverting the
  migration left the whole suite green. Whenever a migration changes what the
  database accepts, assert it at the database.
- **The old 500s were leaking Postgres text** (`violates check constraint
"repair_entries_mileage_positive"`) straight to the client. That is §2 R2
  territory and belongs to `swallowed-error-propagation` Finding 3; Phase 2 only
  removed one route to it.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5, plus the
challenger pass). Future contributors should respect these unless the
underlying assumption changes.

- **LLM answer quality / correctness** — the assistant's prose is the
  model's responsibility and is non-deterministic. We test that it grounds
  on the right car and surfaces visible progress, never whether the answer
  is "good." Re-evaluate if the product adds a structured/graded AI output
  contract. (Source: Phase 2 interview Q1 vs Q5 framing.)
- **Visual / snapshot tests of static chrome** (sidebar, landing, layout) —
  brittle and low-signal for this UI-overhaul change. Re-evaluate if a
  visual regression actually ships to users. (Source: brief negative-space.)
- **Per-string i18n coverage** — asserting every EN/PL string individually.
  A smoke that the toggle switches locale and persists is enough.
  Re-evaluate if a third locale is added. (Source: brief negative-space.)
- **shadcn/ui internals** — vendored primitives are the library's tests, not
  ours. (Source: brief negative-space.)
- **Resource abuse / rate-limiting of the free AI model** — real exposure,
  but a rate-limit + observability concern, not a unit test. Re-evaluate if
  AI cost or abuse becomes a live problem. (Source: §2 abuse-lens note.)
  _Updated 2026-09-07 (`ai-chat-history`):_ the observability half now
  exists — a 429 from OpenRouter is logged as one flat `api_error` object
  carrying `x-ratelimit-remaining` / `x-ratelimit-reset`, and the user sees
  a translated "temporarily rate-limited" message rather than a generic
  error. An app-side per-user limiter is still **deliberately deferred**:
  the account cap is 50 requests/day and we have no usage data to size a
  per-user share against. Re-evaluate once those log lines have run long
  enough to show whether one user can starve the others. Note also that
  `GET /v1/key` does **not** expose the request-count cap (it reports
  dollar usage, which is zero for free models), so those 429 log lines are
  the only signal there is.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-14
- Stack versions last verified: 2026-06-14
- AI-native tool references last verified: 2026-06-14

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
