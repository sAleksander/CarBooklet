# AI Car Chat — Plan Brief

> Full plan: `context/changes/ai-car-chat/plan.md`

## What & Why

S-02 is the north star milestone: the smallest end-to-end slice that proves the product's core technical hypothesis. Wire the selected car's make, model, year, and engine details into the AI system prompt so the LLM delivers model-specific answers — common faults, OBD2 diagnostics, maintenance intervals — rather than generic car advice that any search engine could provide. The differentiating value of CarBooklet is this synthesis; S-02 confirms it works on the real infrastructure.

## Starting Point

F-03 delivered a working AI scaffold: `createChatStream(prompt)` talks to OpenRouter via SSE, `useStreamingText` + `StreamingText` render tokens in real time, and `ChatDemo` wires it all together on `/ai-test`. The system prompt is currently `"You are a helpful car assistant."` — no car context. S-02 injects the car and ships a production page.

## Desired End State

A user with a selected car opens `/ai-chat` from the Topbar, types "What are common faults of this car?", and gets a streaming response that references their specific make, model, and year. The blinking cursor is visible during generation and disappears on completion. No car selected → redirected to `/cars`. The `/ai-test` dev scaffold is deleted.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Car context injection | Server reads `selectedCarId` from `context.locals`; client unchanged | `ChatDemo.tsx` keeps sending `{ prompt }` as-is; car selection is authoritative server-side. | Plan |
| System prompt car data | All non-null fields (brand, model, year always; engine_code/VIN only if set) | Maximises diagnostic specificity without padding the prompt with null values. | Plan |
| Chat page location | New `/ai-chat` page + Topbar link | Mirrors the `/entries` pattern; clean separation from the dev scaffold. | Plan |
| `/ai-test` fate | Delete after S-02 ships | No longer needed once a production page exists; keeps codebase clean. | Plan |
| Entry context in prompt | Deferred | S-03/S-04 must populate entries before the AI can reference them; adding it now would be dead code. | Roadmap |

## Scope

**In scope:**
- `createChatStream` updated to accept `Car` and build a model-aware system prompt
- `/api/ai/chat` fetches selected car and passes it to service
- `/ai-chat` production page with car-name heading
- Topbar "AI Chat" link
- `/ai-test` deletion + PROTECTED_ROUTES cleanup

**Out of scope:**
- Entry context in the AI prompt (deferred to S-02 addendum after S-03/S-04)
- Chat history or multi-turn conversations
- Model selection UI
- Any change to `ChatDemo.tsx`, `useStreamingText`, or `StreamingText`

## Architecture / Approach

All car context is injected server-side. The client (`ChatDemo.tsx`) sends `{ prompt }` unchanged. The API route reads `context.locals.selectedCarId`, fetches the car via `getCarById`, and passes it to `createChatStream(prompt, car)`. The service builds the system prompt string from non-null car fields before calling OpenRouter. SSE streaming and client-side rendering are unchanged from F-03.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Service + API route | Model-aware AI responses, curl-verifiable | Null engine fields must be handled gracefully or the system prompt looks malformed |
| 2. Chat page + nav + cleanup | Production `/ai-chat` page in Topbar; `/ai-test` removed | Minimal — follows established page and nav patterns exactly |

**Prerequisites:** F-01, F-03, S-01 — all done.  
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- The `openai` SDK's `model` field is currently set to `'google/gemini-2.0-flash-exp:free'` in the service — responses depend on that model remaining available on OpenRouter's free tier.
- Engine fields (`engine_capacity`, `engine_power`) are typed as non-null strings but could be empty strings in the DB; the system prompt builder should guard against empty-string injection.
- Entry context (logged repairs, oil changes) is intentionally absent from this slice — the AI's answers are grounded in model knowledge only until S-03/S-04 data exists.

## Success Criteria (Summary)

- The AI response to "What are common faults of this car?" references the specific make/model, not generic advice
- `/ai-chat` with no selected car redirects to `/cars`
- `/ai-test` returns 404
