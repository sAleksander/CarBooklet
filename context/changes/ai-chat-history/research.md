---
date: 2026-09-02T13:41:05+02:00
researcher: Aleksander
git_commit: 935f97961adf9be03fe3bc77332e02305329c188
branch: main
repository: CarBooklet
topic: "Multi-turn AI chat — conversation history instead of one-shot Q&A"
tags: [research, codebase, ai-chat, streaming, openrouter, supabase, rls, cloudflare-workers]
status: complete
last_updated: 2026-09-02
last_updated_by: Aleksander
---

# Research: Multi-turn AI chat — conversation history instead of one-shot Q&A

**Date**: 2026-09-02 13:37 +02:00
**Researcher**: Aleksander
**Git Commit**: `935f97961adf9be03fe3bc77332e02305329c188`
**Branch**: `main`
**Repository**: CarBooklet

## Research Question

> Currently when user sends question he gets reply and thats it. If he sends another one previous
> one is lost. Currently users are acustomed to a chat bots and this should behave like one so
> conversation prompt - reply and history.

Scoping answers given before the research ran: **research both persistence options and recommend
one**; focus hardest on **context window & cost**, **streaming & abort semantics**, and
**schema, RLS & services**.

## Summary

The feature is small in concept and medium in blast radius. Every layer of the current chat is
single-turn _by construction_, not by accident — the zod schema, the service signature, the React
state and the streaming hook each encode "one question, one answer".

Five findings dominate, and two of them are not what the change appears to be about:

1. **The real architectural fork is not "does history survive a refresh" — it is _who owns the
   history_.** If the client sends the transcript, the server loses the authority it deliberately
   holds today (car context is resolved server-side precisely so the client cannot name a car —
   `context/archive/2026-06-02-ai-car-chat/plan-brief.md:21`), and it opens an unbounded
   free-quota and prompt-injection surface. If the server owns it, it needs a store — and the
   Worker binds **no KV, no D1, no Durable Objects** (`wrangler.jsonc`), so the only available
   store is Supabase. **Server-authoritative history therefore implies persistence.** The
   "in-memory only" option is not the cheap half of the persistent one; it is a different and
   weaker trust model. **Recommendation: persist in Supabase.** See
   [Recommendation](#recommendation-persist-server-authoritative-history).

2. **The binding constraint is requests per day, not tokens.** `openrouter/free` prices prompt and
   completion at `0`, so multi-turn costs nothing in dollars. But the account is capped at
   **50 requests/day** below $10 lifetime credits (1,000/day above it), globally per account, not
   per key. A 10-turn conversation is 10 requests — **20% of the entire app's daily quota for one
   user's single conversation.** Multi-turn changes chat from "cheap" to "rationed". This was
   foreseen: `context/foundation/test-plan.md:421-424` parks rate-limiting with "re-evaluate if AI
   cost or abuse becomes a live problem". This change is that trigger.

3. **`openrouter/free` picks a different model at random on every request.** Verified against the
   live models API: it is a router whose pool today spans 18 free variants from a 2.6B model with a
   64k window up to a 550B model with 1M. In one-shot chat this is invisible. In a _conversation_
   it is persona whiplash — turn 3 answers in a different voice, at a different quality, than turn
   2, with no explanation the user can see. The advertised `context_length: 200000` is a catalogue
   figure; `top_provider.context_length` is `null` and the endpoints list is empty. **Design
   against the ~64k floor and treat the floor as unstable.** A reviewer already dissented on this
   alias once (`context/archive/2026-06-01-ai-integration-scaffold/reviews/impl-review.md:62-79`:
   "Model drift is silent and untraceable in production") and was overruled on scope grounds.
   Multi-turn is the case that vindicates the dissent.

4. **Context overflow is a non-issue at realistic sizes.** With a measured 101-token system prompt
   and ~410 tokens per turn, a last-8-turns window sits under ~3.5k tokens — 5% of the smallest
   free model's window. Overflow would arrive around turn 160. Sophisticated
   truncation/summarisation is **not** warranted; a simple last-N window with a character-budget
   guard is the right answer, and the guard exists to bound quota abuse and pathological pastes,
   not to prevent overflow.

5. **The streaming layer has four latent bugs that multi-turn converts from harmless to live.** The
   `[DONE]` handler breaks only the inner loop; the reader is never released on completion;
   `setStream(null)` does not reset the displayed text (a stale-answer flash on every follow-up);
   and the submit button re-enables mid-stream so a second question silently discards the first
   answer. There is **no `AbortController` anywhere in `src/`**, and the server's `ReadableStream`
   has no `cancel()` handler — a client that walks away leaves the Worker consuming OpenRouter to
   completion, burning a request from the daily cap for nobody.

Product-wise this is clean: multi-turn was deferred three times, but never on product grounds.
`context/foundation/prd-v2.md:142` parks it in as many words — "conversation history, persistence
across reloads … **a separate future change**". This change _is_ that change.

---

## Detailed Findings

### 1. The current pipeline is single-turn at four layers

**Request contract** — `src/pages/api/ai/chat.ts:8-10`:

```ts
const promptSchema = z.object({ prompt: z.string().min(1).max(2000) });
```

It is parsed at `:24-27`, **before** the `selectedCarId` check (`:29-32`), before `createClient`
(`:34`) and before `getCarById` (`:43`). That ordering is deliberate and pinned by tests — an
invalid body must short-circuit everything downstream.

**Service contract** — `src/lib/services/ai.ts:40-47` hard-codes a two-element array:

```ts
messages: [
  { role: "system", content: buildSystemPrompt(car) },
  { role: "user", content: prompt },
];
```

No history parameter, no token budget, no locale.

**Client state** — `src/components/ai/ChatDemo.tsx:29-32` holds exactly one `stream` and derives
one `text` from it. Submitting again replaces both.

**The hook owns and destroys the text** — `src/components/hooks/useStreamingText.ts:21-24` resets
`text`/`isDone`/`error` at the top of every new read. There is no `onDone` callback, so a caller
wanting to append the finished turn to a transcript must snapshot `text` on the `isDone` edge,
racing the reset. **The hook's contract has to change; it cannot be reused as-is.**

**No persistence exists to extend.** `supabase/migrations/` holds cars + entries only; `src/types.ts`
has no `Message`/`Conversation`; `wrangler.jsonc` binds no KV/D1/DO. This is net-new surface.

### 2. Streaming and abort semantics

**What already works.** `useStreamingText` decodes with `{ stream: true }` (`:37`) so multi-byte
UTF-8 split across chunks is safe, and it splits on `\n\n` keeping the trailing partial frame in a
buffer (`:40-44`) — partial SSE frames are handled correctly. When `stream` changes, React's cleanup
sets `cancelled = true` and calls `reader.cancel()` (`:76-79`); the parked `await reader.read()`
resolves and the guard at `:30` fires before the `done` branch, so a stale run cannot write state.
Two readers cannot interleave.

**Four latent bugs** (`src/components/hooks/useStreamingText.ts`):

| #   | Bug                                                                                                                                                                                                                               | Why it matters for multi-turn                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| B1  | `[DONE]` sets `reading = false; break` (`:51-52`) which breaks only the inner per-line loop; the outer `while (boundary !== -1)` (`:41`) never tests `reading`. Remaining buffered events in the same chunk still call `setText`. | Benign today (server sends `[DONE]` last). A real bug the moment a terminator can appear mid-stream — i.e. per-turn framing. |
| B2  | The reader is never cancelled on `[DONE]`; it stays locked until the next effect's cleanup or a server close.                                                                                                                     | Leaks a connection per turn instead of per page.                                                                             |
| B3  | `if (!stream) return` (`:13`) bails _before_ the reset block (`:21-24`), so `setStream(null)` at `ChatDemo.tsx:38` leaves the previous answer on screen with `isDone === true` for the whole fetch.                               | A visible stale-answer flash on **every** follow-up question. Already logged as accepted debt: scaffold review F10.          |
| B4  | An `{"error": …}` frame sets `error` but not `isDone` (`:59`), so the pulsing caret keeps running until the trailing `[DONE]`.                                                                                                    | Fragile against any richer frame protocol.                                                                                   |

**No cancellation anywhere.** Repo-wide, the only abort primitive is `integration/globalSetup.ts:47`
(`AbortSignal.timeout`) — test infra. No `AbortController` in `src/`, no `signal` on any `fetch`, no
`signal` passed to the OpenAI SDK, and the server's `new ReadableStream({ async start(…) })`
(`src/pages/api/ai/chat.ts:61-79`) defines **no `cancel(reason)` handler**. When the client cancels,
the Worker keeps iterating the OpenRouter stream to completion. The whole generation also runs in
`start()` rather than `pull()`, so backpressure is ignored.

**Re-submit guard is incomplete.** `isSubmitting` clears in `finally` as soon as `res.body` is
assigned (`ChatDemo.tsx:60-62`), not when the stream ends — the button re-enables mid-stream and a
second question silently discards the first answer.

**The industry commit pattern** (Vercel AI SDK, verified): the **user message is written before the
call**; the **assistant message is written after the stream terminates**, from a server-side
accumulation buffer, never per-token. `consumeStream()` exists precisely to drain the stream server-
side "even when the client has already disconnected". Aborted/partial responses are persisted **with
a status**, not discarded and not stored as if whole — an unmarked partial poisons the next turn,
because the model imitates a reply that stops mid-word.

**Applied to this stack (verified):** `context.locals.cfContext` is the Cloudflare `ExecutionContext`
(read from `@astrojs/cloudflare/dist/utils/handler.js`), so `locals.cfContext.waitUntil(...)` is
available in API routes and gives **up to 30 s** after the response completes or the client
disconnects — ample for one Supabase insert. ⚠️ **`Astro.locals.runtime.ctx` was removed in
`@astrojs/cloudflare` v13** and now throws; every older tutorial is wrong for this repo. This is
already recorded in `context/archive/2026-08-24-swallowed-error-propagation/` and
`context/foundation/infrastructure.md:71` ("`waitUntil()` is the only post-response extension
point") — **a fire-and-forget write without it is silently dropped.**

**The error terminator is ambiguous.** `chat.ts:71-75` emits `{"error":"Stream failed"}` _and then_
`data: [DONE]`. With persistence added, the client must be able to distinguish truncation from
completion; the terminal frame needs a status.

### 3. OpenRouter: quota, model roulette, and what does not matter

**Quota (the finding that should drive the design).**

| Lifetime credits purchased | Requests/min | **Requests/day** |
| -------------------------- | ------------ | ---------------- |
| < $10                      | 20           | **50**           |
| ≥ $10                      | 20           | **1,000**        |

Governed **globally per account**, not per key — extra keys or accounts do not help. A 10-turn
conversation = 10 requests. Below the $10 threshold that is **five conversations per day across all
users**. ⚠️ _Unverified:_ the docs word the cap as applying to IDs ending in `:free`, and
`openrouter/free` does not literally end in `:free` though it forwards to models that do. Assume the
cap applies; confirm empirically via `GET /api/v1/key` (`is_free_tier`, `usage_daily`,
`limit_remaining`) and the `X-RateLimit-*` headers on a 429.

**Model roulette.** Live query of `GET /api/v1/models`:
`{"id":"openrouter/free","context_length":200000,"architecture":{"tokenizer":"Router"},"pricing":{"prompt":"0","completion":"0"},"top_provider":{"context_length":null}}`
— and `GET /api/v1/models/openrouter/free/endpoints` returns `"endpoints": []`. The docs say it
"automatically selects a free model **at random**" and "You cannot control which specific model is
selected." Today's pool spans **65,536 tokens** (`liquid/lfm-2.5-2.6b:free`) to **1,048,576**, with
"Free model availability changes frequently."

There is **no `pin_model` for the free router** — that option exists only on the Auto/AutoBeta router
plugins. The one available lever is **`session_id`** (top-level body field or `x-session-id` header,
≤256 chars, 10-minute inactivity expiry): it makes routing sticky and, for router models, "reuses
the **resolved model** on a best-effort basis when it remains in the current candidate set". ⚠️ The
docs name Auto Router and Pareto Router in that sentence, **not** the Free Models Router — so
whether resolved-model stickiness extends to `openrouter/free` is unverified and worth a two-request
experiment (same `session_id`, compare the `model` field in each response). Without it, OpenRouter
derives the sticky key by hashing the first system + first non-system message, which a fixed
system prompt + fixed first user turn keeps stable anyway.

**Two stream quirks the current parser is lucky to survive.** Every Chat-Completions stream ends
with an extra **usage chunk** before `[DONE]` — one choice, empty delta, `finish_reason` **repeated**
— which is where `usage.prompt_tokens` / `completion_tokens` can be read for real token accounting.
And OpenRouter injects SSE comment keepalives `: OPENROUTER PROCESSING`; the `openai` SDK strips
them, a hand-rolled parser must skip `:` lines.

**Mid-stream errors do reach the catch block** — verified in `node_modules/openai/core/streaming.js`
(`if (data && data.error) throw new APIError(...)`). But a chunk carrying `finish_reason: "error"`
_without_ a top-level `error` object is not caught. And once 200 is committed, **failover stops** —
no automatic retry mid-stream.

**`transforms: ["middle-out"]` no longer exists as such.** It was folded into the plugin system:
`plugins: [{ id: "context-compression", engine: "middle-out", enabled: true }]`. It is **on by
default for any endpoint with ≤8,192 context**, and without it, overflow is a hard 400. It truncates
**the middle** of the conversation — exactly where a diagnostics thread establishes symptoms and
prior recommendations — silently and unloggably. **Not advisable as the primary strategy**; fine as a
backstop so a pathological request degrades instead of 400ing, provided the fact is logged.

**Passing OpenRouter-only fields through the OpenAI SDK works** — `create(body, options)` forwards
the body verbatim (`node_modules/openai/resources/chat/completions/completions.js`), so `plugins`,
`session_id`, `provider` transmit fine. TypeScript rejects them, so a cast at the call site is the
small ergonomic tax.

### 4. Context and cost arithmetic

Assumptions: system prompt **101 tokens** (measured with `cl100k_base` against a realistic car),
user turn 60 tokens, assistant reply 350 tokens ⇒ ~410 tokens/turn.

| Turn | Input tokens | Cumulative input |
| ---: | -----------: | ---------------: |
|    1 |          161 |              161 |
|    3 |          981 |            1,713 |
|    5 |        1,801 |            4,455 |
|   10 |    **3,851** |       **20,060** |
|   20 |        7,951 |           81,120 |

- Multi-turn multiplies input token consumption **~12.5×** over ten one-shot questions. Growth is
  quadratic (`≈ T²/2 × 410`).
- **Dollar cost is $0** and stays $0. Tokens are not the scarce resource; requests are.
- **Overflow is a non-issue**: against the 64k floor, plain turns overflow around turn 160; fat turns
  (500-token paste + 1,500-token reply) around turn 33. A last-8-turns window stays under ~3.5k.
- **Prompt caching is inapplicable today**, on three independent grounds: the prices are zero so a
  discount on zero is zero; the 101-token prefix is below _every_ published minimum (lowest 1,024,
  first exceeded around turn 3–4); and random per-request model selection means a cold prefix nearly
  every turn since caches are per-provider-per-model.
- ⚠️ **Tokenizer caveat, measured:** Polish costs **2.86 chars/token** vs English **4.18** — the
  same text is ~45% more tokens in Polish. This app ships a Polish locale. A `chars/4` heuristic
  under-counts Polish by 30–45%; **use `chars/3`**, or read `usage.prompt_tokens` from the final
  usage chunk and calibrate from real data. Note the router's tokenizer is literally reported as
  `"Router"`, so any client-side count is an estimate against an unknown vocabulary — `js-tiktoken`
  (pure JS, no WASM config, per-encoding imports) is viable on Workers but is precision this change
  has not earned.

### 5. Schema, RLS and service conventions a `conversations`/`messages` pair must mirror

**Migration style.** Filename `YYYYMMDD00000N_snake_case_description.sql` — the timestamp tail is a
per-day **sequence counter**, not a clock (`20260528000000` … `20260528000003` all landed the same
day). Every recent migration opens with a **prose header** stating the threat model, why this is the
side to fix, and a "forward-only / safe on existing data" close (`20260825000000:1-26`,
`20260826000000:1-40`). Multi-table files use `-- ─── table ───…` banners. Column definitions are
aligned into three visual columns.

**Table shape.** `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` first; `user_id UUID NOT NULL
REFERENCES auth.users(id) ON DELETE CASCADE` on **every** table including children — denormalised,
not joined (`20260528000000:6`), and every RLS policy depends on that; parent FKs `ON DELETE
CASCADE`; `created_at`/`updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` always last. There is **not a
single `CREATE INDEX` in the whole migration set** — a gap, not a rule.

**RLS.** `ENABLE ROW LEVEL SECURITY` immediately after the table, then exactly four policies in
SELECT/INSERT/UPDATE/DELETE order named `"Users can {view|insert|update|delete} own <plural noun>"`,
all `TO authenticated` (retrofitted onto everything by `20260826000000:138-170` so they read
uniformly — a new table must not reintroduce the split). SELECT/DELETE get `USING` only; INSERT gets
`WITH CHECK` only; UPDATE gets **both**.

**The ownership idiom is load-bearing and was learned the hard way.** `20260825000000` closed a hole
where a user could insert an entry carrying their own `user_id` but pointing at someone else's car —
and because RLS then _hides_ that row from the car's owner, the victim cannot detect the pollution
(`:14-17`). `20260826000000` then closed the way around it: insert onto your own car, then `UPDATE`
the `car_id` to a foreign one, landing a byte-identical row (`:8-12`, verified against the running
stack: "the insert answers 403 42501, the two-step lands 200"). **A `messages` table inherits both
doors:**

```sql
auth.uid() = user_id
AND EXISTS (SELECT 1 FROM public.conversations
            WHERE conversations.id = messages.conversation_id
              AND conversations.user_id = auth.uid())
```

in **both** `USING` and `WITH CHECK` on UPDATE, and in `WITH CHECK` on INSERT.

**Triggers.** `CREATE TRIGGER <table>_updated_at BEFORE UPDATE … EXECUTE FUNCTION
public.set_updated_at();` per table. **Do not redefine `set_updated_at()`** — it exists from
`20260527000000:38-44`.

**Types are hand-written.** There is **no `database.types.ts` and no `supabase gen types` script.**
A new table means a hand-written entity interface (snake_case columns, `T | null` for nullable) plus
a `<Entity>FormData` command model (`?: T | null`) in `src/types.ts`, and `as` casts in the service
(`cars.ts:8`). Enum-ish values get a hand-written TS union mirroring the SQL.

**Service conventions** (`src/lib/services/cars.ts`, `entries.ts`): `supabase: SupabaseClient` is
always the first argument; every query chains an explicit `.eq("user_id", userId)` as **defense in
depth on top of RLS**, documented at `cars.ts:29-36` ("the filter is defense in depth, not the
isolation boundary — RLS is"); errors are uniformly `if (res.error) throw toServiceError(res.error,
"<functionName>")`; **absence is `null`, never a throw** (`services/errors.ts:14-15`);
`.maybeSingle()` + `T | null` for single reads, `.single()` + `T` for creates, `.delete()….select("id")`

- `boolean` for deletes.

**Route conventions**: `const ROUTE = "/api/…"` literal; exported `<noun>Schema` zod objects (so
`src/test/pages/api/schemas.test.ts` can assert them); `try { await request.json() } catch → 400
"Invalid JSON"`; `result.error.issues[0].message` on validation failure — **first issue only**;
every catch is exactly `return apiErrorResponse(err, { route: ROUTE, method, userId })`; 201 on
create, 204 on entry delete, and **404 not 403** for "not yours" (`repair.ts:79-82`).

**`src/lib/api-errors.ts` contract**: services throw databases, routes answer HTTP, translation
happens there and nowhere else; the client message is a **fixed literal** that never interpolates
anything Postgres said (because `23502`'s `details` carries the whole failing row including
`user_id`). Logging must be **one single object per `console.error`** — Cloudflare Logs indexes only
the top-level keys of one logged object (`:131-138`).

⚠️ **`src/pages/api/ai/chat.ts:55,72` is the only route still using the anti-pattern**
`console.error("[ai/chat] …", err)`. This is a _known, queued, unfixed_ finding —
`context/archive/2026-08-24-swallowed-error-propagation/follow-ups/review-fixes.md:38-73` (F9)
records an actual leak: `[ai/chat] Service error: Error: 401 Invalid API key: sk-or-test-LEAK`. The
response body is clean; Workers Logs is not. **If this change touches `chat.ts` anyway, that is the
cheapest moment to close it.**

**No admin/service-role client exists under `src/`, by rule** (`integration/fixtures/env.ts:8-11`).
Every write runs as the signed-in user under RLS — so **RLS must permit the app to write
AI-authored assistant messages**; there is no server identity to attribute them to. That is a real
design constraint on the `messages` INSERT policy.

### 6. Testing surface

- **Two vitest projects** (`vitest.config.ts:25-67`): `unit` (`src/test/**`, `environment: "node"`)
  and `integration` (`integration/**`, live Supabase, `singleFork` serial because
  `config.toml:190` caps sign-ins at 30 per 5 min).
- **There is no DOM environment and no React Testing Library** — `jsdom`/`happy-dom`/`@testing-library/*`
  are all absent from `package.json`. `useStreamingText` and `ChatDemo` have **zero unit coverage
  today and cannot be tested without adding a DOM env + RTL.** This is the single largest test-infra
  gap for a client-side chat rewrite.
- **8 of the 10 endpoint tests break** on a request-shape change, most of them indirectly: the
  shared fixture `{ prompt: "what oil does it take?" }` (`chat.test.ts:49`) must parse successfully
  for the "No car selected", 503, 404, 200-SSE, 500 and mid-stream-error cases to reach their
  assertions at all. Direct breaks: `toHaveBeenCalledWith("what oil does it take?", FIXTURE_CAR)`
  (`:153`), `createChatStream("any prompt", CAR)` (`ai-config.test.ts:37`), and the two literal zod
  messages (`:101-113`). Survivors: the 401 and invalid-JSON cases, and all of `ai.test.ts`.
- **"Dependency not called" is the R1 guard** — on the foreign-car 404,
  `expect(createChatStream).not.toHaveBeenCalled()` (`test-plan.md:213-216`).
- **RLS is tested twice or not at all.** `integration/isolation-cars.test.ts:41` records that the
  services' own `.eq("user_id")` short-circuits ahead of RLS, so those tests "would pass even with
  every policy dropped" — every cross-user assertion is therefore paired with a **raw PostgREST call
  carrying the user's own JWT** asserting `expect(raw.error?.code).toBe("42501")`. A
  `conversations`/`messages` table needs `integration/isolation-conversations.test.ts` in the same
  shape.
- **Automation tripwire**: a `.claude/settings.json` PostToolUse hook re-runs
  `src/test/lib/services/ai.test.ts` and `src/test/pages/api/ai/chat.test.ts` on any edit to
  `ai.ts`, `chat.ts`, or those specs. Expect it to fire constantly during implementation; budget for
  keeping them green step by step rather than at the end.
- **No E2E touches `/ai-chat`** — grep for `ai-chat|aiChat` across `e2e/` returns zero.
  `context/foundation/test-plan.md:100` confirms Phase 4 ("sign-in → ask AI → visible progress →
  grounded answer", risk R6) is **not started**, and `:152-153` says the unit+integration gate is
  already binding.

### 7. i18n

Four keys exist, in `src/i18n/locales/{en,pl}.json`:

| key                  | en                             | pl                                       |
| -------------------- | ------------------------------ | ---------------------------------------- |
| `aiChat.placeholder` | "Ask anything about your car…" | "Zapytaj cokolwiek o swoim samochodzie…" |
| `aiChat.ask`         | "Ask"                          | "Zapytaj"                                |
| `aiChat.sending`     | "Sending…"                     | "Wysyłam…"                               |
| `aiChat.assistant`   | "Assistant"                    | "Asystent"                               |

A transcript UI has **no key** for: the user's own role label, empty-conversation state,
stop/cancel generation, new/clear conversation, retry, copy, timestamps, a "history truncated"
notice, or a delete-conversation confirmation. All net-new in both files.

⚠️ **`locals.lang` is resolved on every request (`middleware.ts:39-42`) but never reaches the
model.** `buildSystemPrompt` has no locale input, so replies are always English-prompted regardless
of UI language. Today that is a per-question annoyance; **a persisted transcript makes it
permanent** — a Polish user ends up with a stored English conversation.

⚠️ `StreamingText.tsx:12` renders **plain text** (`whitespace-pre-wrap`) and there is no markdown
renderer in the repo. Model output with lists, headings or code fences renders raw. Acceptable for
one answer; conspicuous in a transcript.

---

## Recommendation: persist, server-authoritative history

**Recommendation: store conversations and messages in Supabase, and have the server rebuild the
message array from the database. The client sends `{ conversation_id, prompt }` — never a
transcript.**

The reasoning is not primarily "history should survive a refresh" (though `prd-v2.md:39` names
exactly that as the observed pain). It is that the alternative quietly reverses a decision the
codebase is built on:

- **Client-sent history reverses server-authoritative context.** The existing design resolves the car
  server-side specifically so the client cannot choose it
  (`context/archive/2026-06-02-ai-car-chat/plan-brief.md:21`). Letting the client supply the
  conversation hands it the model's entire context.
- **It opens a quota hole.** With a 50-requests/day account-wide cap and a client-supplied array, a
  single crafted request can carry an arbitrarily long transcript. Server-owned history is bounded
  by what the server itself wrote.
- **It widens the prompt-injection surface that F4 already flagged.** The chat review recorded
  (`context/archive/2026-06-02-ai-car-chat/reviews/impl-review.md:68`) that `sanitise()` is a
  stopgap and "risk grows significantly when repair entry text is added". Replayed prior turns are
  the same class of untrusted text; if the client authors them, it is worse than the same class.
- **Correct abort semantics require server-side accumulation anyway.** The commit-after-stream
  pattern reads the server's buffer, not the client's — so the server is already holding the
  assistant message. Persisting it is a `waitUntil` insert away.
- **There is no other store.** No KV, D1 or Durable Object binding exists (`wrangler.jsonc`).

So the in-memory option is not "the same feature, cheaper" — it is a different trust model that also
half-solves the stated pain. The extra cost of persisting is a migration, a service module, entity
types, and an `isolation-conversations` integration spec — all of which follow templates the repo
already has, in triplicate.

**Sizing to recommend alongside it:** a **last-8-turns** window with a character-budget guard
(`chars/3` for Polish safety), system prompt emitted **once** at the front and never repeated,
`session_id` set per conversation, and `context-compression` left enabled as a logged backstop.

**Two things worth deciding deliberately, not by default:**

1. **Pin a concrete free model instead of `openrouter/free`?** Model roulette is materially worse in
   a conversation than in one-shot chat, and the alias was already dissented on. Pinning costs the
   "always some free model is available" resilience the alias buys. Test `session_id` stickiness
   first — it may make this moot.
2. **Does the daily cap get a visible failure mode?** At 50 requests/day, hitting the limit is a
   matter of when. Today a 429 surfaces as a generic "AI service error". A rationed chatbot that
   cannot say it is rationed is worse than a one-shot one.

---

## Code References

- `src/pages/api/ai/chat.ts:8-10` — `promptSchema`, the request contract to change
- `src/pages/api/ai/chat.ts:24-32` — validation-before-DB ordering, pinned by tests
- `src/pages/api/ai/chat.ts:55,72` — the `console.error` anti-pattern with a known key leak (F9)
- `src/pages/api/ai/chat.ts:61-79` — `ReadableStream` with `start()` only, no `cancel()` handler
- `src/lib/services/ai.ts:35-47` — `createChatStream(prompt, car)`, hard-coded two-message array
- `src/lib/services/ai.ts:13-16` — `sanitise()`, the prompt-injection stopgap
- `src/components/ai/ChatDemo.tsx:29-32,38,60-62` — single-stream state, stale-answer reset, early `isSubmitting` clear
- `src/components/hooks/useStreamingText.ts:21-24,41-52,76-79` — state reset, `[DONE]` inner-loop break, cleanup
- `src/components/ai/StreamingText.tsx:12` — plain-text rendering, no markdown
- `src/middleware.ts:7,30,37,39-42` — `PROTECTED_ROUTES` (no `/api` prefix), `locals.user`, unvalidated `selected_car_id`, `locals.lang`
- `src/lib/api-errors.ts:24-28,131-138,171-182` — fixed-literal messages, single-object logging, `apiErrorResponse`
- `src/lib/services/cars.ts:29-36` — "defense in depth, not the isolation boundary"
- `supabase/migrations/20260825000000_entry_insert_car_ownership.sql:1-26,35-42` — the ownership `EXISTS` idiom and its threat model
- `supabase/migrations/20260826000000_entry_update_car_ownership.sql:8-12,138-170` — the UPDATE-around-it hole; `TO authenticated` retrofit
- `integration/isolation-cars.test.ts:41-50` — why every RLS assertion is made twice
- `src/test/pages/api/ai/chat.test.ts:49,101-113,153` — the fixture and assertions that break on a new request shape
- `vitest.config.ts:25-67` — the two projects; no DOM environment
- `wrangler.jsonc` — no KV/D1/DO bindings, no `limits.cpu_ms`, observability on

## Architecture Insights

- **Server authority is the spine of this codebase.** Car selection, ownership checks, error
  translation and prompt assembly are all server-side by explicit decision, each with a recorded
  rationale. A chat design that moves state to the client cuts across all of it.
- **RLS is the isolation boundary; service filters are defense in depth** — and the integration
  suite exists precisely because the second would hide the absence of the first.
- **Absence is data, not an error** (`services/errors.ts:14-15`) — `null`, not a throw.
- **Nothing Postgres authored crosses to the client** (`api-errors.ts:13-14`), and every log is one
  flat object because that is what Cloudflare indexes.
- **Migrations argue their case in prose before they change anything.** The two ownership migrations
  read like incident write-ups. A new migration that does not is out of style.
- **Cloudflare's cost model is CPU, not wall-clock.** Waiting on OpenRouter is free; holding a
  stream open for minutes is fine on both plans. What costs is your own JS — the per-chunk
  `JSON.stringify` + `TextEncoder.encode` loop, which a longer `messages` array makes heavier.
  `context/foundation/infrastructure.md:53` already records the free tier's 10 ms CPU cap as
  "effectively unusable for SSR" with the $5/mo plan as the real floor, and `:61` records observed
  503s from it.

## Historical Context (from prior changes)

- `context/foundation/prd.md:41-50` — **US-01**, the only AI user story. AC-2 ("If matching entries
  exist, the response explicitly references them") and **FR-011** are **still unimplemented** —
  `buildSystemPrompt` uses car fields only. A standing must-have gap, adjacent to this change.
- `context/foundation/prd.md:92` — the NFR that constrains any chat rework: _"Any AI assistant query
  must display continuous visible progress… The absence of any visible feedback during AI processing
  is a regression."_
- `context/foundation/prd-v2.md:39` — the observed pain, verbatim: _"AI Chat has no loading
  feedback…, **no conversation history, entries reset on page reload**…"_
- `context/foundation/prd-v2.md:142` (mirrored at `roadmap.md:170`, `shape-notes.md:147`) — parks
  "conversation history, persistence across reloads" as _"a separate future change"_. **This is that
  change.**
- 🚩 **Three documents record "single-turn only" as a decision**:
  `context/archive/2026-06-01-ai-integration-scaffold/plan.md:34`,
  `context/archive/2026-06-02-ai-car-chat/plan.md:34`, and the prd-v2 non-goal. **None is a product
  objection** — all three are scope deferrals, and prd-v2 names the successor explicitly. What this
  change genuinely reverses are two plan-level guardrails: the `{prompt}` /
  `createChatStream(prompt, car)` shape, and _"No change to `ChatDemo.tsx`, `useStreamingText`, or
  `StreamingText`"_ — a guardrail that expired with S-02 and was already breached by the light/dark
  change.
- `context/archive/2026-06-02-ai-car-chat/reviews/impl-review.md` — F1/F2 (IDOR: check ownership at
  the application layer on **both** the route and the SSR page; **404 not 403**), F3 (validate before
  the DB round-trip), **F4 (prompt injection — `sanitise()` is a stopgap, "risk grows significantly"
  with free text)**, F5 (never forward raw SDK error text).
- `context/archive/2026-06-01-ai-integration-scaffold/reviews/impl-review.md:62-79` — F3: the
  `openrouter/free` alias is non-deterministic and was **knowingly kept**; the reviewer's dissent
  ("Model drift is silent and untraceable in production… bad for a foundation that S-02 builds on")
  is on record. F10: the `setStream(null)` flicker, skipped as an accepted scaffold trade-off.
- `context/archive/2026-08-24-swallowed-error-propagation/follow-ups/review-fixes.md:38-73` — **F9,
  still open**: the API key leaks into Workers Logs from `chat.ts`. Constraint attached: the eight
  `toEqual` envelope assertions in `chat.test.ts` must stay green.
- `context/foundation/test-plan.md:421-424` — resource abuse / rate-limiting of the free model
  deliberately not tested, _"re-evaluate if AI cost or abuse becomes a live problem."_
- **Roadmap position**: both roadmaps are 100% done and the current one's Open Questions section is
  empty. This is a **standalone post-roadmap change** — the direct successor to the parked item. The
  informal **"S-02 addendum" (entry context in the AI prompt)** remains unclaimed
  (`context/archive/2026-06-02-ai-car-chat/change.md:15`); decide explicitly whether this change
  absorbs it. F4 argues they interact — replayed turns and repair free-text are the same untrusted-
  text class.

## Related Research

- `context/archive/2026-06-15-testing-bootstrap-ai-chat/research.md` — the AI chat test contracts
- `context/archive/2026-08-24-swallowed-error-propagation/research.md` — the error/logging contract
- `context/archive/2026-06-15-data-isolation-crud-integrity/research.md` — the RLS testing method
- `context/archive/2026-06-09-sidebar-navigation/research.md`, `context/archive/2026-08-31-light-dark-mode/research.md`

## Open Questions

1. **Does the 50/day cap actually apply to `openrouter/free`?** Unverified — the docs word it for
   IDs ending in `:free`. One `GET /api/v1/key` call settles it, and the answer changes how urgent
   quota handling is.
2. **Does `session_id` pin the resolved model on the free router?** Documented for Auto/Pareto
   routers only. A two-request experiment comparing the response `model` field settles it, and the
   answer decides whether to pin a concrete free model.
3. **Conversation granularity**: one rolling thread per car, or multiple named threads? Affects the
   schema and the UI, not the request contract.
4. **What happens to chat history when a car is deleted?** A `car_id FK ON DELETE CASCADE` means it
   vanishes silently. That behaviour is already E2E-pinned for entries
   (`e2e/car-delete-blast-radius.spec.ts`) — decide deliberately and add the analogous coverage.
5. **Is switching cars mid-conversation allowed?** `selectedCarId` is read fresh from an unvalidated
   cookie on every POST, so today it would silently swap the system prompt while the transcript
   continues. A conversation probably needs to own its `car_id` rather than re-read the cookie.
6. **Does the transcript get locale?** Fixing `locals.lang → buildSystemPrompt` is small; leaving it
   makes stored Polish conversations permanently English-prompted.
7. **Markdown rendering** — worth adding now, or explicitly deferred?
8. **Vercel AI SDK, or hand-roll?** It solves exactly the persistence + abort problems here, and
   OpenRouter's own docs recommend it — but Astro is **not** a first-party target, it would replace
   `ai.ts`, `chat.ts`, `ChatDemo.tsx`, `useStreamingText.ts` and their specs wholesale, its footprint
   needs measuring against a 3 MB gzipped Worker budget, and it churns hard (7.0.88 → 7.0.90 in ~10
   hours, four concurrently-maintained majors). The value it adds here is ~60–100 lines of
   hand-written code; the value grows sharply only if tool calls, structured outputs or attachments
   are coming.
9. **Does F9 (the key leak in `chat.ts` logging) get folded into this change?** Cheapest moment is
   while `chat.ts` is already open.
10. **Does adding jsdom + React Testing Library belong in this change?** Without it the entire client
    half of a chat rewrite ships untested, and there is no `/ai-chat` E2E either.
