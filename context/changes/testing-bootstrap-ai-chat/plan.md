# Bootstrap Test Runner + AI Chat Envelope Implementation Plan

## Overview

Stand up the project's first test runner (Vitest) and prove the AI-chat
endpoint's deterministic envelope: it grounds only on the **owned** selected
car (R1) and never leaks the OpenRouter API key into a response body (R2).
This is rollout Phase 1 of `context/foundation/test-plan.md` — it bootstraps
the suite that Phases 2–4 build on. We test the envelope, never the LLM's
prose (test-plan §1, §7).

## Current State Analysis

- **Zero test infrastructure.** No `vitest.config.*`, no `*.test.*` files, no
  test dependency, no `test` script in `package.json` (`package.json:5-13`).
- **Chat route is well-guarded already** (`src/pages/api/ai/chat.ts:11-50`).
  The job of this phase is to *pin that contract against regression*, not to
  add safety the code lacks.
- **Ownership is enforced server-side.** `selected_car_id` rides an httpOnly
  cookie read by middleware into `locals.selectedCarId`; the route re-validates
  via `getCarById(supabase, id, user.id)` — a two-column `.eq("id").eq("user_id")`
  filter that returns `null` for a foreign id (`src/lib/services/cars.ts:10-17`).
  The car id never travels in the request body.
- **Key is server-only.** `OPENROUTER_API_KEY` is declared `context:"server"`
  (`astro.config.mjs:21`) and only imported in `src/lib/services/ai.ts:2`. All
  error response bodies in the route are literal strings.
- **`astro:env/server` is a virtual module** — it does not exist in Vitest's
  Node runtime. Importing any service that reads it (`ai.ts`, `supabase.ts`)
  throws `Cannot find module` unless aliased to a test double.
- **`buildSystemPrompt` and `sanitise` are private** in `ai.ts:13,18` — not
  exported. Research mis-stated them as ready unit targets; this plan exports
  them (approved decision) so the grounding test can assert them directly.

### Key Discoveries:

- Guard ordering in `src/pages/api/ai/chat.ts:11-50` is the contract the
  integration tests pin: 401 (no user) → 400 (bad JSON) → 400 (zod) → 400 (no
  car) → 503 (`createClient` null) → 404 (`getCarById` null) → 500
  (`createChatStream` throws) → 200 (SSE stream).
- `App.Locals` (`src/env.d.ts:1-7`) is small: `user`, `selectedCarId`, `lang`.
  The route reads only `locals.user`, `locals.selectedCarId`,
  `request.json()`, `request.headers`, `cookies` — so a test can call
  `POST(ctx)` directly with a hand-built context; no HTTP server / miniflare.
- The route's module-level imports to mock with `vi.mock`: `@/lib/supabase`
  (`createClient`), `@/lib/services/cars` (`getCarById`), `@/lib/services/ai`
  (`createChatStream`).
- Success path returns `new Response(readable)` (SSE). `await res.text()`
  drains the frames to a string for assertion. `createChatStream` is mocked to
  return an async generator of `{choices:[{delta:{content:"…"}}]}`.
- `wrangler.jsonc:7` sets `nodejs_compat` → Vitest `environment: "node"` is
  correct (not miniflare) for these unit/integration targets.
- Lint is `eslint .` (`package.json:11`) over all files including tests.
  Import vitest symbols explicitly (`import { describe, it, expect, vi } from
  "vitest"`) rather than relying on `globals: true` — avoids both eslint
  no-undef noise and a tsconfig `types` edit.

## Desired End State

`npm test` runs Vitest and passes. The suite contains:

- A unit spec proving `buildSystemPrompt` grounds on exactly the owned car's
  fields, sanitises control characters, and omits absent optional fields.
- An integration spec invoking the real `POST` handler that pins every guard
  in the chat route's contract, proves `createChatStream` is never reached for
  a foreign car, and proves a key-containing SDK error never reaches the
  response body.

`context/foundation/test-plan.md` §6.1 and §6.2 cookbook sections are filled
in with the patterns this phase established, and §3 Phase 1 status reflects
completion.

Verify: `npm test` exits 0 with the specs passing; `npm run lint` and
`npm run build` stay green.

## What We're NOT Doing

- **Not testing LLM answer quality / prose** — out of scope by test-plan §7.
- **Not spinning up Supabase / real DB** — R1 ownership is provable with a
  mocked `getCarById`; real-RLS IDOR coverage is §3 Phase 2's job (R3).
- **Not adding coverage tooling or thresholds** — deferred to §3 Phase 4 (CI
  gate). Only `vitest` is installed here.
- **Not adding React component tests** (no `happy-dom`/Testing Library) — the
  Phase 1 targets are pure TypeScript.
- **Not testing the cookie-set ownership endpoint** (`cars/[id]/select.ts`) —
  it belongs to the data-isolation surface (§3 Phase 2).
- **Not e2e / browser tests** — §3 Phase 4.
- **Not changing the chat route's behavior** — we pin it, we don't refactor it.

## Implementation Approach

Three phases, each a clean commit boundary:

1. **Bootstrap** — make `npm test` work with no assertions yet (runner +
   config + virtual-module alias + the two `export`s). A green "runner stands
   up" commit isolates infra churn from test logic.
2. **Unit (R1 grounding)** — the cheapest real signal: a pure function with a
   fixture-sourced oracle, no mocks.
3. **Integration (R1 envelope + R2 non-leak)** — invoke the real handler with
   mocked boundary services; pin the guard table and the key-non-leak contract.
   Final step backfills the test-plan cookbook (§6) and status (§3).

Test files live in a centralized `src/test/` tree mirroring `src/` (approved
decision). Mocks/doubles live under `src/test/__mocks__/`.

## Critical Implementation Details

- **`astro:env/server` alias is load-bearing and must exist before any spec
  imports a service.** `vitest.config.ts` `resolve.alias` must map both
  `@` → `./src` and `astro:env/server` → the test double. Without it, importing
  `ai.ts` (Phase 2) throws at module evaluation, before any test body runs.
- **Importing `ai.ts` evaluates `new OpenAI({apiKey})` at module top**
  (`ai.ts:5-11`). The aliased double must export a non-empty
  `OPENROUTER_API_KEY` string so the constructor does not throw during import.
- **`getCarById` returning `null` must short-circuit before `createChatStream`.**
  The foreign-car integration test asserts the mock `createChatStream` was
  **not called** — this is the R1 regression guard, not just the 404 status.
- **Oracle independence (R1).** Expected prompt substrings come from the test's
  own fixture `Car` object, never from calling `buildSystemPrompt` and
  re-asserting its output. Asserting the LLM's answer text is forbidden
  (test-plan §1, R1 anti-pattern).

## Phase 1: Bootstrap the test runner

### Overview

Install Vitest, configure it for this Astro/Cloudflare project, create the
virtual-module test double, and export the two pure helpers — so `npm test`
runs green with no test files yet.

### Changes Required:

#### 1. Test dependency + scripts

**File**: `package.json`

**Intent**: Add Vitest as the runner and expose `npm test`. Coverage tooling
is intentionally omitted (deferred to §3 Phase 4).

**Contract**: Add `vitest` to `devDependencies`. Add scripts `"test": "vitest
run"` and `"test:watch": "vitest"`. Pick the `vitest` major that aligns with
the repo's pinned `vite@^7` override (`package.json:62-64`).

#### 2. Vitest configuration

**File**: `vitest.config.ts` (new)

**Intent**: Configure a Node test environment with the path alias and the
virtual-module redirect that lets services import under test.

**Contract**: `defineConfig` from `vitest/config` with `test.environment:
"node"`, `test.include` covering `src/test/**/*.test.ts`. `resolve.alias` maps
`@` → `./src` (mirrors `tsconfig.json:7-9`) and `astro:env/server` → the test
double below. `globals` left off (specs import vitest symbols explicitly).

#### 3. `astro:env/server` test double

**File**: `src/test/__mocks__/astro-env-server.ts` (new)

**Intent**: Provide the same named exports the real virtual module would, so
service imports resolve and the OpenAI client constructs during test import.

**Contract**: Export `SUPABASE_URL`, `SUPABASE_KEY`, `OPENROUTER_API_KEY` —
each falling back to a non-empty placeholder when the matching `process.env`
var is unset. Matches the three keys in `astro.config.mjs:18-22`.

#### 4. Export the two pure helpers

**File**: `src/lib/services/ai.ts`

**Intent**: Make `buildSystemPrompt` and `sanitise` unit-testable directly
without widening behavior.

**Contract**: Add `export` to `function buildSystemPrompt` (`ai.ts:18`) and
`function sanitise` (`ai.ts:13`). No body changes. No other call sites change
(they are same-module callers).

### Success Criteria:

#### Automated Verification:

- Dependency installs: `npm install` completes.
- Runner starts green with no specs: `npm test` exits 0 (Vitest reports no test
  files, or passes if specs already exist).
- Linting passes: `npm run lint`.
- Build still passes: `npm run build`.

#### Manual Verification:

- `npm run test:watch` starts and watches without error.
- `git grep -n "export function buildSystemPrompt"` confirms the export landed.

**Implementation Note**: After automated verification passes, pause for human
confirmation of the manual steps before proceeding to Phase 2.

---

## Phase 2: Unit tests — AI chat grounding (R1)

### Overview

Prove `buildSystemPrompt` grounds the system prompt on exactly the owned car's
fields, sanitises hostile control characters, and omits absent optional fields.

### Changes Required:

#### 1. Grounding unit spec

**File**: `src/test/lib/services/ai.test.ts` (new)

**Intent**: Assert the deterministic prompt-construction contract from a
fixture car, with the oracle sourced from the fixture (not the function).

**Contract**: Build a fixture `Car` (all required fields + both optional
`engine_code`, `vin_number`). Cases:
- **All fields present** — output contains `production_year`, `brand`, `model`,
  `engine_type`, `engine_capacity`, `engine_power`, `engine_code`, `vin_number`
  values; the literal expected values come from the fixture.
- **Sanitisation** — a field value containing `\n` and a `\x01` control char
  yields a prompt with those replaced by spaces (no raw newline/control char in
  output). This is the prompt-injection-via-stored-field guard.
- **Optional omission** — with `engine_code` and `vin_number` null/empty, the
  prompt contains neither the `engine code:` nor `VIN:` label.

Import `buildSystemPrompt` from `@/lib/services/ai`; vitest symbols imported
explicitly. No mocks needed (the `astro:env/server` alias handles the module's
top-level OpenAI construction).

### Success Criteria:

#### Automated Verification:

- Unit spec passes: `npm test`.
- Linting passes: `npm run lint`.

#### Manual Verification:

- Temporarily break `sanitise` (return value unchanged) and confirm the
  sanitisation case fails — proves the test has teeth, not a tautology. Revert.

**Implementation Note**: After automated verification passes, pause for human
confirmation before proceeding to Phase 3.

---

## Phase 3: Integration tests — chat envelope (R1 + R2)

### Overview

Invoke the real `POST` handler with a hand-built context and mocked boundary
services; pin the full guard table, prove `createChatStream` is unreachable for
a foreign car (R1), and prove a key-containing SDK error never reaches the
response body (R2). Then backfill the test-plan cookbook and status.

### Changes Required:

#### 1. Chat-route integration spec

**File**: `src/test/pages/api/ai/chat.test.ts` (new)

**Intent**: Pin the chat route's request→response contract against regression
across auth, validation, ownership, and error-leak paths.

**Contract**: `vi.mock` `@/lib/supabase` (`createClient`), `@/lib/services/cars`
(`getCarById`), `@/lib/services/ai` (`createChatStream`). A helper builds a
mock context (`locals.user`, `locals.selectedCarId`, `request` with `json()` +
`headers`, `cookies`). Import `POST` from `@/pages/api/ai/chat`. Cases (assert
status + parsed JSON body, or SSE text):
- **401** — `locals.user = null` → `{error:"Unauthorized"}`.
- **400 invalid JSON** — `request.json()` rejects → `{error:"Invalid JSON"}`.
- **400 zod** — empty/over-2000-char prompt → first zod issue message.
- **400 no car** — `locals.selectedCarId = null` → `{error:"No car selected"}`.
- **503** — `createClient` returns `null` → `{error:"Service unavailable"}`.
- **404 foreign car** — `getCarById` resolves `null` → `{error:"Car not
  found"}`, **and `createChatStream` was not called** (R1 regression guard).
- **200 owned car** — `getCarById` returns the fixture car, `createChatStream`
  returns an async generator yielding one `{choices:[{delta:{content:"hi"}}]}`;
  `res.text()` contains `data: {"text":"hi"}` and `data: [DONE]`; assert
  `createChatStream` received the fixture car (grounded on the owned car).
- **500 + R2 non-leak** — `createChatStream` throws `new Error("401 Invalid
  API key: sk-or-test-LEAK")`; assert status 500, body exactly
  `{error:"AI service error"}`, and the body string does **not** contain
  `sk-or-test-LEAK`. (console.error firing server-side is expected, not
  suppressed.)
- **Mid-stream failure** — generator throws after the first chunk; SSE text
  contains `{"error":"Stream failed"}` then `[DONE]`, and contains no SDK
  error detail.

#### 2. Backfill the test-plan cookbook + status

**File**: `context/foundation/test-plan.md`

**Intent**: Record the patterns this phase established so `/10x-tdd` and future
phases reuse them, and advance the rollout status.

**Contract**: Replace §6.1 (unit) placeholder with the `buildSystemPrompt`
grounding pattern (fixture oracle, sanitisation, optional-omission; note the
exported-helper convention). Replace the §6.2 (integration / API route) Phase-1
portion with the direct-`POST`-invocation + `vi.mock` boundary-services pattern
(mock context shape, SSE `res.text()` assertion, "assert dependency not called"
guard, key-non-leak body assertion). Add a §6.6 note if anything surprised.
Flip §3 Phase 1 Status `researched` → `complete` and bump the header
"Last updated" line.

### Success Criteria:

#### Automated Verification:

- Full suite passes: `npm test`.
- Linting passes: `npm run lint`.
- Build passes: `npm run build`.

#### Manual Verification:

- Temporarily reorder a guard (e.g. move the `getCarById` check above the
  `selectedCarId` check) and confirm a case fails — proves the contract is
  pinned. Revert.
- Confirm `test-plan.md` §6.1/§6.2 read as usable recipes and §3 Phase 1 shows
  `complete`.

**Implementation Note**: This is the final phase. After automated verification
passes, pause for human confirmation of the manual steps before the closing
commit.

---

## Testing Strategy

### Unit Tests:

- `buildSystemPrompt`: field grounding, control-char sanitisation, optional
  field omission. Oracle from fixture, never from the function.

### Integration Tests:

- Chat route `POST`: full guard table (401/400×3/503/404/500/200), foreign-car
  short-circuit (R1), key-non-leak on SDK error (R2), mid-stream SSE error.

### Manual Testing Steps:

1. Run `npm test` — all specs green.
2. Break `sanitise`, re-run, confirm the sanitisation case fails; revert.
3. Reorder a chat-route guard, re-run, confirm a case fails; revert.
4. Confirm `test-plan.md` §6 cookbook + §3 status updated.

## Performance Considerations

Negligible — pure functions and a mocked handler. No DB, no network, no
browser. Suite should run in well under a second.

## Migration Notes

None. Adds a runner and specs; the only production edit is two `export`
keywords in `ai.ts` (no behavior change).

## References

- Related research: `context/changes/testing-bootstrap-ai-chat/research.md`
- Test strategy: `context/foundation/test-plan.md` (§1 principles, §2 R1/R2,
  §6 cookbook targets, §7 exclusions)
- Chat route under test: `src/pages/api/ai/chat.ts:11-82`
- Grounding under test: `src/lib/services/ai.ts:13-48`
- Ownership filter: `src/lib/services/cars.ts:10-17`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Bootstrap the test runner

#### Automated

- [x] 1.1 Dependency installs: `npm install` completes
- [x] 1.2 Runner starts green with no specs: `npm test` exits 0
- [x] 1.3 Linting passes: `npm run lint`
- [x] 1.4 Build still passes: `npm run build`

#### Manual

- [x] 1.5 `npm run test:watch` starts and watches without error
- [x] 1.6 `git grep` confirms `buildSystemPrompt` export landed

### Phase 2: Unit tests — AI chat grounding (R1)

#### Automated

- [ ] 2.1 Unit spec passes: `npm test`
- [ ] 2.2 Linting passes: `npm run lint`

#### Manual

- [ ] 2.3 Break-`sanitise` check fails the sanitisation case, then revert

### Phase 3: Integration tests — chat envelope (R1 + R2)

#### Automated

- [ ] 3.1 Full suite passes: `npm test`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Build passes: `npm run build`

#### Manual

- [ ] 3.4 Guard-reorder check fails a case, then revert
- [ ] 3.5 `test-plan.md` §6.1/§6.2 read as usable recipes and §3 Phase 1 is `complete`
