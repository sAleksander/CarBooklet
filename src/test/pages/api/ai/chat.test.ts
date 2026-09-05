import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Car, Conversation, Message, MessageRole, MessageStatus } from "@/types";

// Mock every boundary the route imports. Mocking the whole modules also keeps
// their top-level side effects (e.g. ai.ts's `new OpenAI`) from running during
// import.
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/services/cars", () => ({ getCarById: vi.fn() }));
vi.mock("@/lib/services/entries", () => ({ getRecentEntries: vi.fn() }));
vi.mock("@/lib/services/conversations", () => ({
  getConversationById: vi.fn(),
  createConversation: vi.fn(),
  getMessages: vi.fn(),
  appendMessage: vi.fn(),
  touchConversation: vi.fn(),
}));
vi.mock("@/lib/services/ai", () => ({
  createChatStream: vi.fn(),
  isRateLimitError: vi.fn(() => false),
  rateLimitHeaders: vi.fn(() => ({ remaining: null, reset: null })),
}));

import { createClient } from "@/lib/supabase";
import { getCarById } from "@/lib/services/cars";
import { getRecentEntries } from "@/lib/services/entries";
import {
  getConversationById,
  createConversation,
  getMessages,
  appendMessage,
  touchConversation,
} from "@/lib/services/conversations";
import { createChatStream, isRateLimitError } from "@/lib/services/ai";
import { POST } from "@/pages/api/ai/chat";

type ChatStream = Awaited<ReturnType<typeof createChatStream>>;

const CONV_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

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

const FIXTURE_CONVERSATION: Conversation = {
  id: CONV_ID,
  car_id: "car-1",
  user_id: "user-1",
  title: "what oil does it take?",
  locale: "en",
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};

const FAKE_SUPABASE = {} as unknown as SupabaseClient;

let messageSeq = 0;
function makeMessage(role: MessageRole, content: string, status: MessageStatus = "complete"): Message {
  messageSeq += 1;
  return {
    id: `m-${messageSeq.toString()}`,
    conversation_id: CONV_ID,
    user_id: "user-1",
    role,
    content,
    status,
    model: null,
    created_at: `2026-09-01T00:00:0${messageSeq.toString()}Z`,
  };
}

interface CtxOptions {
  user?: { id: string } | null;
  selectedCarId?: string | null;
  lang?: "en" | "pl";
  json?: () => Promise<unknown>;
  waitUntil?: (p: Promise<unknown>) => void;
}

// Hand-build the minimal context the route reads. `cfContext` is supplied by
// default so the deferred commit runs inline and can be asserted; the route also
// has to work without it, which `after-response.test.ts` covers.
function makeContext({
  user = { id: "user-1" },
  selectedCarId = "car-1",
  lang = "en",
  json = () => Promise.resolve({ prompt: "what oil does it take?" }),
  waitUntil,
}: CtxOptions = {}): APIContext {
  const deferred: Promise<unknown>[] = [];
  const ctx = {
    locals: {
      user,
      selectedCarId,
      lang,
      cfContext: { waitUntil: waitUntil ?? ((p: Promise<unknown>) => deferred.push(p)) },
    },
    request: { headers: new Headers(), json },
    cookies: {},
  } as unknown as APIContext;
  (ctx as unknown as { __deferred: Promise<unknown>[] }).__deferred = deferred;
  return ctx;
}

/** Wait for whatever the route handed to `waitUntil`, so commits are observable. */
async function settle(ctx: APIContext): Promise<void> {
  await Promise.all((ctx as unknown as { __deferred: Promise<unknown>[] }).__deferred);
}

function readJson(res: Response): Promise<unknown> {
  return res.json() as Promise<unknown>;
}

// The stub chunk shape the route reads: `chunk.choices[0]?.delta?.content` plus
// the resolved `model` the router names on every chunk.
interface ChatChunk {
  model?: string;
  choices: { delta: { content?: string } }[];
}

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
    vi.mocked(getRecentEntries).mockResolvedValue([]);
    vi.mocked(createConversation).mockResolvedValue(FIXTURE_CONVERSATION);
    vi.mocked(getConversationById).mockResolvedValue(FIXTURE_CONVERSATION);
    vi.mocked(getMessages).mockResolvedValue([]);
    vi.mocked(appendMessage).mockImplementation((_c, data) =>
      Promise.resolve(makeMessage(data.role, data.content, data.status ?? "complete")),
    );
    vi.mocked(touchConversation).mockResolvedValue(undefined);
    vi.mocked(isRateLimitError).mockReturnValue(false);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  describe("guards", () => {
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

    it("400 when conversation_id is present but not a uuid, before any write", async () => {
      const res = await POST(
        makeContext({ json: () => Promise.resolve({ prompt: "hi", conversation_id: "not-a-uuid" }) }),
      );

      expect(res.status).toBe(400);
      expect(getConversationById).not.toHaveBeenCalled();
      expect(appendMessage).not.toHaveBeenCalled();
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
      vi.mocked(getCarById).mockResolvedValue(null);

      const res = await POST(makeContext());

      expect(res.status).toBe(404);
      expect(await readJson(res)).toEqual({ error: "Car not found" });
      // R1 regression guard: ownership short-circuits before the model is touched.
      expect(createChatStream).not.toHaveBeenCalled();
    });
  });

  describe("conversation resolution", () => {
    it("404 when the conversation is not the caller's, spending no request and writing nothing", async () => {
      vi.mocked(getConversationById).mockResolvedValue(null);

      const res = await POST(makeContext({ json: () => Promise.resolve({ prompt: "hi", conversation_id: CONV_ID }) }));

      expect(res.status).toBe(404);
      expect(await readJson(res)).toEqual({ error: "Conversation not found" });
      // The R1 guard generalised: a thread the caller may not use must cost
      // nothing from a daily request cap measured in tens.
      expect(createChatStream).not.toHaveBeenCalled();
      expect(appendMessage).not.toHaveBeenCalled();
    });

    it("404 when the conversation belongs to a different car of the same user", async () => {
      // The failure this check exists for: `selected_car_id` is a cookie read
      // fresh on every POST, so without it a Golf thread would silently continue
      // under a Mazda system prompt.
      vi.mocked(getConversationById).mockResolvedValue({ ...FIXTURE_CONVERSATION, car_id: "car-2" });

      const res = await POST(makeContext({ json: () => Promise.resolve({ prompt: "hi", conversation_id: CONV_ID }) }));

      expect(res.status).toBe(404);
      expect(createChatStream).not.toHaveBeenCalled();
      expect(appendMessage).not.toHaveBeenCalled();
    });

    it("creates a thread titled from the prompt, in the request's locale", async () => {
      vi.mocked(createChatStream).mockResolvedValue(streamOf({ choices: [{ delta: { content: "hi" } }] }));

      await POST(makeContext({ lang: "pl", json: () => Promise.resolve({ prompt: "  jaki   olej?  " }) }));

      expect(createConversation).toHaveBeenCalledWith(FAKE_SUPABASE, {
        user_id: "user-1",
        car_id: "car-1",
        title: "jaki olej?",
        locale: "pl",
      });
    });

    it("replays only complete pairs from a resumed thread, keyed by conversation id", async () => {
      vi.mocked(getMessages).mockResolvedValue([
        makeMessage("user", "q1"),
        makeMessage("assistant", "a1"),
        makeMessage("user", "interrupted"),
        makeMessage("assistant", "cut off", "aborted"),
      ]);
      vi.mocked(createChatStream).mockResolvedValue(streamOf({ choices: [{ delta: { content: "hi" } }] }));

      await POST(makeContext({ json: () => Promise.resolve({ prompt: "follow up", conversation_id: CONV_ID }) }));

      expect(createChatStream).toHaveBeenCalledWith(
        expect.objectContaining({
          car: FIXTURE_CAR,
          history: [
            { role: "user", content: "q1" },
            { role: "assistant", content: "a1" },
          ],
          prompt: "follow up",
          // Sticky routing is keyed on the thread, so a conversation tends to
          // keep the model it started with.
          sessionId: CONV_ID,
          locale: "en",
        }),
      );
      expect(createConversation).not.toHaveBeenCalled();
    });

    it("passes an abort signal so a walked-away reader stops costing requests", async () => {
      vi.mocked(createChatStream).mockResolvedValue(streamOf({ choices: [{ delta: { content: "hi" } }] }));

      await POST(makeContext());

      const input = vi.mocked(createChatStream).mock.calls[0][0];
      expect(input.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("streaming and persistence", () => {
    it("200 emits meta first, then text, then a complete terminator", async () => {
      vi.mocked(createChatStream).mockResolvedValue(
        streamOf({ model: "some/model", choices: [{ delta: { content: "hi" } }] }),
      );

      const ctx = makeContext();
      const res = await POST(ctx);

      expect(res.status).toBe(200);
      expect(res.headers.get("X-Conversation-Id")).toBe(CONV_ID);
      const text = await res.text();
      const frames = text.trim().split("\n\n");
      // Meta is unconditionally first: a client that started a new thread must
      // learn its id even if the model fails before its first token.
      expect(frames[0]).toBe(`data: {"meta":{"conversation_id":"${CONV_ID}"}}`);
      expect(text).toContain('data: {"text":"hi"}');
      expect(text).toContain('data: {"done":"complete"}');
      expect(text).toContain("data: [DONE]");
    });

    it("writes the user turn before calling the model, and the reply after the stream", async () => {
      vi.mocked(createChatStream).mockResolvedValue(
        streamOf(
          { model: "some/model", choices: [{ delta: { content: "hi " } }] },
          { choices: [{ delta: { content: "there" } }] },
        ),
      );

      const ctx = makeContext();
      const res = await POST(ctx);
      await res.text();
      await settle(ctx);

      const roles = vi.mocked(appendMessage).mock.calls.map((c) => c[1]);
      expect(roles[0]).toMatchObject({ role: "user", content: "what oil does it take?", status: "complete" });
      // Accumulated server-side: the assistant row is the whole reply, written
      // once, not one row per token.
      expect(roles[1]).toMatchObject({
        role: "assistant",
        content: "hi there",
        status: "complete",
        model: "some/model",
      });
      // Ordering the thread list by activity needs the explicit bump.
      expect(touchConversation).toHaveBeenCalledWith(FAKE_SUPABASE, CONV_ID, "user-1");
    });

    it("writes nothing and reports error when the model produces no text", async () => {
      vi.mocked(createChatStream).mockResolvedValue(streamOf({ choices: [{ delta: {} }] }));

      const ctx = makeContext();
      const res = await POST(ctx);
      const text = await res.text();
      await settle(ctx);

      expect(text).toContain('data: {"done":"error"}');
      // An empty bubble tells the user nothing, and the column refuses it anyway.
      const assistantWrites = vi.mocked(appendMessage).mock.calls.filter((c) => c[1].role === "assistant");
      expect(assistantWrites).toHaveLength(0);
    });

    it("keeps a mid-stream failure's partial text, marked, and leaks nothing", async () => {
      vi.mocked(createChatStream).mockResolvedValue(
        makeStream(function* () {
          yield { choices: [{ delta: { content: "partial" } }] };
          throw new Error("upstream exploded: sk-or-test-LEAK");
        }),
      );

      const ctx = makeContext();
      const res = await POST(ctx);
      const text = await res.text();
      await settle(ctx);

      expect(text).toContain('data: {"text":"partial"}');
      expect(text).toContain('{"error":"Stream failed"}');
      expect(text).toContain('data: {"done":"error"}');
      expect(text).toContain("data: [DONE]");
      expect(text).not.toContain("sk-or-test-LEAK");

      // Marked, not discarded and not stored as if whole: an unmarked partial
      // would be replayed as context and teach the model to stop mid-word.
      const assistantWrite = vi.mocked(appendMessage).mock.calls.find((c) => c[1].role === "assistant");
      expect(assistantWrite?.[1]).toMatchObject({ content: "partial", status: "error" });
    });
  });

  describe("abort", () => {
    it("cancels upstream and keeps the partial as aborted when the reader goes away", async () => {
      // The behaviour the whole `cancel()` handler exists for: without it a
      // reader who closes the tab leaves the Worker consuming OpenRouter to
      // completion, spending a request from a capped daily budget for nobody.
      let released!: () => void;
      const gate = new Promise<void>((resolve) => (released = resolve));

      vi.mocked(createChatStream).mockResolvedValue(
        makeStream(async function* () {
          yield { model: "some/model", choices: [{ delta: { content: "half an ans" } }] };
          await gate;
          yield { choices: [{ delta: { content: "wer" } }] };
        } as unknown as () => Generator<ChatChunk>),
      );

      const ctx = makeContext();
      const res = await POST(ctx);

      expect(res.body).not.toBeNull();
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      // Drain the meta frame and the first delta, then walk away mid-stream.
      await reader.read();
      await reader.read();
      await reader.cancel();
      released();
      await settle(ctx);

      const input = vi.mocked(createChatStream).mock.calls[0][0];
      expect(input.signal?.aborted).toBe(true);

      const assistantWrite = vi.mocked(appendMessage).mock.calls.find((c) => c[1].role === "assistant");
      // Marked aborted, so the next turn's window skips it rather than teaching
      // the model to stop mid-word.
      expect(assistantWrite?.[1]).toMatchObject({ status: "aborted" });
      expect(assistantWrite?.[1].content).toContain("half an ans");
    });
  });

  describe("upstream failures", () => {
    it("429 says the assistant is rate-limited rather than broken", async () => {
      // At 50 requests/day account-wide, hitting the cap is a matter of when. A
      // rationed chatbot that cannot say it is rationed reads as broken.
      const err = new Error("429 rate limit exceeded");
      vi.mocked(isRateLimitError).mockReturnValue(true);
      vi.mocked(createChatStream).mockRejectedValue(err);

      const res = await POST(makeContext());

      expect(res.status).toBe(429);
      expect(await readJson(res)).toEqual({ error: "AI assistant is rate-limited" });
      expect(appendMessage).toHaveBeenCalledTimes(1); // the question survives
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

    it("logs the failure as one flat, queryable object (F9)", async () => {
      vi.mocked(createChatStream).mockRejectedValue(new Error("401 Invalid API key: sk-or-test-LEAK"));

      await POST(makeContext());

      const logged = vi.mocked(console.error);
      expect(logged).toHaveBeenCalledTimes(1);
      // A single object argument. `console.error("[ai/chat] …", err)` collapsed
      // into one opaque unindexed string and put the key in Workers Logs.
      expect(logged.mock.calls[0]).toHaveLength(1);
      expect(logged.mock.calls[0][0]).toMatchObject({
        event: "api_error",
        route: "/api/ai/chat",
        method: "POST",
        userId: "user-1",
        status: 500,
      });
    });
  });
});
