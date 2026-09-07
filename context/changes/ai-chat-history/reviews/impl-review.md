<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Multi-turn AI Chat with Persisted Conversation History

- **Plan**: `context/changes/ai-chat-history/plan.md`
- **Scope**: Phases 1–5 (full plan)
- **Date**: 2026-09-07
- **Commits reviewed**: `4e4af81`, `cce99eb`, `e51ca9c`, `13da8e3`, `11cfd8b`, `fb20d06` (49 files, +6825/−350)
- **Verdict**: REJECTED
- **Findings**: 1 critical, 6 warnings, 3 observations

The verdict is driven entirely by **F1**, which needs a 200-message thread to bite and has a
two-line fix. The rest of the change is unusually well built: RLS, XSS, secret handling,
authn/authz, the double-commit guard and all six Critical Implementation Details verified clean;
scope discipline intact; nothing MISSING.

## Verdicts

| Dimension           | Verdict | Findings               |
| ------------------- | ------- | ---------------------- |
| Plan Adherence      | WARNING | F4, F8                 |
| Scope Discipline    | PASS    | —                      |
| Safety & Quality    | FAIL    | F1, F2, F3, F5, F6, F9 |
| Architecture        | PASS    | —                      |
| Pattern Consistency | WARNING | F7, F10                |
| Success Criteria    | PASS    | —                      |

### Success criteria — all 23 automated checks re-run in this review pass

`supabase db reset` (migration replays from scratch) · isolation-conversations 21/21 ·
full integration 140/140 · unit 397/397 · client 17/17 · `npm test` 414/414 ·
`test:all` 554/554 · tripwire pair 34/34 · `astro check` 0 errors ·
`eslint` clean (198 files) · `npm run build` · `wrangler deploy --dry-run` ·
both grep guards clean.

All 7 manual criteria carry observable evidence — none rubber-stamped. Item 1.7 re-verified
directly against the live DB: RLS enabled on both tables, four `authenticated` policies each,
both planned indexes present (`conversations_car_id_updated_at_idx`,
`messages_conversation_id_created_at_idx`).

### Verified clean (checked, not assumed)

- **RLS**: both child tables carry `auth.uid() = user_id AND EXISTS(<owned parent>)` in INSERT
  `WITH CHECK` and in **both** UPDATE expressions. SELECT/DELETE gate on `user_id` alone, which
  is sufficient. Cascades sound; forward-only safe.
- **XSS**: no `rehype-raw`; react-markdown v10's default `urlTransform` strips `javascript:`/
  `data:` hrefs; links carry `target="_blank" rel="noopener noreferrer"`.
- **Secrets**: every response body is a fixed literal; `logApiError` writes `err.message` only;
  `OPENROUTER_API_KEY` is `access: "secret", context: "server"`.
- **Authn/authz**: both routes gate on `locals.user`, both 404 (never 403) for "not yours";
  both pages redirect on missing car/user; `/ai-chat` prefix covers `/ai-chat/[id]`.
- **Stream lifecycle**: `commit` sets `committed` synchronously before any `await`; `sse.ts`
  releases its reader in `finally`; `useConversation` aborts on unmount.
- **All six Critical Implementation Details** hold in code.
- **Scope discipline**: every "What We're NOT Doing" guardrail intact (no Vercel AI SDK, no
  `updated_at` on `messages`, model unpinned, middleware/`PROTECTED_ROUTES`/sidebar untouched,
  no `/ai-chat` E2E, no app-side limiter). All five unplanned files justified.

### Deviations checked and accepted as written

- `env.d.ts` types `cfContext` structurally rather than `extends Runtime` — the plan told the
  implementer to verify before adding `@cloudflare/workers-types`; this is the verified answer
  (the global degrades to `any` under `strictTypeChecked`).
- Integration UPDATE-door tests assert zero-rows-matched instead of `42501` — RLS `USING`
  filters rather than erroring, so `42501` was never obtainable. Doors still closed and
  read-back verified.
- `buildHistoryWindow` returns a single oversized pair with `truncated: false`. Cosmetic;
  `truncated` is currently unconsumed.

### Loose end not raised as a numbered finding

`e2e/car-delete-blast-radius.spec.ts`'s header docstring enumerates the cascade as
`entries.*.car_id → cars`; `conversations.car_id` now cascades too. The coverage decision is
deliberate (the plan routed that case to `isolation-conversations.test.ts`, which asserts it and
passes) — only the prose is stale. Worth folding into any fix pass.

## Findings

### F1 — getMessages returns the OLDEST 200 messages, not the newest

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/services/conversations.ts:86-93`
- **Detail**: `.order("created_at", { ascending: true }).limit(200)` orders first, then
  truncates — returning messages 1–200, not the last 200. Past 200 messages in one thread:
  (a) `buildHistoryWindow` replays pairs from the START, so the model answers with total amnesia
  of recent turns; (b) `/ai-chat/[id]` renders a transcript that stops at message 200 and never
  shows what the user just sent. The doc comment at `:73-78` asserts the opposite — "a thread
  longer than the bound loses nothing the model would have seen" — actively misleading the next
  reader.
- **Fix**: Order descending, take `limit`, then `.reverse()` before returning, so the bound trims
  the head instead of the tail. Correct the doc comment to match.
  - Strength: Restores the property the comment already claims; the index
    `messages (conversation_id, created_at)` serves both directions.
  - Tradeoff: None — the ascending contract is preserved by the reverse.
  - Confidence: HIGH — ORDER BY/LIMIT semantics are unambiguous.
  - Blind spot: None significant.
- **Decision**: FIXED — ordered descending + `.reverse()`; doc comment corrected. Regression
  pinned by two integration cases in `integration/crud-integrity.test.ts` ("messages"): the
  over-limit case fails if the ordering regresses, the under-limit case is the control.
  Verified by reverting the fix and watching exactly the first fail.

### F2 — Every retry after a 429 spawns another empty conversation

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/ai/chat.ts:97-102`, `:156`, `:163`
- **Detail**: The conversation row and user message are written before `createChatStream`. On a
  429 or 500 the route returns JSON with no conversation id (`X-Conversation-Id` is set only on
  the success response at `:325`; the client learns the id from the `meta` frame, which never
  arrives). `currentId` stays `null`, so the next send creates a fresh thread. Against a 50/day
  cap, 429 is expected — each retry leaves another sidebar entry holding one unanswered question.
- **Fix A ⭐ Recommended**: Return the conversation id in the 429/500 bodies and adopt it in the
  hook before setting the error.
  - Strength: Keeps the plan's deliberate "question survives a failure" property — the user's
    text stays recoverable in the thread it belongs to.
  - Tradeoff: Widens the error-response contract; the hook needs a branch that adopts an id on a
    non-OK response.
  - Confidence: HIGH — the id exists at both return sites already.
  - Blind spot: Whether a test pins the exact error body shape.
- **Fix B**: Defer `createConversation` until `createChatStream` resolves.
  - Strength: No orphan rows can exist at all.
  - Tradeoff: Reverses a documented plan decision — the user's question would no longer survive a
    failed turn, which is what Phase 2 explicitly chose.
  - Confidence: MEDIUM — simple to write, but undoes a recorded intent rather than a bug.
  - Blind spot: Interaction with the meta-frame-first rule.
- **Decision**: FIXED via Fix A — `conversation_id` now rides the 429 and 500 bodies; the hook
  adopts it before setting the error. The named blind spot was real: two route tests pinned the
  exact body with `toEqual` and failed immediately (caught by the tripwire hook); both updated to
  assert the id, keeping the R2 exact-match that stops a new field smuggling in the SDK message.
  New client case pins the adoption and the retry resuming the same thread; verified by removing
  the hook branch and watching only that case fail.

### F3 — An empty model reply is a silently dead turn

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/ai/chat.ts:277-278`; `src/components/hooks/useConversation.ts:166-168`
- **Detail**: When the upstream produces zero content the route pushes `{"done":"error"}` with no
  preceding `{"error":…}` frame. The hook's `done` branch calls `commitPending`, which appends
  nothing for empty text and never sets `error`. The question sits on screen, the caret vanishes,
  and nothing else happens. `chat.test.ts:354` pins the server half and calls it "reports error",
  but nothing reaches the UI. The `aiChat.failed` string already exists for this.
- **Fix**: Push `{ error: "Stream failed" }` before the done frame on the `!answer` path, so the
  existing hook branch surfaces it.
  - Strength: One line, server-side, reuses a shipped i18n key and an existing client branch.
  - Tradeoff: None.
  - Confidence: HIGH — the client branch is already tested.
  - Blind spot: None significant.
- **Decision**: FIXED — the route now emits `{"error":"Stream failed"}` before the terminal
  `done` on the empty-reply path; `aborted` is exempt, since the user pressed stop and knows why.
  The misleadingly-named route test was strengthened to assert the error frame AND its ordering
  before `done`, not just `done:"error"`. Verified by removing the push and watching that case fail.

### F4 — The client shows "conversation not found" when the CAR is missing

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/components/hooks/useConversation.ts:205-209`
- **Detail**: The route returns two distinct 404s: `"Car not found"` (`chat.ts:75`) and
  `"Conversation not found"` (`:92`). `errorForResponse` maps ANY 404 to
  `conversation_not_found`, ignoring the `message` parameter it already accepts. Plan Phase 3
  specified "404 **with the conversation message**". Reachable when the selected-car cookie goes
  stale in another tab: the user is told their thread is gone when it is the car that is, and is
  pointed at the wrong recovery action.
- **Fix**: Gate the 404 branch on the message, falling through to `server` otherwise — one
  condition, as the plan specified.
  - Strength: Restores the planned behaviour; `message` is already a parameter.
  - Tradeoff: Couples the client to a server literal — which the plan already accepted.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED — the 404 → `conversation_not_found` mapping is now gated on the server's
  `"Conversation not found"` literal, hoisted to a named constant explaining why it is matched
  rather than assumed. A "Car not found" 404 falls through to `server`. New client case pins it;
  verified by reverting the condition and watching only that case fail.

### F5 — Car fields reach the system prompt uncapped and `<>`-permitting

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/services/ai.ts:94-105`; `src/pages/api/cars/index.ts:9-27`
- **Detail**: Entry text goes through `sanitiseForBlock` + `clip(200)`. Car fields go through
  `sanitise` only — no length cap, no `<`/`>` stripping — and `carSchema` has no `.max()` on
  `brand`/`model`/`engine_*`. Two consequences, both new to this change even though the
  sanitising gap is not: (a) a car field can forge an `<entries>` block ahead of the real one,
  which is exactly what the delimiter defence exists to prevent (F4 in the archived chat review);
  (b) an oversized field is now re-sent on every turn of every thread, not once per one-shot
  question. The plan knowingly left `sanitise` alone to keep `ai.test.ts` green, so this is a plan
  gap rather than an implementation slip.
- **Fix A ⭐ Recommended**: Route car fields through `sanitiseForBlock` + `clip` and update the
  `ai.test.ts` expectations.
  - Strength: Closes the forging vector where the delimiter is actually defended; one function,
    one test file.
  - Tradeoff: Touches assertions the plan deliberately protected.
  - Confidence: HIGH — `sanitiseForBlock` already exists and is tested.
  - Blind spot: Whether any assertion depends on `<` surviving.
- **Fix B**: Add `.max()` to `carSchema`/`patchSchema` only.
  - Strength: Fixes the size half at the boundary, no prompt change.
  - Tradeoff: Leaves the forging vector open; does nothing for cars already stored.
  - Confidence: MEDIUM — bounds new input only.
  - Blind spot: Existing oversized rows.
- **Decision**: FIXED via Fix A — `sanitiseForBlock` renamed `sanitiseForPrompt` (it now serves
  both kinds of input) and car fields go through a new `carField` = `clip(sanitiseForPrompt(...))`.
  `ENTRY_FIELD_MAX_CHARS` renamed `PROMPT_FIELD_MAX_CHARS`. The named blind spot did not
  materialise: no existing assertion depended on `<` surviving, and all 12 prior cases still pass
  because `sanitiseForPrompt` is a strict superset of `sanitise`. Two new cases pin the forging
  vector and the clip; verified by reverting the car-field call sites and watching both fail.
  Fix B (`.max()` on `carSchema`) was NOT applied — see the follow-up note below.

### F6 — listConversations is unbounded

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/services/conversations.ts:17-30`
- **Detail**: No `.limit()`, unlike its sibling `getMessages`. Both `/ai-chat` and
  `/ai-chat/[id]` read and render every thread the car has ever had, on every page load — and F7
  mounts one React island per row on top of it.
- **Fix**: Add a bounded `limit` parameter; the existing index
  `conversations (car_id, updated_at DESC)` already serves it.
  - Strength: Matches the sibling's shape and the reasoning already written in `getMessages`.
  - Tradeoff: Needs a "show older" affordance if a user ever exceeds the bound.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED — `listConversations` takes `limit = 100`, ordered by `updated_at DESC` so
  the bound drops the least recently active threads. Served by the existing
  `conversations (car_id, updated_at DESC)` index.

### F7 — One React island per conversation row

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: `src/components/ai/ConversationList.astro:71-76`
- **Detail**: Each row hydrates its own `DeleteConversationButton`, each running
  `createClientI18n(lang)` — a full i18next instance with every locale resource — plus a complete
  Radix `AlertDialog`. The sibling `CarList.tsx:29-40` mounts ONE island for the whole list with
  one i18n instance and one shared dialog. With F6 uncapped, this is N hydration roots with no
  ceiling. The plan specified this shape ("Each row carries a `DeleteConversationButton`
  island"), so the divergence originates in the plan.
- **Fix A ⭐ Recommended**: Hoist the delete UI into a single island that owns one dialog and
  takes the row list, mirroring `CarList` + `DeleteCarDialog`.
  - Strength: Matches the established pattern; N instances → 1.
  - Tradeoff: The list stops being purely `.astro` for its interactive part — though `CarList`
    already sets that precedent.
  - Confidence: HIGH — a working sibling to copy.
  - Blind spot: Keeping rows server-rendered while the dialog hydrates once.
- **Fix B**: Keep per-row islands, add the F6 limit as the ceiling.
  - Strength: Minimal change; bounds the worst case.
  - Tradeoff: Still N i18next instances for N visible rows.
  - Confidence: MEDIUM — mitigates rather than fixes.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A, adapted — the literal "move the list into React" reading would
  break the project rule that non-interactive sections stay `.astro`. Instead the rows keep their
  server-rendered markup (a plain `<button data-delete-conversation>` with an inline SVG) and a
  single `DeleteConversationDialog` island, mounted once with `client:idle`, picks up their
  clicks by delegation. N React roots + N i18n instances + N Radix dialogs → one of each,
  independent of thread count. `DeleteConversationButton.tsx` deleted; the dialog now also names
  the thread being deleted, which the per-row version could not.
  **Needs a browser re-check**: this reworks the delete flow that manual item 4.10 covered.

### F8 — chat.ts stream architecture departs from the approved design

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — worth a reviewer's attention, no action implied
- **Dimension**: Plan Adherence / Architecture
- **Location**: `src/pages/api/ai/chat.ts:230-300`
- **Detail**: The plan put generation inside `ReadableStream.start()` with `cancel()` as the
  disconnect signal. The implementation instead runs `drain()` via `runAfterResponse` **before**
  the Response is returned, and detects disconnect by `controller.enqueue()` throwing. The
  recorded reason is empirical: on workerd, killing a reader mid-stream ran neither `cancel()`
  nor the completion path, so the approved design would have lost the assistant message in
  exactly the case persistence exists for. Every contract behaviour survives; `cancel()` is kept
  as an opportunistic early signal. This is the largest departure in the change and is, in the
  reviewer's judgement, correct — recorded so it is a conscious acceptance rather than an
  unnoticed one.
- **Fix**: None proposed — the deviation is better than the plan.
- **Decision**: ACCEPTED — no code change. The deviation is better than the plan and the reason
  is recorded in the source: on workerd, killing a reader mid-stream ran neither `cancel()` nor
  the completion path, so the approved design would have lost the assistant message in exactly
  the case persistence exists for. Logged here so the departure is a conscious acceptance.

### F9 — Whitespace-only prompt yields the wrong 400, and a false comment

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/ai/chat.ts:22`; `src/lib/chat.ts:154-155`
- **Detail**: `z.string().min(1)` is untrimmed, so `"   "` passes. `titleFromPrompt` then returns
  `""`, `createConversation` trips `conversations_title_length` (23514), and `api-errors` maps
  that to a generic 400 "Invalid request" instead of "Prompt is required". The comment in
  `chat.ts` claims a whitespace-only prompt "cannot reach this" — it can.
- **Fix**: `z.string().trim().min(1, "Prompt is required").max(2000, …)` and correct the comment.
  - Strength: Makes the error message match the actual mistake; removes a false claim.
  - Tradeoff: `.trim()` changes what reaches `titleFromPrompt` — harmless, it collapses anyway.
  - Confidence: HIGH.
  - Blind spot: Whether a schema test pins the untrimmed behaviour.
- **Decision**: FIXED — `z.string().trim().min(1, "Prompt is required")`, and the false claim in
  `src/lib/chat.ts` replaced with a note on why the trim is load-bearing. New guard case pins it;
  verified by removing `.trim()` and watching only that case fail.

### F10 — Cancelling the delete dialog leaves a stale error

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/components/ai/DeleteConversationButton.tsx:84-91`
- **Detail**: `AlertDialogCancel` closes without clearing `error`, so a failed delete leaves the
  stale message rendered the next time the dialog opens.
- **Fix**: `setError(null)` alongside `setOpen(false)`.
  - Strength: One line; matches how the rest of the app resets transient state on close.
  - Tradeoff: None.
  - Confidence: HIGH.
  - Blind spot: None significant.
- **Decision**: FIXED as part of F7 — `DeleteConversationButton.tsx` no longer exists; its
  replacement `DeleteConversationDialog.tsx` clears `error` in `close()` alongside the target, so
  a failed delete cannot greet the user on the next thread they open the dialog for.
