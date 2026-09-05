# Multi-turn AI Chat with Persisted Conversation History — Plan Brief

> Full plan: `context/changes/ai-chat-history/plan.md`
> Research: `context/changes/ai-chat-history/research.md`

## What & Why

Today `/ai-chat` answers one question and forgets it. Users expect a chatbot: a thread they can
follow up in, that is still there after a reload. This change turns the page into per-car
conversation threads with server-owned, Supabase-persisted history, and while the chat route is open
it also feeds the car's logged entries into the prompt (the PRD's US-01 AC-2, deferred since S-02)
and closes the F9 log leak.

## Starting Point

Every layer is single-turn by construction: a `{ prompt }` schema, a two-message array in
`createChatStream`, one `stream` in `ChatDemo`, a hook that resets on every read. There is no
`conversations` table, no abort anywhere, no DOM test environment, and `locals.lang` never reaches
the model. The research established that the free OpenRouter router is capped at 50 requests/day
account-wide, picks a random model per request, and that a last-8-turns window is only ~3.5k tokens.

## Desired End State

Open `/ai-chat`, land on the most recent thread for the selected car, ask, follow up, reload — it is
all still there. A thread list per car with "New chat" and delete. Stop mid-answer and the partial
stays visible, marked interrupted, and is not replayed. A hit on the daily cap says so, in the user's
language. Polish users get Polish answers that reference their logged entries when relevant.

## Key Decisions Made

| Decision                          | Choice                                                                                                              | Why (1 sentence)                                                                                               | Source          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------- |
| Where history lives               | Supabase, server-authoritative; client sends `{ conversation_id?, prompt }`                                         | Client-sent transcripts reverse server authority and open a quota and injection hole; there is no other store. | Research        |
| Thread granularity                | Multiple threads per car; list scoped to the selected car                                                           | Chatbot mental model; car scoping keeps context and RLS simple.                                                | Plan            |
| Car binding                       | Conversation owns `car_id`; `ON DELETE CASCADE`; foreign-car thread → 404                                           | Mirrors entries; the system prompt can never swap under a transcript.                                          | Plan            |
| Partial replies                   | `messages.status` in `complete/aborted/error`; commit after stream via `waitUntil`; replay complete pairs only      | Unmarked partials poison the next turn; orphan exclusion keeps strict role alternation.                        | Research + Plan |
| Titles and URLs                   | Title from first prompt (60 chars); `/ai-chat` opens most recent, `/ai-chat/[id]` deep-links, `?new=1` starts empty | No naming friction and no extra LLM request against a 50/day cap.                                              | Plan            |
| Daily cap                         | Map SDK 429 to a distinct translated message and a flat log line with rate-limit headers; no app limiter yet        | Honest failure mode now; limiter waits for usage data.                                                         | Plan            |
| Model                             | Keep `openrouter/free`, `session_id` = conversation id, store resolved model per message                            | Preserves availability; drift becomes observable before deciding to pin.                                       | Plan            |
| Locale                            | `buildSystemPrompt(car, { locale, entries })`; locale fixed per thread                                              | A persisted transcript would otherwise lock Polish users into English.                                         | Plan            |
| Entries in prompt (S-02 addendum) | Last 10 entries in a delimited, sanitised, length-capped block framed as data                                       | Closes AC-2 / FR-011 while respecting F4.                                                                      | Plan            |
| F9                                | Replace both `console.error` calls with `logApiError`                                                               | Key leak into Workers Logs; cheapest moment.                                                                   | Plan            |
| Markdown                          | `react-markdown` + `remark-gfm`, no raw HTML                                                                        | Lists and code fences look broken raw in a transcript.                                                         | Plan            |
| Client tests                      | Third vitest project (jsdom + RTL); hook and SSE parser tests; no E2E in this change                                | The four latent streaming bugs are hook-level regressions.                                                     | Plan            |
| Context window                    | Last 8 complete pairs, 12k-char guard (`chars/3` Polish assumption)                                                 | Overflow is a non-issue at realistic sizes; the guard bounds abuse.                                            | Research        |

## Scope

**In scope:**

- Migration for `conversations` + `messages` with two-door RLS, indexes, trigger; entity types; service
- `POST /api/ai/chat` create-or-resume with commit-after-stream, `meta` and `done` frames, 429 mapping, F9
- `DELETE /api/ai/conversations/[id]`
- Prompt: locale sentence, entries block; `createChatStream` with history, `session_id`, abort signal
- `client` vitest project; `useConversation` hook; SSE parser
- `ChatThread`, `MessageBubble`, `ConversationList`, delete dialog, `ChatShell`; `/ai-chat` and `/ai-chat/[id]`
- EN/PL strings; integration isolation spec; route/hook/parser unit tests
- Live checks: cap applicability, `session_id` stickiness, bundle size

**Out of scope:**

- App-side per-user rate limiter; model pinning; renaming, search, export of threads
- Summarisation or explicit middle-out; token counting; prompt caching
- Vercel AI SDK; Playwright E2E for `/ai-chat`

## Architecture / Approach

Client island → `POST /api/ai/chat { conversation_id?, prompt }` → route resolves user, car,
thread (or creates one), loads messages, builds the window of complete pairs, fetches recent entries,
inserts the user turn, calls OpenRouter with `[system, …window, user]` + `session_id` + abort signal
→ SSE `meta`, `text…`, `done:<status>`, `[DONE]` → after the upstream ends (or the client cancels),
the buffered reply is inserted under `waitUntil` with its status. Pages are SSR: `/ai-chat` lists
threads for the selected car and redirects to the newest; `/ai-chat/[id]` renders a thread. A shared
`src/lib/chat.ts` holds the frame types, window function and title rule.

## Phases at a Glance

| Phase                       | What it delivers                                                                                                                  | Key risk                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1. Schema, types, service   | Tables + RLS + indexes, types, `conversations.ts`, `getRecentEntries`, isolation spec                                             | Missing a door in the RLS predicate; the spec is what catches it  |
| 2. Server                   | Prompt with locale/entries, abortable stream, create-or-resume route, commit-after-stream, 429, F9, DELETE route, rewritten tests | `cancel()`/completion race and `waitUntil` correctness on workerd |
| 3. Client test infra + hook | jsdom + RTL project, SSE parser, `useConversation` with pinned contract                                                           | jsdom/Node stream globals; TSX under vitest                       |
| 4. UI, pages, i18n          | Transcript with markdown, thread list, delete, two pages, EN/PL copy                                                              | Auto-scroll and mobile layout polish; bundle growth               |
| 5. Verification             | Live OpenRouter checks, bundle size, cascade/429 spot-checks, docs                                                                | Experiments may show the cap binds harder than assumed            |

**Prerequisites:** local Supabase running for Phases 1 and 5; an `OPENROUTER_API_KEY` for Phase 2/4/5
manual checks; `npm run dev` on workerd (not Node) for any `waitUntil` verification.
**Estimated effort:** ~5 sessions, one per phase; Phase 2 and Phase 4 are the largest.

## Open Risks & Assumptions

- Whether the 50/day cap applies to the `openrouter/free` alias, and whether `session_id` pins the
  resolved model there, are unverified; Phase 5 measures both, and neither changes the code.
- `cfContext` typing may need `@cloudflare/workers-types` in `tsconfig`; verify before adding.
- Some upstream free models may still reject unusual role sequences; the complete-pairs window keeps
  strict alternation to minimise that.
- The user message is persisted before the model call, so a 429/500 leaves a question without an
  answer in the thread; the UI shows it with the error, and the next turn excludes it from the window.
- Auto-title from the first prompt is crude by design; renaming is a follow-up.

## Success Criteria (Summary)

- A follow-up question is answered in context, and the whole thread survives a reload and a fresh
  sign-in; threads are scoped per car and vanish with the car.
- Stopping mid-reply, hitting the daily cap, or an upstream failure each leave the thread in a
  clearly marked, recoverable state — never a silent partial or a generic error.
- Three vitest projects green, `astro check` and `eslint` clean, and the isolation spec proves no
  cross-user door exists on either new table.
