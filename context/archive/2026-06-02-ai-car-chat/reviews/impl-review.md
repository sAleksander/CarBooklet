<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: AI Car Chat

- **Plan**: `context/changes/ai-car-chat/plan.md`
- **Scope**: All phases (Phase 1 + Phase 2)
- **Date**: 2026-06-02
- **Verdict**: NEEDS ATTENTION
- **Findings**: 2 critical 4 warnings 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | FAIL    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — Missing ownership check in API route (IDOR)

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality / Pattern Consistency
- **Location**: src/pages/api/ai/chat.ts:26
- **Detail**: After `getCarById(supabase, selectedCarId)`, there is no check that `car.user_id === context.locals.user.id`. The `selectedCarId` comes from the `selected_car_id` cookie — any authenticated user can forge this to another user's car UUID. The API then injects the victim's car details (VIN, engine code, make/model) into the AI system prompt, leaking PII via the LLM response. RLS on `cars` (user_id = auth.uid()) is the only line of defence. The S-03 impl-review already established this rule: ownership check required at the application layer after getCarById (see repair.ts:73).
- **Fix**: Add `if (!car || car.user_id !== context.locals.user.id) { return Response.json({ error: "Car not found" }, { status: 404 }); }` after the car fetch. Use 404, not 403, to avoid confirming that a UUID belongs to another user.
  - Strength: One-liner. Closes the application-layer gap. Follows the established pattern in src/pages/api/entries/repair.ts.
  - Tradeoff: None significant — purely additive defence.
  - Confidence: HIGH — identical fix was applied in S-03 impl-review.
  - Blind spot: None significant.
- **Decision**: FIXED — 50833b5

### F2 — Missing ownership check in /ai-chat page

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality / Pattern Consistency
- **Location**: src/pages/ai-chat.astro:20
- **Detail**: Same root cause as F1 on the server-rendered page. After `getCarById(supabase, selectedCarId)`, the page checks only `!car`, not `car.user_id !== user.id`. The page renders the car name/year from the DB row and mounts ChatDemo, which posts to the API route (also missing the check). Both surfaces are unprotected at the application layer.
- **Fix**: Add `if (!car || car.user_id !== user.id) return Astro.redirect("/cars")` after the `getCarById` call.
  - Strength: One-liner. Same fix pattern as F1.
  - Tradeoff: None significant.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED — 50833b5

### F3 — Body validation runs after DB fetch (ordering inversion)

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/ai/chat.ts:26–41
- **Detail**: `getCarById` (DB round-trip) runs at lines 26-28 before `request.json()` and `promptSchema.safeParse` at lines 32-41. The sibling pattern in `src/pages/api/entries/repair.ts` parses and validates the body first (cheap local work), then fetches from the DB.
- **Fix**: Move the `request.json()` parse and `promptSchema.safeParse` block to run before the `createClient` / `getCarById` calls.
- **Decision**: FIXED — 50833b5

### F4 — DB field values interpolated into system prompt without sanitisation

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/ai.ts:14–18
- **Detail**: `engine_type`, `engine_capacity`, `engine_power`, `engine_code`, and `vin_number` are interpolated directly into the LLM system prompt with no sanitisation. A crafted car record containing a prompt-injection payload in a field would be forwarded verbatim to OpenRouter. Risk grows significantly when repair entry text is added to the prompt in the S-02 addendum.
- **Fix A ⭐ Recommended**: Strip newlines and control characters from each field before interpolation: `field.replace(/[\r\n\x00-\x1F\x7F]/g, " ")`.
  - Strength: Eliminates the most common injection vector (newline instruction hijacking).
  - Tradeoff: Doesn't prevent all prompt injection; best-effort mitigation.
  - Confidence: MED — prompt injection mitigations are an arms race.
  - Blind spot: May need revisiting when entry context (free-text repair descriptions) is added.
- **Fix B**: Accept risk and document as known limitation.
  - Strength: No code change; honest about limits of mitigation.
  - Tradeoff: Risk grows significantly when entry text is added to the prompt.
  - Confidence: MED.
  - Blind spot: Unknown attacker access level to DB.
- **Decision**: FIXED — 50833b5

### F5 — Raw SDK error message forwarded to client

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/ai/chat.ts:47
- **Detail**: `(err as Error).message` from the caught `createChatStream` throw is forwarded verbatim to the browser. OpenAI/OpenRouter SDK errors can contain upstream error details, rate-limit metadata, or partial request context.
- **Fix**: Replace with `return Response.json({ error: "AI service error" }, { status: 500 });` and log the original `err` server-side.
- **Decision**: FIXED — 50833b5

### F6 — engine_capacity / engine_power conditionally guarded (plan drift)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/services/ai.ts:15–16
- **Detail**: The plan states `engine_capacity` and `engine_power` should always be included (unconditional). The implementation guards all fields with `.trim()` checks. In practice the Car schema defines both as `string` (not optional), so empty strings are unlikely and behaviour is equivalent for real data.
- **Fix**: Remove the `.trim()` guards on lines 15–16 to match the plan contract, or update the plan to reflect guarding against empty strings.
- **Decision**: FIXED — 50833b5
