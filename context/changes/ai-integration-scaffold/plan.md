# AI Integration Scaffold Implementation Plan

## Overview

Wire the `openai` npm SDK (pointed at OpenRouter's free tier) to an auth-guarded Astro API route that streams server-sent events using native `ReadableStream`. Add a `useStreamingText` hook and `StreamingText` component that consume the stream client-side with incremental text rendering and a blinking cursor. Verify the full stack end-to-end on a protected `/ai-test` demo page under `wrangler dev`.

This is a transport proof — no car context is sent to the AI here. S-02 wires the real prompt once streaming is confirmed working.

## Current State Analysis

- No AI library or streaming code exists anywhere in the codebase
- `wrangler.jsonc` already has `compatibility_flags: ["nodejs_compat"]` — the Workers ESM risk from `infrastructure.md` is pre-mitigated
- All API routes return `Response.json()` — this plan introduces the first `text/event-stream` response
- Env secrets flow through `astro:env/server` schema in `astro.config.mjs`; `OPENROUTER_API_KEY` needs to be added there
- Services live in `src/lib/services/` as plain async functions (see `src/lib/services/cars.ts`)
- React hooks belong in `src/components/hooks/` per CLAUDE.md (directory doesn't exist yet)
- Existing loading affordance: inline `animate-spin` spinner in `src/components/auth/SubmitButton.tsx:22` — no standalone streaming display component exists

## Desired End State

A developer running `wrangler dev` can navigate to `/ai-test` (while logged in), type any prompt, submit, and watch tokens stream into the response area in real time. The blinking cursor is visible during streaming and disappears when the stream closes. An unauthenticated visit redirects to sign-in. The `StreamingText` component and `useStreamingText` hook are ready for S-02 to consume without modification.

### Key Discoveries

- `src/lib/supabase.ts` creates a Supabase client per request via `createClient(requestHeaders, cookies)` — the AI route follows the same pattern for the auth check
- `context.locals.user` is set by middleware on every request; auth guard is a one-liner at the top of the route (pattern: `src/pages/api/cars/index.ts:30`)
- `astro.config.mjs:17-22` shows the env schema shape — `OPENROUTER_API_KEY` slots in beside the existing Supabase vars
- `src/middleware.ts:4` — `PROTECTED_ROUTES` array is the single place to add `/ai-test`
- `src/pages/cars.astro` shows the Astro + React island pattern: server-fetch, pass props, `client:load`

## What We're NOT Doing

- Sending car make/model/year or logged entries in the prompt — that is S-02 scope
- Building a persistent chat history or message threading — single-turn only
- Retry logic or rate limiting on the OpenRouter call
- A production-hardened error boundary — basic inline error is sufficient for a scaffold
- Streaming to non-demo pages — `/ai-test` is the only consumer at this stage

## Implementation Approach

Three-layer stack: service → API route → React components.

**Service** (`src/lib/services/ai.ts`): configures the `openai` SDK with OpenRouter's base URL and the developer-held API key. Returns the SDK's async iterable stream. Keeps the route thin.

**API route** (`src/pages/api/ai/chat.ts`): auth-checks, Zod-validates the prompt, calls the service, then wraps the iterable in a native `ReadableStream` that emits SSE events. The `ReadableStream` constructor is the only safe streaming primitive on the Workers runtime.

**React layer**: a `useStreamingText` hook reads the stream and accumulates text; a `StreamingText` component renders it with a cursor; a `ChatDemo` component owns the form and fetch, connecting them.

## Critical Implementation Details

**Native ReadableStream is mandatory on Workers.** The API route must construct `new ReadableStream({ async start(controller) { ... } })` and iterate the openai SDK stream inside `start`. Passing a Node.js `Readable` or using `pipeline` will throw at runtime on the deployed Worker even with `nodejs_compat` enabled — the flag polyfills Node.js builtins but does not expose them as valid `Response` body types.

**SSE response headers prevent buffering.** The streaming response must include `Cache-Control: no-cache` and `Content-Type: text/event-stream`. Without `Cache-Control: no-cache`, Cloudflare's edge may buffer the entire response before forwarding it, defeating the purpose of streaming.

**SSE line buffer in the hook.** The `ReadableStreamDefaultReader` delivers arbitrary binary chunks that do not align with SSE event boundaries. The `useStreamingText` hook must maintain a partial-line string buffer, append each decoded chunk, split on `\n\n`, and process only complete events. Incomplete trailing text stays in the buffer for the next read.

---

## Phase 1: API Route + OpenRouter Integration

### Overview

Install the `openai` npm package, register `OPENROUTER_API_KEY` in the env schema, create the AI service, and expose the streaming POST route. After this phase the full backend chain is verifiable with `curl`.

### Changes Required

#### 1. Install openai SDK

**File**: `package.json` (via shell — `npm install openai`)

**Intent**: Add the `openai` npm package (v4+) as a production dependency. OpenRouter officially supports the openai SDK as a proxy client; this is its recommended integration path.

**Contract**: Package name `openai`, version `^6.x` (v6.39.1 installed). ESM-compatible — no bundler configuration required.

#### 2. Register OPENROUTER_API_KEY in env schema

**File**: `astro.config.mjs`

**Intent**: Declare `OPENROUTER_API_KEY` as a server-only secret in the `astro:env` schema so it is available via `import { OPENROUTER_API_KEY } from 'astro:env/server'` and validated at build time.

**Contract**: Add inside the existing `env.schema` block alongside `SUPABASE_URL` and `SUPABASE_KEY`:
```ts
OPENROUTER_API_KEY: envField.string({ context: "server", access: "secret" }),
```

#### 3. Update .env.example

**File**: `.env.example`

**Intent**: Document the new required env var so any developer setting up the project knows to add it.

**Contract**: Append `OPENROUTER_API_KEY=###` as a new line.

#### 4. Create AI service

**File**: `src/lib/services/ai.ts`

**Intent**: Encapsulate OpenRouter API setup and model selection. Export a single `createChatStream(prompt: string)` function that returns the openai SDK streaming completion — an async iterable of `ChatCompletionChunk` objects. Keeps the API route thin and makes the model/baseURL easy to change in one place.

**Contract**: Imports `OPENROUTER_API_KEY` from `astro:env/server`. Constructs an `OpenAI` client with `baseURL: 'https://openrouter.ai/api/v1'` and `apiKey: OPENROUTER_API_KEY`. Calls `client.chat.completions.create` with `model: 'google/gemini-2.0-flash-exp:free'`, a minimal system prompt (`'You are a helpful car assistant.'`), the user `prompt`, and `stream: true`. Returns the result directly.

#### 5. Create AI chat API route

**File**: `src/pages/api/ai/chat.ts`

**Intent**: Auth-guard the endpoint, validate the request body, call `createChatStream`, and return a `text/event-stream` response using a native `ReadableStream`. This is the only correct streaming primitive on the Cloudflare Workers runtime.

**Contract**:
- Export `POST: APIRoute`
- Return `401` if `context.locals.user` is null
- Parse body with `request.json()`, validate with Zod: `z.object({ prompt: z.string().min(1).max(2000) })`; return `400` on failure
- Call `createChatStream(prompt)` and wrap the async iterable in `new ReadableStream({ async start(controller) { ... } })`
- Inside `start`: for each chunk, extract `chunk.choices[0]?.delta?.content`; if non-empty, enqueue `data: {"text":"<delta>"}\n\n`; after the loop, enqueue `data: [DONE]\n\n`; on error, enqueue `data: {"error":"Stream failed"}\n\n`; always call `controller.close()`
- Return `new Response(readableStream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } })`

### Success Criteria

#### Automated Verification

- `npm run lint` passes with no new errors
- `npm run build` completes — confirms `OPENROUTER_API_KEY` is accepted by the env schema

#### Manual Verification

- `wrangler dev` starts without errors
- `curl -N -X POST -H "Cookie: <valid-session-cookie>" -H "Content-Type: application/json" -d '{"prompt":"What engine options did the Renault Clio 2 have?"}' http://localhost:4321/api/ai/chat` returns a sequence of `data: {"text":"..."}` lines followed by `data: [DONE]`
- Same request without a session cookie returns HTTP 401
- Request with `prompt: ""` returns HTTP 400

**Implementation Note**: After Phase 1 automated and manual verification passes, confirm with the human before proceeding to Phase 2.

---

## Phase 2: Streaming React Components

### Overview

Build the client-side streaming stack: a hook that reads and parses the SSE stream, a display component with a blinking cursor, and a demo orchestration component that ties form input to stream output.

### Changes Required

#### 1. Create useStreamingText hook

**File**: `src/components/hooks/useStreamingText.ts`

**Intent**: Isolate all stream-reading complexity in a single reusable hook so that `StreamingText` and any future AI UI components stay declarative. The hook accepts a live `ReadableStream<Uint8Array> | null` and drives re-renders as tokens arrive.

**Contract**: Signature: `function useStreamingText(stream: ReadableStream<Uint8Array> | null): { text: string; isDone: boolean; error: string | null }`. Uses `useEffect` keyed on `stream` identity. On a non-null stream: acquires a `ReadableStreamDefaultReader`, maintains a `buffer` string for partial SSE lines, decodes each chunk with `TextDecoder`, splits on `\n\n`, processes complete `data: ...` lines — appending to `text` state on `{"text":"..."}`, setting `isDone` on `[DONE]`, setting `error` on `{"error":"..."}` or a reader exception. Calls `reader.cancel()` in the `useEffect` cleanup. Returns `{ text: '', isDone: false, error: null }` when `stream` is null.

#### 2. Create StreamingText component

**File**: `src/components/ai/StreamingText.tsx`

**Intent**: Pure display component for streaming AI output. Renders accumulated text with a blinking cursor appended while streaming is in progress, and an inline error message below the text if the stream failed.

**Contract**: Props: `{ text: string; isDone: boolean; error: string | null }`. Renders text in a `<div>` with `whitespace-pre-wrap`. Appends `<span className="animate-pulse inline-block">▋</span>` when `!isDone && !error`. Below the text: `<p className="mt-2 text-sm text-destructive">` containing `error` when non-null. Renders nothing (returns `null`) when `text` is empty and `error` is null and `isDone` is false.

#### 3. Create ChatDemo component

**File**: `src/components/ai/ChatDemo.tsx`

**Intent**: Demo orchestration component. Owns form state and the fetch lifecycle; connects user input to the stream consumer. Designed to be mounted with `client:load` on the demo page.

**Contract**: `useState` for: `prompt` (string), `isSubmitting` (boolean), `stream` (`ReadableStream<Uint8Array> | null`), `fetchError` (`string | null`). On form submit: validate prompt non-empty, set `isSubmitting`, POST to `/api/ai/chat` with `{ prompt }`, on success set `stream` to `response.body`, on non-2xx extract JSON error and set `fetchError`; always clear `isSubmitting`. Renders a `<textarea>` (or `<Input>`) bound to `prompt`, a submit `<Button>` disabled while `isSubmitting`, and below it `<StreamingText>` with values from `useStreamingText(stream)`. Clears `stream` and `fetchError` on each new submission.

### Success Criteria

#### Automated Verification

- `npm run lint` passes
- TypeScript reports no errors in new files (`npm run build`)

#### Manual Verification

- On the demo page (Phase 3): component renders a form without console errors
- On submit the response area appears and tokens populate in real time (requires Phase 3 to observe)

**Implementation Note**: Phase 2 automated checks can run immediately. Manual checks are deferred to Phase 3. Confirm automated checks pass before proceeding.

---

## Phase 3: Demo Page + wrangler dev Verification

### Overview

Mount `ChatDemo` on a protected Astro page, add the route to `PROTECTED_ROUTES`, and execute the end-to-end smoke test under `wrangler dev`. This phase's sole purpose is proving the full stack works on the Workers runtime — not polishing the UI.

### Changes Required

#### 1. Add /ai-test to PROTECTED_ROUTES

**File**: `src/middleware.ts`

**Intent**: Redirect unauthenticated visitors to sign-in, consistent with every other protected route. One-line change.

**Contract**: Add `"/ai-test"` to the `PROTECTED_ROUTES` array at `src/middleware.ts:4`.

#### 2. Create ai-test page

**File**: `src/pages/ai-test.astro`

**Intent**: Host the `ChatDemo` React island for end-to-end verification. Minimal — just enough layout to use comfortably during testing.

**Contract**: Frontmatter imports `Layout` and checks `Astro.locals.user` (middleware handles redirect but explicit check mirrors `dashboard.astro`). Template: `<Layout title="AI Test">` wrapper, a heading, and `<ChatDemo client:load />`.

### Success Criteria

#### Automated Verification

- `npm run build` passes with no type errors

#### Manual Verification (wrangler dev)

- Visit `/ai-test` logged out → redirected to `/auth/signin`
- Visit `/ai-test` logged in → page loads, form is visible
- Type a prompt (e.g., "What are common faults of the Renault Clio 2?"), submit → tokens appear in the response area in real time
- Blinking cursor is visible during streaming; disappears when done
- `wrangler tail` shows the request hitting the Worker with no runtime errors
- Disconnect network mid-stream (or use a very long prompt to observe) → inline error message appears below partial text

**Implementation Note**: This is the definition-of-done verification for F-03. Do not mark the change complete until the wrangler dev smoke test passes end-to-end.

---

## Testing Strategy

### Manual Testing Steps

1. Start local Supabase: `npx supabase start`
2. Start Workers dev server: `npm run dev` (uses `wrangler dev` under the hood)
3. Sign in at `http://localhost:4321/auth/signin`
4. Navigate to `http://localhost:4321/ai-test`
5. Submit a prompt — verify token-by-token streaming
6. Open DevTools Network tab — confirm `Content-Type: text/event-stream` on the `/api/ai/chat` response
7. Check `wrangler tail` output for no errors

## Migration Notes

None — this is a pure additive change with no schema migrations or data transformations.

## References

- Roadmap entry: `context/foundation/roadmap.md` — F-03
- Infrastructure risks: `context/foundation/infrastructure.md` — CJS trap, Workers SSE, nodejs_compat
- Existing API route pattern: `src/pages/api/cars/index.ts`
- Existing service pattern: `src/lib/services/cars.ts`
- Existing env schema: `astro.config.mjs:17-22`
- Protected routes: `src/middleware.ts:4`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: API Route + OpenRouter Integration

#### Automated

- [x] 1.1 `npm run lint` passes with no new errors — 4187e6c
- [x] 1.2 `npm run build` completes — OPENROUTER_API_KEY accepted by env schema — 4187e6c

#### Manual

- [x] 1.3 `curl -N` with valid session cookie returns `data: {"text":"..."}` SSE lines followed by `data: [DONE]` — e36de8b
- [x] 1.4 Request without session cookie returns HTTP 401 — 4187e6c
- [x] 1.5 Request with empty prompt returns HTTP 400 — 4187e6c

### Phase 2: Streaming React Components

#### Automated

- [x] 2.1 `npm run lint` passes — ad1ebb2
- [x] 2.2 `npm run build` passes with no TypeScript errors in new files — ad1ebb2

### Phase 3: Demo Page + wrangler dev Verification

#### Automated

- [x] 3.1 `npm run build` passes with no type errors — e36de8b

#### Manual

- [x] 3.2 Visit `/ai-test` logged out → redirect to `/auth/signin` — e36de8b
- [x] 3.3 Visit `/ai-test` logged in → page loads, form visible — e36de8b
- [x] 3.4 Submit a prompt → tokens stream in real time, cursor blinks, disappears on completion — e36de8b
- [x] 3.5 `wrangler tail` shows no runtime errors during streaming — e36de8b
