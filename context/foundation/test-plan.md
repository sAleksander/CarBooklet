# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-15 (Phase 1 complete)

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
| 2   | Data isolation + CRUD integrity | Every car/entry route rejects non-owned ids; create/edit/delete enforce ownership + server-side validation                                        | #3, #5        | integration        | planned     | context/changes/data-isolation-crud-integrity/ |
| 3   | Auth & route protection         | Protected routes redirect/401 without a session, including `/entries/[id]`                                                                        | #4            | unit + integration | not started | —                                              |
| 4   | E2E critical path + CI gate     | One browser flow (sign-in → navigate → ask AI → see visible progress → grounded answer) and wire the suite into CI                                | #6            | e2e + gates        | not started | —                                              |

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
| unit + integration    | Vitest                                          | none yet — see Phase 1 | Vite-native; aligns with the Astro + `@tailwindcss/vite` build already in the repo                        |
| API / network mocking | MSW (or OpenAI client stub at the network edge) | none yet — see Phase 1 | Mock the OpenRouter HTTP edge only; never mock internal services                                          |
| Supabase integration  | local Supabase stack (`npx supabase start`)     | n/a                    | Real Postgres + RLS for Phase 2 isolation tests; do not mock the DB for IDOR coverage                     |
| e2e                   | Playwright                                      | none yet — see Phase 4 | Project's stated E2E path (CLAUDE.md `/10x-e2e`); DOM-snapshot default, vision only for visual-only risks |
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

The full set of gates that must pass before a change reaches production.
"Required for §3 Phase N" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate                        | Where                | Required?                                         | Catches                                                |
| --------------------------- | -------------------- | ------------------------------------------------- | ------------------------------------------------------ |
| lint + typecheck            | local + CI           | required (already wired — husky/lint-staged + CI) | syntactic / type drift                                 |
| unit + integration          | local + CI           | required after §3 Phase 1                         | logic regressions, AI grounding, ownership, validation |
| e2e on critical flow        | CI on PR             | required after §3 Phase 4                         | broken sign-in → navigate → AI progress path           |
| post-edit hook              | local (agent loop)   | optional                                          | regressions at edit time                               |
| visual diff (deterministic) | CI on PR             | optional                                          | rendering regressions (not prioritized — see §7)       |
| pre-prod smoke              | between merge + prod | optional                                          | Cloudflare edge / env-specific failures                |

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

Phase 2 extends this section with the car/entry routes (cross-user rejection +
server-side validation for R3/R5).

### 6.3 Adding a Supabase isolation test

- TBD — see §3 Phase 2 (second-user IDOR pattern against local Supabase +
  RLS for R3).

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

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-14
- Stack versions last verified: 2026-06-14
- AI-native tool references last verified: 2026-06-14

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
