<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: AI Integration Scaffold

- **Plan**: context/changes/ai-integration-scaffold/plan.md
- **Scope**: All Phases (1–3 of 3)
- **Date**: 2026-06-01
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical · 6 warnings · 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Findings

### F1 — Auth guard bypasses middleware-resolved user

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architecture / Plan Adherence
- **Location**: src/pages/api/ai/chat.ts:10-21
- **Detail**: The plan's contract states "Return 401 if context.locals.user is null" and references the pattern at cars/index.ts:30. Instead, the route creates a fresh Supabase client and calls auth.getUser() on each request — a second round-trip the middleware already made. This introduces latency, diverges from the project's auth convention (CLAUDE.md + all other API routes), and creates two independent auth paths. Subtle risk: a session revoked between the middleware and the route check could begin streaming before the second check fires.
- **Fix A ⭐ Recommended**: Replace the createClient auth block with: `if (!context.locals.user) return new Response(null, { status: 401 })`
  - Strength: Zero latency overhead; aligns with cars/index.ts:30, ai-test.astro, dashboard.astro — all the same pattern.
  - Tradeoff: None meaningful. The middleware guard is always present.
  - Confidence: HIGH — middleware guarantees locals.user is set on every request, including to API routes.
  - Blind spot: Confirm createClient import is unused elsewhere in this file before deleting it.
- **Fix B**: Keep createClient but document it as intentional
  - Strength: Zero code change.
  - Tradeoff: Perpetuates the inconsistency; future developers will copy this pattern.
  - Confidence: LOW — no good reason to deviate here.
  - Blind spot: None.
- **Decision**: FIXED via Fix A

### F2 — Hardcoded localhost URL in HTTP-Referer header

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/ai.ts:13
- **Detail**: defaultHeaders includes HTTP-Referer: "http://localhost:4321". This header is sent to OpenRouter on every request including production deploys, where it will misidentify the caller. OpenRouter uses this header for analytics and usage attribution; a permanent localhost value makes production usage invisible.
- **Fix A ⭐ Recommended**: Remove the header entirely
  - Strength: OpenRouter does not require it; absence is cleaner than a wrong value.
  - Tradeoff: Loses OpenRouter usage attribution (minor, not a product requirement at this stage).
  - Confidence: HIGH — this is a transport scaffold, not a production analytics integration.
  - Blind spot: If OpenRouter ever requires it for rate-limit purposes, this would need revisiting.
- **Fix B**: Source it from an env var (e.g. PUBLIC_SITE_URL)
  - Strength: Correct per environment; enables attribution later.
  - Tradeoff: Adds a new env var to configure.
  - Confidence: MEDIUM — over-engineering for a scaffold.
  - Blind spot: Needs .env.example update.
- **Decision**: FIXED via Fix A

### F3 — Model alias openrouter/free is non-deterministic

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence / Reliability
- **Location**: src/lib/services/ai.ts:19
- **Detail**: Plan specified model: 'google/gemini-2.0-flash-exp:free'. The implementation uses 'openrouter/free', a catch-all alias that resolves to whatever free model OpenRouter currently routes to. This can change without notice across deploys. S-02 (ai-car-chat) will inherit this model selection.
- **Fix A ⭐ Recommended**: Pin to a specific free model identifier
  - Strength: Deterministic behaviour across deploys; consistent with S-02 knowing exactly what model it targets.
  - Tradeoff: Model may become unavailable; requires manual update.
  - Confidence: HIGH — the plan called this out explicitly.
  - Blind spot: Haven't verified which specific free model currently works best with car-assistant prompts.
- **Fix B**: Keep alias but document it
  - Strength: OpenRouter always routes to something free.
  - Tradeoff: Model drift is silent and untraceable in production.
  - Confidence: LOW — bad for a foundation that S-02 builds on.
  - Blind spot: None.
- **Decision**: FIXED via Fix B

### F4 — Stream error path: no [DONE] terminator + no server logging

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/ai/chat.ts:54-56
- **Detail**: On stream error, the catch block enqueues data: {"error":"..."} then finally closes the controller. No [DONE] frame follows, leaving the client dependent on the stream closing as the termination signal. The server-side catch also swallows the actual error with no console.error, making operational failures invisible in wrangler tail.
- **Fix**: In the catch block, after the error enqueue, add `controller.enqueue(encoder.encode('data: [DONE]\n\n'))` and add `console.error(e)` before the enqueue.
- **Decision**: FIXED

### F5 — useStreamingText cancel check fires after state mutation

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/hooks/useStreamingText.ts:29-31
- **Detail**: After reader.cancel() fires in the cleanup, the pending reader.read() resolves with {done: true}. The cancelled flag is checked, but buffer += runs before the check — meaning a React setState call may execute after the component unmounts, triggering a dev-mode warning.
- **Fix**: Move `if (cancelled) break` to immediately after `const { done, value } = await reader.read()`, before `buffer +=`.
- **Decision**: DISMISSED — false positive. Actual code at line 30 already places `if (cancelled) break` before `buffer +=` at line 37. Review agent had incorrect execution order analysis.

### F6 — Lint failure in ai-test.astro

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/pages/ai-test.astro:14
- **Detail**: npm run lint reports a prettier/prettier error — a multi-line class attribute that should be on one line. CI will fail on this. Phase 3 automated check was build-only, so lint wasn't re-verified after the page was added.
- **Fix**: Run `npm run lint:fix` — auto-fixable in one command.
- **Decision**: FIXED

### F7 — openai v6 installed; plan specified ^4.x

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: package.json
- **Detail**: ^6.39.1 is in dependencies; plan said ^4.x. v6 is newer and ESM-compatible. SDK API surface used here is unchanged across versions. Benign drift.
- **Fix**: Update the plan's contract note to reflect v6.
- **Decision**: FIXED

### F8 — OpenAI client created per-call, not module-scoped

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/ai.ts
- **Detail**: cars.ts injects its SupabaseClient as a parameter; ai.ts creates the OpenAI client inside createChatStream on every call. On Workers, module-level instantiation is cheaper and consistent with how Supabase clients are handled elsewhere.
- **Fix**: Move `new OpenAI(...)` to module scope (`const client = ...`).
- **Decision**: FIXED

### F9 — Unguarded res.json() on non-2xx fetch in ChatDemo

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/ai/ChatDemo.tsx:29-32
- **Detail**: On a non-OK response, res.json() throws if the body is not valid JSON (e.g. a Cloudflare 502). The outer catch sets fetchError to the JSON parse exception message, which is user-unfriendly.
- **Fix**: `const data = await res.json().catch(() => ({}))` and fallback to a generic message.
- **Decision**: FIXED

### F10 — Brief layout shift on resubmission

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/ai/ChatDemo.tsx:45
- **Detail**: setStream(null) fires before the new stream is set, causing hasResponse to briefly be false — the response panel unmounts and remounts, creating a visible flicker on resubmit.
- **Fix**: Accept as a known UX trade-off for this scaffold, or hold previous stream state until the new fetch resolves.
- **Decision**: SKIPPED — accepted as scaffold trade-off
