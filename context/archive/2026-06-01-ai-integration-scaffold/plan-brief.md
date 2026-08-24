# AI Integration Scaffold — Plan Brief

> Full plan: `context/changes/ai-integration-scaffold/plan.md`

## What & Why

Wire OpenRouter's free-tier AI API to the Cloudflare Workers runtime using SSE streaming, then build the React components needed to consume that stream in the UI. This foundation must exist before S-02 (the north-star milestone) can be built — S-02 wires real car context into the prompt, but it inherits all the streaming transport from here.

## Starting Point

No AI library, no streaming code, and no `text/event-stream` response exists anywhere in the codebase. Every existing API route returns `Response.json()`. The `openai` npm package and `OPENROUTER_API_KEY` both need to be introduced from scratch.

## Desired End State

A developer running `wrangler dev` can navigate to `/ai-test` (while logged in), type any prompt, and watch tokens stream into the response area in real time with a blinking cursor. The `useStreamingText` hook and `StreamingText` component are reusable artifacts ready for S-02 to consume without modification. OpenRouter is configured with a free-tier model — zero token cost during development.

## Key Decisions Made

| Decision              | Choice                                                                      | Why (1 sentence)                                                                                        | Source            |
| --------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------- |
| AI provider           | OpenRouter (developer-held key)                                             | Free-tier models cost $0, no user friction vs. BYOK, right size for MVP scale                           | Plan              |
| Model for scaffold    | `google/gemini-2.0-flash-exp:free`                                          | Costs nothing; capable enough to prove streaming works before S-02 picks a production model             | Plan              |
| Client library        | `openai` npm SDK pointed at OpenRouter                                      | ESM-compatible, handles SSE chunk parsing via async iterable, officially endorsed by OpenRouter         | Plan              |
| Streaming primitive   | Native `ReadableStream` constructor                                         | Required by Cloudflare Workers runtime — Node.js `Readable` throws at runtime even with `nodejs_compat` | Infrastructure.md |
| SSE event format      | Custom: `data: {"text":"<delta>"}`, `data: [DONE]`, `data: {"error":"..."}` | Simplest client-side parsing; server handles all OpenAI delta extraction                                | Plan              |
| Auth on AI route      | Protected from the start (401 if no session)                                | Consistent with every other API route; prevents unguarded OpenRouter spend                              | Plan              |
| Verification artifact | `/ai-test` demo page with streaming UI                                      | Proves the full stack (route → SSE → React consumer) end-to-end; loading component has a real host      | Plan              |
| Error UX              | Inline error below partial text                                             | User keeps partial response; consistent with the streaming display component                            | Plan              |

## Scope

**In scope:**

- `openai` SDK installed + env var registered
- `src/lib/services/ai.ts` — `createChatStream()` service function
- `src/pages/api/ai/chat.ts` — auth-guarded POST route streaming SSE
- `src/components/hooks/useStreamingText.ts` — stream-reading hook
- `src/components/ai/StreamingText.tsx` — incremental text display with cursor
- `src/components/ai/ChatDemo.tsx` — form + fetch orchestration
- `src/pages/ai-test.astro` — protected demo page
- End-to-end verification under `wrangler dev`

**Out of scope:**

- Car make/model/year or entry data in the AI prompt (S-02)
- Persistent chat history or multi-turn conversations
- Retry logic, rate limiting, or cost controls
- Production model selection
- Polish on the demo page UI

## Architecture / Approach

```
Browser                      Worker (wrangler dev)
──────                       ─────────────────────
ChatDemo
  └─ fetch POST /api/chat ─→ src/pages/api/ai/chat.ts
                               └─ createClient() [auth check]
                               └─ createChatStream(prompt)
                                    └─ openai SDK → OpenRouter → free model
                               └─ new ReadableStream { enqueue SSE events }
        response.body (stream) ←─ text/event-stream response
  └─ useStreamingText(stream)
  └─ <StreamingText text isDone error />
```

Client reads `response.body` directly — no WebSocket, no polling, no third-party EventSource library.

## Phases at a Glance

| Phase                         | What it delivers                                 | Key risk                                                                                    |
| ----------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| 1. API Route + OpenRouter     | Streaming POST endpoint verified via curl        | openai SDK ESM compatibility on Workers (mitigated by `nodejs_compat` flag already present) |
| 2. Streaming React Components | useStreamingText hook + StreamingText + ChatDemo | SSE buffer fragmentation in the hook — partial lines must be buffered correctly             |
| 3. Demo Page + Verification   | `/ai-test` page + full wrangler dev smoke test   | This is the definition-of-done; don't mark complete until end-to-end streaming is confirmed |

**Prerequisites:** Local Supabase running (`npx supabase start`), `OPENROUTER_API_KEY` obtained from openrouter.ai (free account, no billing required for free-tier models)

**Estimated effort:** ~1 session across 3 phases

## Open Risks & Assumptions

- `google/gemini-2.0-flash-exp:free` availability is not guaranteed by OpenRouter — if the model is removed, swap to another free model in `src/lib/services/ai.ts` (one-line change)
- The `openai` SDK version pinned at install time may have transitive CJS dependencies in minor versions — run `npm run build` after install to confirm bundle passes before writing any other code

## Success Criteria (Summary)

- `wrangler dev` + `/ai-test` + a typed prompt → tokens appear in real time
- `wrangler tail` shows no runtime errors during streaming
- Unauthenticated visit to `/ai-test` redirects to sign-in
