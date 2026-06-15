<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Bootstrap Test Runner + AI Chat Envelope

- **Plan**: context/changes/testing-bootstrap-ai-chat/plan.md
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-06-15
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Summary

Full MATCH against the plan across all 7 planned changes; every "What We're NOT
Doing" guardrail respected (no coverage tooling, no React/DOM test deps, no real
Supabase/DB, no e2e, no chat-route behavior change beyond two `export`
keywords, no `cars/[id]/select.ts` test). Two parallel review agents (plan-drift
and safety/quality/pattern) returned clean. The two deviations from the literal
plan are additive and plan-consistent: `passWithNoTests: true` (mandated by the
plan's own §6.6 rationale — Vitest 3 exits 1 on an empty suite) and an extra
whitespace-only omission unit case (covers the `?.trim()` empty branch the plan
grouped under "null/empty").

Success criteria re-run during review: `npm test` 14/14 (15/15 after triage
fixes), `npm run lint` 0 errors, `npm run build` 0.

Strong points confirmed by the agents:
- R2 (key non-leak) asserted against a real secret-bearing SDK error through the
  route's actual catch path — not over-mocked; same for the mid-stream frame.
- R1 (ownership short-circuit) asserts `createChatStream` is NOT called for a
  foreign car — the regression guard, not just the 404 status.
- No LLM prose asserted anywhere; the unit oracle is an independent fixture.

## Findings

### F1 — OPENROUTER_API_KEY falsy-guard never exercised

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/lib/services/ai.ts:36-38 / src/test/__mocks__/astro-env-server.ts:8
- **Detail**: The test double always resolves `OPENROUTER_API_KEY` to a non-empty
  placeholder, so the `if (!OPENROUTER_API_KEY) throw` guard in `createChatStream`
  was never covered. (The guard is otherwise hard to reach: an empty key makes
  `new OpenAI({ apiKey })` throw at module import.)
- **Fix**: Added `src/test/lib/services/ai-config.test.ts` — a dedicated spec that
  `vi.mock`s `astro:env/server` (empty key) and `openai` (stub constructor so it
  doesn't throw at import), then asserts `createChatStream` rejects with
  "OPENROUTER_API_KEY is not configured" (generic message, no secret).
- **Decision**: FIXED — added isolated config-guard spec (15th test).

### F2 — streamOf stub bridged to the OpenAI stream type via cast

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/test/pages/api/ai/chat.test.ts:62-69, 164
- **Detail**: The stream stubs were each typed via `as unknown as ChatStream`
  (two separate cast sites). The cast is the standard idiom for stubbing the broad
  OpenAI streaming type and lint passed clean, but the cast was duplicated.
- **Fix**: Introduced a named `ChatChunk` interface and a single `makeStream(gen)`
  helper that owns the one `as unknown as ChatStream` cast; routed both `streamOf`
  and the mid-stream stub through it. The cast now appears exactly once.
- **Decision**: FIXED via "Fix differently" — centralized cast + named chunk shape.
