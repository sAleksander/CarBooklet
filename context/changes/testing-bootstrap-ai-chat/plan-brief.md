# Bootstrap Test Runner + AI Chat Envelope — Plan Brief

> Full plan: `context/changes/testing-bootstrap-ai-chat/plan.md`
> Research: `context/changes/testing-bootstrap-ai-chat/research.md`

## What & Why

Rollout Phase 1 of `context/foundation/test-plan.md`. The project has zero
tests. This stands up Vitest and proves the AI-chat endpoint's deterministic
envelope: it grounds only on the **owned** selected car (R1) and never leaks
the OpenRouter API key into a response body (R2). We test the envelope, never
the model's prose (test-plan §1, §7).

## Starting Point

No `vitest.config`, no `*.test.*`, no test dep or script. The chat route is
already well-guarded (`src/pages/api/ai/chat.ts:11-50`) and ownership is
enforced server-side via a two-column `getCarById` filter — so the job is to
*pin that contract against regression*, not to add missing safety.

## Desired End State

`npm test` runs Vitest green: a unit spec proving prompt grounding/sanitisation
and an integration spec pinning the chat route's full guard table + key
non-leak. The test-plan §6 cookbook is filled with the patterns established and
§3 Phase 1 is marked `complete`.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Test runner | Vitest, `environment: "node"` | Vite-native; `nodejs_compat` makes Node env correct | Research |
| Virtual module | Alias `astro:env/server` → test double | It doesn't exist in Vitest; importing services throws otherwise | Research |
| Grounding test | Export `buildSystemPrompt` + `sanitise` | Cheapest real signal — pure fn, fixture oracle, no mocks | Plan |
| Test location | Centralized `src/test/` mirroring `src/` | Keeps source dirs test-free; one convention for Phases 2-4 | Plan |
| Coverage | Defer to §3 Phase 4 (CI gate) | Keep bootstrap lean; no premature thresholds on 2 files | Plan |
| Integration style | Invoke `POST` directly, `vi.mock` boundary services | No HTTP server/miniflare needed; exercises real guard logic | Plan |

## Scope

**In scope:** Vitest bootstrap; unit grounding spec (R1); integration envelope
spec (R1 ownership + auth/validation guards + R2 key non-leak); test-plan §6/§3
backfill.

**Out of scope:** LLM answer quality (§7); real Supabase/RLS IDOR (Phase 2);
coverage tooling (Phase 4); React component tests; e2e (Phase 4); refactoring
the chat route.

## Architecture / Approach

Three commit-boundary phases: (1) bootstrap — `npm test` green with no specs,
plus the two `export`s; (2) unit — pure `buildSystemPrompt` with a
fixture-sourced oracle; (3) integration — real `POST` handler with mocked
`createClient` / `getCarById` / `createChatStream`, asserting status + body +
SSE text + "dependency not called" guards. The `astro:env/server` alias must
exist before any spec imports a service.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Bootstrap | `npm test` runs; config + alias + double + exports | Vitest/vite version alignment; alias must resolve |
| 2. Unit (R1) | Grounding/sanitisation/optional-omission spec | Oracle must come from fixture, not the function |
| 3. Integration (R1+R2) | Guard table + foreign-car short-circuit + key non-leak | Mock context fidelity; SSE drain via `res.text()` |

**Prerequisites:** None beyond the existing repo + `npm install`.
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- The `astro:env/server` alias is load-bearing; if it doesn't resolve, every
  service-importing spec fails at import time.
- Importing `ai.ts` constructs `new OpenAI()` at module top — the double must
  export a non-empty `OPENROUTER_API_KEY`.

## Success Criteria (Summary)

- `npm test` passes; `npm run lint` and `npm run build` stay green.
- Foreign-car case proves `createChatStream` is never called; key-leak case
  proves the key string never reaches the response body.
- test-plan §6.1/§6.2 read as usable recipes; §3 Phase 1 is `complete`.
