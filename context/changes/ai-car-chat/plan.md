# AI Car Chat Implementation Plan

## Overview

Wire the selected car's details (make, model, year, engine) into the AI system prompt so the LLM responds with model-specific knowledge rather than generic car advice. Add a production `/ai-chat` page reachable from the Topbar. Remove the `/ai-test` dev scaffold.

F-03 (AI scaffold) is complete: `createChatStream`, the SSE API route, `useStreamingText`, `StreamingText`, and `ChatDemo` all work end-to-end. S-02 builds on that foundation without changing the client-side streaming stack.

## Current State Analysis

- `src/lib/services/ai.ts` — `createChatStream(prompt: string)` sends a single hardcoded system prompt: `"You are a helpful car assistant."` No car context is passed.
- `src/pages/api/ai/chat.ts` — validates `{ prompt: string }`, calls `createChatStream(prompt)`. Does not read `selectedCarId` or fetch the car.
- `src/components/ai/ChatDemo.tsx` — sends `{ prompt }` to `/api/ai/chat`. No car context on the client.
- `src/pages/ai-test.astro` — dev scaffold page; works but has no nav link and no car context.
- `Car` type has always-present fields (`brand`, `model`, `production_year`, `engine_type`, `engine_capacity`, `engine_power`) and nullable fields (`engine_code`, `vin_number`, `registration_number`).
- `context.locals.selectedCarId` is set by middleware from the `selected_car_id` cookie on every request.

## Desired End State

A logged-in user with a selected car navigates to `/ai-chat` via the Topbar, types a question about their car, and receives a streaming AI response that uses knowledge specific to their car model (make, model, year, engine). The blinking cursor is visible during streaming and disappears on completion. Navigating to `/ai-chat` without a selected car redirects to `/cars`. `/ai-test` is deleted.

### Key Discoveries

- `getCarById(supabase, id): Promise<Car | null>` exists in `src/lib/services/cars.ts:10` — no new service function needed.
- Auth guard pattern: `context.locals.user` check at the top of the API route (established by impl-review fix in S-03); Supabase client via `createClient(context.request.headers, context.cookies)`.
- The SSE response shape (`data: {"text":"..."}`, `data: [DONE]`) must not change — `ChatDemo.tsx` and `useStreamingText` depend on it.
- Nullable engine fields (`engine_code`, `vin_number`) must be omitted from the system prompt when null/empty to avoid injecting meaningless text.
- Dashboard redirect pattern: `if (!selectedCarId) return Astro.redirect("/cars")` (`src/pages/dashboard.astro:8-9`).
- Topbar authenticated link structure: `<a href="/entries" class="text-purple-300 transition-colors hover:text-purple-100 hover:underline">` (`src/components/Topbar.astro:13`).

## What We're NOT Doing

- No entry context in the AI prompt — logged repair entries are deferred to an S-02 addendum after S-03/S-04 ship
- No chat history or multi-turn conversations — single-turn only (established in F-03)
- No model selection UI — model stays as configured in the AI service
- No retry logic on the OpenRouter call
- No change to `ChatDemo.tsx` — the component works as-is; car context is injected server-side

## Implementation Approach

Server-side car injection: the API route reads `context.locals.selectedCarId`, fetches the car, builds a car-aware system prompt in the service, then streams the response. The client is unchanged.

**Service** (`src/lib/services/ai.ts`): `createChatStream` gains a `car: Car` parameter. A helper builds the system prompt string from non-null car fields — always includes `brand`, `model`, `production_year`, `engine_type`, `engine_capacity`, `engine_power`; conditionally appends `engine_code` and `vin_number` when non-null.

**API route** (`src/pages/api/ai/chat.ts`): after the existing auth check, reads `context.locals.selectedCarId` (400 if absent), calls `getCarById` (400 if not found), then passes the car to `createChatStream`.

**Page + nav**: `/ai-chat.astro` follows the `/entries` page pattern — server-fetches the selected car for the page heading, mounts `<ChatDemo client:load />`. `/ai-chat` is added to `PROTECTED_ROUTES`. A Topbar "AI Chat" link is added alongside "Entries". `/ai-test.astro` is deleted and removed from `PROTECTED_ROUTES`.

---

## Phase 1: AI Service + API Route

### Overview

Update `createChatStream` to accept car context and build a model-aware system prompt. Update the API route to fetch the selected car from DB and pass it to the service. After this phase, the full backend chain is verifiable with `curl`.

### Changes Required

#### 1. Update AI service

**File**: `src/lib/services/ai.ts`

**Intent**: Accept the selected car as a parameter and construct a system prompt that includes the car's make, model, year, and any non-null engine details. The LLM receives specific car context on every request rather than a generic prompt.

**Contract**: Change the signature to `createChatStream(prompt: string, car: Car): Promise<...>`. Import the `Car` type from `@/types`. Before calling `client.chat.completions.create`, build the system prompt:
- Always include: `{production_year} {brand} {model}`
- Always include: engine type (e.g. "diesel"), engine capacity, engine power
- Conditionally include `engine_code` and `vin_number` when non-null and non-empty
- Frame: "You are an expert car assistant. The user's car is a [car details]. Answer questions using your specific knowledge of this car model — common faults, maintenance intervals, OBD2 codes, and technical specifications. Be precise and reference the specific model where relevant."

#### 2. Update AI chat API route

**File**: `src/pages/api/ai/chat.ts`

**Intent**: Fetch the selected car from the database and pass it to the AI service so that every prompt is grounded in the user's actual car.

**Contract**:
- After the existing `context.locals.user` check (line 10), read `context.locals.selectedCarId`. Return `400 { error: "No car selected" }` if null.
- Call `createClient(context.request.headers, context.cookies)` (already present for auth); use it to call `getCarById(supabase, selectedCarId)`. Return `400 { error: "Car not found" }` if the result is null.
- Pass `car` as the second argument to `createChatStream(prompt, car)`.
- All other route logic (Zod validation, SSE streaming, response headers) is unchanged.

### Success Criteria

#### Automated Verification

- `npm run lint` passes with no new errors
- `npm run build` passes with no TypeScript errors

#### Manual Verification

- `curl -N -X POST -H "Cookie: <valid-session-cookie>" -H "Content-Type: application/json" -d '{"prompt":"What is a common fault of this car?"}' http://localhost:4321/api/ai/chat` returns `data: {"text":"..."}` SSE events that reference the selected car model (not generic advice)
- Same request with no selected car cookie → returns HTTP 400 with `"No car selected"`
- Same request without session cookie → returns HTTP 401

**Implementation Note**: After automated and manual verification pass, confirm with the human before proceeding to Phase 2.

---

## Phase 2: /ai-chat Page + Navigation + /ai-test Cleanup

### Overview

Create the production chat page, add it to protected routes, add the Topbar link, and remove the dev scaffold.

### Changes Required

#### 1. Add /ai-chat to PROTECTED_ROUTES, remove /ai-test

**File**: `src/middleware.ts`

**Intent**: Protect the new chat page from unauthenticated access; remove the now-deleted dev scaffold from the protected list.

**Contract**: In the `PROTECTED_ROUTES` array, add `"/ai-chat"` and remove `"/ai-test"`.

#### 2. Create /ai-chat page

**File**: `src/pages/ai-chat.astro`

**Intent**: Production chat page for the selected car. Server-fetches the car for the heading; mounts `ChatDemo` as a React island. Follows the `/entries` page pattern exactly.

**Contract**:
- Frontmatter reads `Astro.locals.selectedCarId`; redirects to `/cars` if null.
- Creates Supabase client, calls `getCarById(supabase, selectedCarId)`; redirects to `/cars` if null.
- Template: `<Layout title="AI Chat">` wrapper, heading `{car.brand} {car.model} — AI Chat`, subheading or descriptor with `{car.production_year}`, then `<ChatDemo client:load />`.
- No props passed to `ChatDemo` — the API route handles car context server-side.

#### 3. Add "AI Chat" Topbar link

**File**: `src/components/Topbar.astro`

**Intent**: Make the AI chat page discoverable from the main navigation, alongside Dashboard and Entries.

**Contract**: Inside the authenticated user `<div class="flex items-center gap-3">`, add `<a href="/ai-chat" class="text-purple-300 transition-colors hover:text-purple-100 hover:underline">AI Chat</a>` after the existing "Entries" link and before the sign-out form.

#### 4. Delete /ai-test dev scaffold

**File**: `src/pages/ai-test.astro`

**Intent**: Remove the context-free demo page now that a production chat page exists. The file is no longer reachable (removed from PROTECTED_ROUTES in step 1) but should be deleted to keep the codebase clean.

**Contract**: Delete the file `src/pages/ai-test.astro`.

### Success Criteria

#### Automated Verification

- `npm run build` passes with no type errors

#### Manual Verification (wrangler dev)

- Topbar shows "AI Chat" link for logged-in users
- Visit `/ai-chat` logged out → redirect to `/auth/signin`
- Visit `/ai-chat` logged in, no car selected → redirect to `/cars`
- Visit `/ai-chat` with selected car → page loads, heading shows the car name, form is visible
- Ask a question → streaming response references the specific car model (not generic advice)
- Blinking cursor visible during streaming; disappears on completion
- Visit `/ai-test` → 404 (page deleted and route removed)

**Implementation Note**: This is the definition-of-done for S-02. Do not mark the change complete until the wrangler dev smoke test passes end-to-end.

---

## Testing Strategy

### Manual Testing Steps

1. Start local Supabase: `npx supabase start`
2. Start Workers dev server: `npm run dev`
3. Sign in and select a car at `/cars`
4. Navigate to `/ai-chat` via the Topbar link — confirm heading shows the car name
5. Ask: "What are common faults of this car?" — confirm the response references the specific make/model
6. Ask: "What does OBD2 code P0300 mean for this car?" — confirm model-specific context in the answer
7. Sign out, navigate to `/ai-chat` directly — confirm redirect to `/auth/signin`
8. Sign in with no car selected, navigate to `/ai-chat` — confirm redirect to `/cars`
9. Navigate to `/ai-test` directly — confirm 404

## Migration Notes

None — this is a pure additive change to the service layer and UI. No schema migrations or data transformations.

## References

- Roadmap S-02: `context/foundation/roadmap.md`
- PRD US-01, FR-010, FR-011: `context/foundation/prd.md`
- AI scaffold plan (F-03): `context/changes/ai-integration-scaffold/plan.md`
- AI service: `src/lib/services/ai.ts`
- AI chat API route: `src/pages/api/ai/chat.ts`
- ChatDemo component: `src/components/ai/ChatDemo.tsx`
- Auth guard pattern: `src/pages/api/ai/chat.ts:10`
- Car service: `src/lib/services/cars.ts:10` (`getCarById`)
- Page pattern: `src/pages/entries.astro`
- Topbar: `src/components/Topbar.astro`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: AI Service + API Route

#### Automated

- [x] 1.1 `npm run lint` passes with no new errors — d45454b
- [x] 1.2 `npm run build` passes with no TypeScript errors — d45454b

#### Manual

- [x] 1.3 curl with valid session + selected car returns SSE events referencing the car model — d45454b
- [x] 1.4 curl with no selected car cookie returns HTTP 400 "No car selected" — d45454b
- [x] 1.5 curl without session cookie returns HTTP 401 — d45454b

### Phase 2: /ai-chat Page + Navigation + /ai-test Cleanup

#### Automated

- [x] 2.1 `npm run build` passes with no type errors — 4ade220

#### Manual

- [x] 2.2 Topbar shows "AI Chat" link for logged-in users — 4ade220
- [x] 2.3 /ai-chat logged out → redirect to /auth/signin — 4ade220
- [x] 2.4 /ai-chat logged in, no car selected → redirect to /cars — 4ade220
- [x] 2.5 /ai-chat with selected car → page loads, heading shows car name — 4ade220
- [x] 2.6 AI response references the specific car model — 4ade220
- [x] 2.7 Blinking cursor visible during streaming; disappears on completion — 4ade220
- [x] 2.8 /ai-test returns 404 (deleted) — 4ade220
