import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Car } from "@/types";

// Mock the three boundary services the route imports. Mocking the whole
// modules also keeps their top-level side effects (e.g. ai.ts's `new OpenAI`)
// from running during import.
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/services/cars", () => ({ getCarById: vi.fn() }));
vi.mock("@/lib/services/ai", () => ({ createChatStream: vi.fn() }));

import { createClient } from "@/lib/supabase";
import { getCarById } from "@/lib/services/cars";
import { createChatStream } from "@/lib/services/ai";
import { POST } from "@/pages/api/ai/chat";

type ChatStream = Awaited<ReturnType<typeof createChatStream>>;

const FIXTURE_CAR: Car = {
  id: "car-1",
  user_id: "user-1",
  brand: "Toyota",
  model: "Corolla",
  production_year: "2018",
  registration_number: "ABC 1234",
  engine_type: "diesel",
  engine_capacity: "1998cc",
  engine_power: "120hp",
  engine_code: "1ND-TV",
  vin_number: "JTDBR32E520012345",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

const FAKE_SUPABASE = {} as unknown as SupabaseClient;

interface CtxOptions {
  user?: { id: string } | null;
  selectedCarId?: string | null;
  json?: () => Promise<unknown>;
}

// Hand-build the minimal context the route reads: locals.user,
// locals.selectedCarId, request.json()/headers, cookies. No HTTP server.
function makeContext({
  user = { id: "user-1" },
  selectedCarId = "car-1",
  json = () => Promise.resolve({ prompt: "what oil does it take?" }),
}: CtxOptions = {}): APIContext {
  return {
    locals: { user, selectedCarId },
    request: { headers: new Headers(), json },
    cookies: {},
  } as unknown as APIContext;
}

function readJson(res: Response): Promise<unknown> {
  return res.json() as Promise<unknown>;
}

// The stub chunk shape the route reads: `chunk.choices[0]?.delta?.content`.
interface ChatChunk {
  choices: { delta: { content?: string } }[];
}

// Single boundary that bridges a sync generator stub to the OpenAI stream
// type. A sync generator is enough: the route consumes the stream with
// `for await`, which accepts sync iterables too.
function makeStream(gen: () => Generator<ChatChunk>): ChatStream {
  return gen() as unknown as ChatStream;
}

function streamOf(...chunks: ChatChunk[]): ChatStream {
  return makeStream(function* () {
    for (const chunk of chunks) yield chunk;
  });
}

describe("POST /api/ai/chat", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(createClient).mockReturnValue(FAKE_SUPABASE);
    vi.mocked(getCarById).mockResolvedValue(FIXTURE_CAR);
  });

  it("401 when there is no authenticated user", async () => {
    const res = await POST(makeContext({ user: null }));

    expect(res.status).toBe(401);
    expect(await readJson(res)).toEqual({ error: "Unauthorized" });
  });

  it("400 when the request body is not valid JSON", async () => {
    const res = await POST(makeContext({ json: () => Promise.reject(new Error("boom")) }));

    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({ error: "Invalid JSON" });
  });

  it("400 with the first zod issue when the prompt is empty", async () => {
    const res = await POST(makeContext({ json: () => Promise.resolve({ prompt: "" }) }));

    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({ error: "Prompt is required" });
  });

  it("400 with the first zod issue when the prompt is too long", async () => {
    const res = await POST(makeContext({ json: () => Promise.resolve({ prompt: "a".repeat(2001) }) }));

    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({ error: "Prompt is too long" });
  });

  it("400 when no car is selected", async () => {
    const res = await POST(makeContext({ selectedCarId: null }));

    expect(res.status).toBe(400);
    expect(await readJson(res)).toEqual({ error: "No car selected" });
  });

  it("503 when the Supabase client cannot be created", async () => {
    vi.mocked(createClient).mockReturnValue(null);

    const res = await POST(makeContext());

    expect(res.status).toBe(503);
    expect(await readJson(res)).toEqual({ error: "Service unavailable" });
  });

  it("404 for a car the user does not own, and never reaches the LLM (R1)", async () => {
    // A selected id that resolves to nothing for this user (foreign / deleted).
    vi.mocked(getCarById).mockResolvedValue(null);

    const res = await POST(makeContext());

    expect(res.status).toBe(404);
    expect(await readJson(res)).toEqual({ error: "Car not found" });
    // R1 regression guard: ownership short-circuits before the model is touched.
    expect(createChatStream).not.toHaveBeenCalled();
  });

  it("200 streams the answer grounded on the owned car (R1)", async () => {
    vi.mocked(createChatStream).mockResolvedValue(streamOf({ choices: [{ delta: { content: "hi" } }] }));

    const res = await POST(makeContext());

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('data: {"text":"hi"}');
    expect(text).toContain("data: [DONE]");
    // Grounded on exactly the owned car the route resolved.
    expect(createChatStream).toHaveBeenCalledWith("what oil does it take?", FIXTURE_CAR);
  });

  it("500 without leaking the API key when the SDK throws (R2)", async () => {
    vi.mocked(createChatStream).mockRejectedValue(new Error("401 Invalid API key: sk-or-test-LEAK"));

    const res = await POST(makeContext());

    expect(res.status).toBe(500);
    const body = await readJson(res);
    expect(body).toEqual({ error: "AI service error" });
    // R2: the secret-bearing SDK message never reaches the response body.
    expect(JSON.stringify(body)).not.toContain("sk-or-test-LEAK");
  });

  it("emits a generic stream error without leaking detail when the stream fails mid-flight", async () => {
    vi.mocked(createChatStream).mockResolvedValue(
      makeStream(function* () {
        yield { choices: [{ delta: { content: "partial" } }] };
        throw new Error("upstream exploded: sk-or-test-LEAK");
      }),
    );

    const res = await POST(makeContext());

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('data: {"text":"partial"}');
    expect(text).toContain('{"error":"Stream failed"}');
    expect(text).toContain("data: [DONE]");
    expect(text).not.toContain("sk-or-test-LEAK");
  });
});
