---
date: 2026-06-15T00:00:00+02:00
researcher: Aleksander
git_commit: 73fdf7b63e53a2658305568c4ccf8b755d8b74ac
branch: main
repository: CarBooklet
topic: "Ground Phase 1 risks: AI chat grounding (R1) + OpenRouter key non-leak (R2) + Vitest bootstrap constraints"
tags: [research, ai-chat, security, vitest, testing, grounding, openrouter]
status: complete
last_updated: 2026-06-15
last_updated_by: Aleksander
---

# Research: Testing Bootstrap — AI Chat Envelope (Phase 1)

**Date**: 2026-06-15  
**Researcher**: Aleksander  
**Git Commit**: `73fdf7b63e53a2658305568c4ccf8b755d8b74ac`  
**Branch**: `main`  
**Repository**: CarBooklet

---

## Research Question

Ground the two Phase 1 risks from `context/foundation/test-plan.md` §2:

- **R1** — AI chat grounded in the wrong car / user steers to a car they don't own. Verify: (a) where `selected_car_id` originates, (b) how ownership is enforced, (c) how the system prompt is assembled.
- **R2** — OpenRouter API key leaks into logs, error bodies, or client bundle. Verify: all key references, error-handling paths, what reaches the client on failure.

Also determine the exact Vitest bootstrap requirements: packages, config fields, env-variable injection strategy.

---

## Summary

**R1 (wrong car / foreign car):** Protection exists at three independent layers — the select-cookie endpoint validates ownership before setting the cookie, the chat endpoint re-validates via `getCarById(supabase, id, user.id)`, and Supabase RLS enforces `auth.uid() = user_id` at the DB level. The system prompt is built from the looked-up owned car's fields (8 fields, all sanitised). **The tests must prove these regressions are caught**, not that the current code is safe.

**R2 (key leak):** The key is declared `context: "server"` in the Astro env schema (cannot reach the client bundle). All error response bodies are generic string literals. Residual risk: `console.error` logs the raw `err` object — if the OpenAI SDK embeds the key in an error message (e.g. a 401 with the key in `www-authenticate`), it would appear in server logs, not in the client response. This is server-side only and acceptable, but should be documented in tests as expected server-side behaviour.

**Bootstrap:** Zero test infrastructure. The main challenge is that `astro:env/server` is a virtual module that does not exist in Vitest's Node environment. It must be aliased to a test-double module in `vitest.config.ts` before any service can be imported in tests.

---

## Detailed Findings

### R1 — Selected-Car ID: Origin

`selected_car_id` is stored in an **httpOnly, sameSite=lax cookie** — not in the request body.

**Cookie set endpoint** (`src/pages/api/cars/[id]/select.ts:23-28`):

```typescript
// ownership check first
const car = await getCarById(supabase, id, context.locals.user.id);
if (!car) return new Response("Not found", { status: 404 });

context.cookies.set("selected_car_id", id, {
  path: "/",
  httpOnly: true,
  sameSite: "lax",
  maxAge: 31536000,
});
```

The select endpoint validates ownership (calls `getCarById` with `user.id`) **before** writing the cookie. An authenticated user cannot set the cookie to a car they don't own via this endpoint.

**Middleware reads the cookie** (`src/middleware.ts:21`):

```typescript
context.locals.selectedCarId = context.cookies.get("selected_car_id")?.value ?? null;
```

**Client sends only the prompt** (`src/components/ai/ChatDemo.tsx:43`):

```json
{ "prompt": "<user input text, max 2000 chars>" }
```

The car ID is never in the request body — it is always sourced from `context.locals.selectedCarId` on the server.

---

### R1 — Ownership Enforcement: Three Layers

**Layer 1 — Application: `getCarById`** (`src/lib/services/cars.ts:10-11`):

```typescript
export async function getCarById(supabase: SupabaseClient, id: string, userId: string): Promise<Car | null> {
  const res = await supabase.from("cars").select("*").eq("id", id).eq("user_id", userId).single();
```

Two-column filter: both `id` AND `user_id` must match. A foreign car ID returns `null`.

**Layer 2 — Chat endpoint** (`src/pages/api/ai/chat.ts:38-41`):

```typescript
const car = await getCarById(supabase, selectedCarId, context.locals.user.id);
if (!car) {
  return Response.json({ error: "Car not found" }, { status: 404 });
}
```

The chat endpoint re-validates ownership independently of the cookie-setter. Even if an attacker crafted a raw `selected_car_id` cookie containing a foreign car ID, this check stops the prompt being assembled from that car's data.

**Layer 3 — Supabase RLS** (`supabase/migrations/20260527000000_cars_schema.sql:21-23`):

```sql
CREATE POLICY "Users can view own cars"
  ON public.cars FOR SELECT
  USING (auth.uid() = user_id);
```

The DB itself rejects reads of rows not belonging to `auth.uid()`, making layers 1 and 2 doubly safe.

**Also:** `src/pages/ai-chat.astro:23-25` pre-validates before page render:

```typescript
if (car?.user_id !== user.id) {
  return Astro.redirect("/cars");
}
```

(Page-level guard, not exercised by the API route tests.)

---

### R1 — System Prompt Assembly

**Built in** `src/lib/services/ai.ts:13-46`:

```typescript
function sanitise(value: string): string {
  return value.replace(/[\r\n\x00-\x1F\x7F]/g, " ").trim(); // removes control chars + newlines
}

function buildSystemPrompt(car: Car): string {
  const details: string[] = [
    `fuel type: ${sanitise(car.engine_type)}`,
    `engine capacity: ${sanitise(car.engine_capacity)}`,
    `engine power: ${sanitise(car.engine_power)}`,
  ];
  if (car.engine_code?.trim()) details.push(`engine code: ${sanitise(car.engine_code)}`);
  if (car.vin_number?.trim()) details.push(`VIN: ${sanitise(car.vin_number)}`);

  return (
    `You are an expert car assistant. The user's car is a ${sanitise(car.production_year)} ` +
    `${sanitise(car.brand)} ${sanitise(car.model)}. ` +
    `Known details: ${details.join(", ")}. ` +
    `Answer questions using your specific knowledge of this car model …`
  );
}
```

**8 car fields used** (in order): `production_year`, `brand`, `model`, `engine_type`, `engine_capacity`, `engine_power`, `engine_code` (optional), `vin_number` (optional). Every field passes through `sanitise()` — prompt injection via car fields (e.g. newlines in a stored VIN) is mitigated.

**`buildSystemPrompt` is a pure function** — ideal for unit testing without any mocks.

LLM call at `src/lib/services/ai.ts:40-46`:

```typescript
return client.chat.completions.create({
  model: "openrouter/free",
  messages: [
    { role: "system", content: buildSystemPrompt(car) },
    { role: "user", content: prompt },
  ],
  stream: true,
});
```

---

### R2 — OpenRouter Key: All References

| File                     | Line | Context                                                                           |
| ------------------------ | ---- | --------------------------------------------------------------------------------- |
| `astro.config.mjs`       | 21   | Schema declaration: `context: "server"`, `access: "secret"`, `optional: true`     |
| `src/lib/services/ai.ts` | 2    | `import { OPENROUTER_API_KEY } from "astro:env/server"`                           |
| `src/lib/services/ai.ts` | 6    | `apiKey: OPENROUTER_API_KEY` — passed to OpenAI client constructor                |
| `src/lib/services/ai.ts` | 36   | Runtime guard: `if (!OPENROUTER_API_KEY)`                                         |
| `src/lib/services/ai.ts` | 37   | `throw new Error("AI service error")` — message is generic, **not** the key value |

The key **cannot be imported in client code** because `context: "server"` in the Astro env schema restricts access to server-only modules. The client bundle has no path to it.

---

### R2 — Error Paths: What Reaches the Client

**Service error path** (`src/pages/api/ai/chat.ts:44-50`):

```typescript
try {
  stream = await createChatStream(result.data.prompt, car);
} catch (err) {
  console.error("[ai/chat] Service error:", err); // logs raw err — server-side only
  return Response.json({ error: "AI service error" }, { status: 500 });
}
```

Client receives: `{ error: "AI service error" }`, status 500.

**Stream read error path** (`src/pages/api/ai/chat.ts:64-68`):

```typescript
} catch (e) {
  console.error("[ai/chat] Stream error:", e);         // logs raw e — server-side only
  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Stream failed" })}\n\n`));
  controller.enqueue(encoder.encode("data: [DONE]\n\n"));
}
```

Client receives: SSE data frame `{ error: "Stream failed" }` (still inside a 200 streaming response).

**All other error paths in `chat.ts`** (auth check, no selectedCarId, validation) return literal string errors — no raw error objects serialised to the response.

**Client-side error display** (`src/components/ai/ChatDemo.tsx:46-49`):

```typescript
if (!res.ok) {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  setFetchError(data.error ?? `Request failed (${res.status})`);
  return;
}
```

User sees only the string from `data.error` — which is always one of the generic literals above.

**Searched for raw error serialisation** in `src/pages/api/` — no occurrences of `JSON.stringify(error)`, `error.message` forwarded to response body, or `String(error)` in response. **Result: none found.**

**Residual risk documented:** `console.error` at `chat.ts:48` and `chat.ts:66` log the raw `err`/`e` object. If the OpenAI SDK includes the API key in an error response body (e.g. some `www-authenticate` header reflection), it would appear in Cloudflare Workers logs — server-side only, not in the client. This is the only residual risk and is acceptable, but worth asserting in tests that the **response body** never contains the key string even when the mock throws a key-containing error.

---

### Test Infrastructure Baseline

**Current state: zero.**

| Artefact                        | Found? |
| ------------------------------- | ------ |
| `vitest.config.*`               | No     |
| `jest.config.*`                 | No     |
| `*.test.*` / `*.spec.*` files   | No     |
| `__tests__/` directory          | No     |
| Test deps in `package.json`     | No     |
| `test` script in `package.json` | No     |

---

### Vitest Bootstrap: Required Config

**`astro.config.mjs:1-24`** (key constraints):

- `output: "server"` — full SSR, no static output
- `adapter: cloudflare()` — Cloudflare Workers runtime
- `vite.plugins: [tailwindcss()]` — Vite-based build

**`wrangler.jsonc:7`**: `"compatibility_flags": ["nodejs_compat"]` — Workers runtime uses Node.js APIs.

**`tsconfig.json:7-9`**: `"paths": { "@/*": ["./src/*"] }` — must be mirrored in Vitest alias.

#### `vitest.config.ts` required fields

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node", // nodejs_compat → Node env for unit/integration
    globals: true,
    setupFiles: ["./src/test/setup.ts"], // env var injection before module load
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"), // mirrors tsconfig @/ alias
      "astro:env/server": path.resolve(
        // CRITICAL: virtual module → test double
        __dirname,
        "./src/test/__mocks__/astro-env-server.ts",
      ),
    },
  },
});
```

#### The `astro:env/server` problem (critical)

`astro:env/server` is a **virtual module** generated by Astro at build time. In Vitest's Node runtime it does not exist — any service importing it will throw `Cannot find module 'astro:env/server'`.

**Solution**: add a `resolve.alias` entry pointing `astro:env/server` to a test double file:

```typescript
// src/test/__mocks__/astro-env-server.ts
export const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
export const SUPABASE_KEY = process.env.SUPABASE_KEY ?? "test-anon-key";
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "test-openrouter-key";
```

This mock is **imported wherever the real module would be** — same export names. Tests that want to test the "key missing" scenario can `vi.mock("astro:env/server", ...)` to override specific exports.

#### Supabase client in tests

`src/lib/supabase.ts` imports from `astro:env/server` (covered by the alias above) and returns `null` when credentials are missing. For Phase 1 unit tests of `src/lib/services/ai.ts`, the Supabase client is not involved — only `buildSystemPrompt` and the OpenAI client need mocking. For integration tests of `src/pages/api/ai/chat.ts`, the approach is to mock `getCarById` from `src/lib/services/cars.ts` rather than spinning up a real Supabase stack.

#### Packages to install

```
vitest              — test runner (aligns with Vite 7.x)
@vitest/coverage-v8 — coverage (optional for Phase 1, needed for CI gate)
```

No `happy-dom` or `@testing-library/react` needed for Phase 1 — the unit/integration targets (`ai.ts` service + `chat.ts` API route) are pure TypeScript, not React components.

---

## Code References

- `src/middleware.ts:21` — reads `selected_car_id` cookie → `context.locals.selectedCarId`
- `src/pages/api/cars/[id]/select.ts:23-28` — ownership validation + cookie set
- `src/pages/api/ai/chat.ts:38-41` — chat endpoint ownership re-validation (→ 404 if foreign id)
- `src/pages/api/ai/chat.ts:44-50` — service error catch (→ `{ error: "AI service error" }`, 500)
- `src/pages/api/ai/chat.ts:64-68` — stream error catch (→ SSE `{ error: "Stream failed" }`)
- `src/lib/services/cars.ts:10-11` — `getCarById`: two-column `.eq("id").eq("user_id")` filter
- `src/lib/services/ai.ts:2` — `OPENROUTER_API_KEY` import from `astro:env/server`
- `src/lib/services/ai.ts:6` — key passed to OpenAI client constructor
- `src/lib/services/ai.ts:13-16` — `sanitise()`: removes control chars from car field values
- `src/lib/services/ai.ts:18-33` — `buildSystemPrompt(car)`: builds LLM system prompt from 8 car fields
- `src/lib/services/ai.ts:36-37` — runtime guard: throws generic error if key undefined
- `src/lib/services/ai.ts:40-46` — `client.chat.completions.create(...)`: streams to OpenRouter
- `src/components/ai/ChatDemo.tsx:43` — client sends only `{ prompt }`, no car ID
- `src/components/ai/ChatDemo.tsx:46-49` — client displays `data.error` (generic string only)
- `src/lib/supabase.ts:1-24` — Supabase SSR client; imports from `astro:env/server`
- `supabase/migrations/20260527000000_cars_schema.sql:21-23` — RLS SELECT policy on cars
- `astro.config.mjs:21` — `OPENROUTER_API_KEY` declared server-only, secret, optional
- `tsconfig.json:7-9` — `@/` path alias
- `wrangler.jsonc:7` — `nodejs_compat` flag → Vitest environment must be `"node"`

---

## Architecture Insights

1. **Car ID never travels in the request body.** The client sends only `{ prompt }`. Ownership is enforced entirely server-side via the middleware cookie read + `getCarById` double-column filter. This architecture makes the attack surface narrower than if the client sent the car ID.

2. **`buildSystemPrompt` is pure.** It takes a `Car` object and returns a string — no I/O, no mocks, no env vars. This is the easiest and most valuable unit test target: assert the system prompt contains exactly the owned car's fields and no foreign data.

3. **Error response bodies are all literal strings.** No raw error objects are serialised to the client anywhere in `chat.ts`. This is a deliberate, correct pattern — tests should assert this contract holds after any future refactor.

4. **`astro:env/server` is the bootstrap blocker.** Without the `resolve.alias` redirect, `vi.importActual('src/lib/services/ai')` throws immediately. This must be set up before writing any test.

5. **Vitest environment is `"node"`, not miniflare.** The `nodejs_compat` flag in `wrangler.jsonc` means the Cloudflare Workers runtime is configured to behave like Node.js. Using `miniflare` environment would add complexity with no benefit for Phase 1 unit/integration tests.

---

## Risk Response Guidance — Verified and Grounded

### R1 — AI Chat Grounding (CONFIRMED CORRECT, NO CORRECTION NEEDED)

| Guidance cell               | Test plan said                                                                                         | Research confirms                                                                                                                                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What would prove protection | Chat loads only owned car; foreign id → 404, never foreign car data; prompt built from owned fields    | **Confirmed.** `chat.ts:38-41` returns 404 for foreign id. `buildSystemPrompt` takes the result of the ownership-validated lookup.                                                                                                                                                                                        |
| Must challenge              | "user.id filter on the car lookup is enough, and the selected-car id is trustworthy"                   | **Challenge still valid.** The selected-car id originates from a client cookie — it CAN be manipulated by a client who crafts a raw HTTP request. The `getCarById(supabase, id, user.id)` call at `chat.ts:38` is what makes the cookie tampering harmless. The test must exercise the tampered-cookie scenario directly. |
| Context needed              | Where selected-car id originates, ownership on lookup, prompt assembly                                 | **Grounded:** cookie at `middleware.ts:21`; ownership at `cars.ts:10-11` + `chat.ts:38`; prompt at `ai.ts:18-33`.                                                                                                                                                                                                         |
| Cheapest layer              | integration (API route) + unit (prompt builder)                                                        | **Confirmed.** `buildSystemPrompt` = unit. Chat endpoint with mocked `getCarById` = integration. No DB needed for R1.                                                                                                                                                                                                     |
| Anti-pattern to avoid       | Asserting LLM answer text; mirroring prompt string instead of asserting which car's data it draws from | **Still valid.** Assert that `buildSystemPrompt` is called with the result of `getCarById(…, user.id)` — not with any arbitrary car object.                                                                                                                                                                               |

### R2 — Key Non-Leak (MINOR CLARIFICATION)

| Guidance cell               | Test plan said                                                                              | Research confirms                                                                                                                                                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What would prove protection | No error path, log line, or response body emits the key                                     | **Partially confirmed.** Response bodies are safe (literal strings). Console logs are server-side only and acceptable. **Clarification:** tests should assert response body does not contain the key string, and console.error is expected to fire (not to suppress it).                                                                    |
| Must challenge              | "`astro:env/server` import means it can never leak"                                         | **Still valid.** The import restriction covers the client bundle. It does NOT prevent the key appearing in error objects thrown by the OpenAI SDK. The chat.ts `console.error` at line 48 logs raw `err` — if the SDK embeds the key in an HTTP 401 error detail, it lands in server logs. Not a client leak, but worth asserting in tests. |
| Context needed              | Error-handling and logging paths in chat route + AI service; what reaches client on failure | **Grounded:** two error paths in `chat.ts` (lines 44-50 and 64-68); both return literal strings. Key checked at `ai.ts:36-37` with generic throw.                                                                                                                                                                                           |
| Cheapest layer              | integration                                                                                 | **Confirmed.** Mock the OpenAI client to throw a key-containing error; assert response body is generic.                                                                                                                                                                                                                                     |
| Anti-pattern                | Over-mocking the AI client so the real error/response body is never asserted                | **Still valid.** The mock must be at the HTTP layer (or the OpenAI client stub), not at the `createChatStream` function, so the actual error-propagation logic in `chat.ts` is exercised.                                                                                                                                                   |

---

## Proposed Test Scenarios for `/10x-plan`

### Phase 1.0 — Bootstrap (no tests yet)

- Install `vitest` (+ `@vitest/coverage-v8` for CI gate)
- Create `vitest.config.ts` with `environment: "node"`, `@/` alias, `astro:env/server` alias
- Create `src/test/__mocks__/astro-env-server.ts` test double
- Create `src/test/setup.ts` (optional env var injection; the alias approach is sufficient)
- Add `"test": "vitest"` script to `package.json`
- **Verification:** `npm test` exits 0 with "no test files found" (runner works, no tests yet)

### Phase 1.1 — Unit: `buildSystemPrompt`

- **Happy path:** `buildSystemPrompt(ownedCar)` returns a string containing `ownedCar.brand`, `ownedCar.model`, `ownedCar.production_year`, `ownedCar.engine_type`, etc.
- **Sanitisation:** field value containing `\n` or `\x01` → control chars replaced by space in output
- **Optional fields absent:** `engine_code` and `vin_number` both null → neither appears in the prompt string
- **Oracle:** expected values come from the test fixture's car object (independent source), not from calling the function under test and re-asserting its output

### Phase 1.2 — Integration: chat endpoint ownership

- **Foreign car id in cookie:** `context.locals.selectedCarId = "foreign-car-id"`, mock `getCarById` to return `null` → response is 404, body is `{ error: "Car not found" }`, `buildSystemPrompt` is never called
- **No selectedCarId:** `context.locals.selectedCarId = null` → response is 400 or appropriate guard error (check actual guard in `chat.ts` for the exact path)
- **Owned car:** `context.locals.selectedCarId = "my-car-id"`, mock `getCarById` to return `myCar`, mock `createChatStream` to return a trivial readable stream → response is 200, streaming begins
- **Unauthenticated:** `context.locals.user = null` → response is 401

### Phase 1.3 — Integration: key non-leak

- **OpenAI throws error containing key string:** mock `createChatStream` to throw `new Error("Invalid API key: sk-or-v1-abc123")` → response body is exactly `{ error: "AI service error" }` (200 check fails, key string not in body)
- **Missing key:** mock `astro:env/server` to export `OPENROUTER_API_KEY = undefined`, trigger chat → response contains generic error, no undefined/key string exposed
- **Stream fails mid-stream:** mock stream reader to throw after first chunk → SSE contains `{ error: "Stream failed" }`, response body does not contain any error message from the SDK

---

## Historical Context

No prior research artifacts in `context/changes/` or `context/archive/` directly address testing. The AI chat feature was implemented in `context/changes/ai-integration-scaffold/` and `context/changes/ai-car-chat/` (unread; the code itself is the ground truth per principle §3 of the test plan).

---

## Open Questions

1. **What does `chat.ts` do when `context.locals.selectedCarId` is null?** Agent 1 established it reads from locals, and the chat endpoint calls `getCarById` with it — but the exact guard (400? redirect? error?) should be confirmed when reading `chat.ts` lines 20-37 during plan authoring.

2. **Supabase auth mock for integration tests.** The chat endpoint calls `supabase.auth.getUser()` via middleware — in pure API route integration tests (bypassing middleware), `context.locals.user` is injected directly. Confirm the mock `APIContext` shape from `src/env.d.ts` type definitions.

3. **Streaming response assertion strategy.** The chat endpoint returns a `ReadableStream`. In Vitest + Node environment, consuming `ReadableStream` works natively in Node 18+. Confirm the approach for iterating SSE chunks in tests.

4. **`astro:env/server` alias vs `vi.mock`.** The resolve alias approach resolves the module at config time. If a specific test needs to override `OPENROUTER_API_KEY = undefined`, it must use `vi.mock("astro:env/server", ...)` which will take precedence over the alias. Confirm this interaction works as expected in Vitest.
