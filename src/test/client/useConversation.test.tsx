import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useConversation } from "@/components/hooks/useConversation";
import type { ChatMessage } from "@/types";

/**
 * The hook's contract, pinned in a DOM.
 *
 * Every case here is either a bug the old `useStreamingText` shipped with, or a
 * rule the persisted transcript depends on. None of it was reachable before this
 * project existed — the client half of chat had no test path at all.
 */

const encoder = new TextEncoder();

/** A response body that emits the given SSE lines, one chunk each. */
function sseBody(lines: string[], onCancel?: () => void): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= lines.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(lines[i]));
      i += 1;
    },
    cancel: onCancel,
  });
}

/**
 * A body the test drives frame by frame.
 *
 * The eager helper above finishes inside a microtask, so a turn is over before
 * any assertion can observe it mid-flight. Anything about the *in-flight* state
 * — stop, unmount, the re-submit guard — needs a stream that stays open until
 * the test says otherwise.
 */
function controllableBody(onCancel?: () => void) {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
    cancel: onCancel,
  });
  return {
    response: { ok: true, status: 200, body } as unknown as Response,
    push: (line: string) => {
      ctrl.enqueue(encoder.encode(line));
    },
    close: () => {
      // Idempotent: an aborted turn has already cancelled the stream, and a
      // test tearing down after that should not fail on the fixture.
      try {
        ctrl.close();
      } catch {
        // already closed or cancelled
      }
    },
  };
}

function okResponse(lines: string[], onCancel?: () => void): Response {
  return { ok: true, status: 200, body: sseBody(lines, onCancel) } as unknown as Response;
}

function errorResponse(status: number, error: string): Response {
  return { ok: false, status, body: null, json: () => Promise.resolve({ error }) } as unknown as Response;
}

const COMPLETE_TURN = [
  'data: {"meta":{"conversation_id":"conv-1"}}\n\n',
  'data: {"text":"5W-"}\n\n',
  'data: {"text":"30"}\n\n',
  'data: {"done":"complete"}\n\n',
  "data: [DONE]\n\n",
];

function setup(overrides: Partial<{ conversationId: string | null; initialMessages: ChatMessage[] }> = {}) {
  return renderHook(() =>
    useConversation({
      conversationId: overrides.conversationId ?? null,
      initialMessages: overrides.initialMessages ?? [],
    }),
  );
}

describe("useConversation", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    history.replaceState(null, "", "/ai-chat");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("exposes the server-rendered transcript unchanged", () => {
    const initial: ChatMessage[] = [
      { id: "m1", role: "user", content: "q", status: "complete" },
      { id: "m2", role: "assistant", content: "a", status: "complete" },
    ];

    const { result } = setup({ initialMessages: initial });

    expect(result.current.messages).toEqual(initial);
    expect(result.current.pending.active).toBe(false);
  });

  it("sends only the prompt and the conversation id — never the transcript", async () => {
    // The server owns history. Sending it from here would hand the client the
    // model's whole context and unbound the daily request cap.
    vi.mocked(fetch).mockResolvedValue(okResponse(COMPLETE_TURN));
    const { result } = setup({
      conversationId: "conv-1",
      initialMessages: [{ id: "m1", role: "user", content: "earlier", status: "complete" }],
    });

    await act(async () => {
      await result.current.send("what oil?");
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string) as Record<string, unknown>;
    expect(body).toEqual({ prompt: "what oil?", conversation_id: "conv-1" });
    expect(JSON.stringify(body)).not.toContain("earlier");
  });

  it("appends the question immediately and marks the turn in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.mocked(fetch).mockImplementation(async () => {
      await gate;
      return okResponse(COMPLETE_TURN);
    });

    const { result } = setup();

    let sending!: Promise<void>;
    act(() => {
      sending = result.current.send("follow up");
    });

    // The question is on screen before the server has answered — the whole
    // point of the optimistic append.
    await waitFor(() => {
      expect(result.current.pending.active).toBe(true);
    });
    expect(result.current.messages.at(-1)).toMatchObject({ role: "user", content: "follow up" });

    await act(async () => {
      release();
      await sending;
    });
  });

  it("does not carry one answer's text into the next turn (B3)", async () => {
    // The stale-answer flash the old hook shipped with, in the form this design
    // can still produce it: the streaming buffer must be emptied when a turn is
    // committed, or the next turn starts with the previous answer already in it.
    vi.mocked(fetch).mockResolvedValue(okResponse(COMPLETE_TURN));
    const { result } = setup();

    await act(async () => {
      await result.current.send("first");
    });
    expect(result.current.messages.at(-1)).toMatchObject({ content: "5W-30" });

    // Second turn, streamed one frame at a time so the in-flight buffer is
    // observable rather than inferred.
    const stream = controllableBody();
    vi.mocked(fetch).mockResolvedValue(stream.response);

    let sending!: Promise<void>;
    act(() => {
      sending = result.current.send("second");
    });
    await waitFor(() => {
      expect(result.current.pending.active).toBe(true);
    });
    // Nothing from the first answer is showing.
    expect(result.current.pending.text).toBe("");

    act(() => {
      stream.push('data: {"text":"fresh"}\n\n');
    });
    await waitFor(() => {
      expect(result.current.pending.text).toBe("fresh");
    });

    act(() => {
      stream.push('data: {"done":"complete"}\n\n');
      stream.push("data: [DONE]\n\n");
      stream.close();
    });
    await act(async () => {
      await sending;
    });

    // The second answer is its own message, not the first one with more glued on.
    expect(result.current.messages.at(-1)).toMatchObject({ content: "fresh", status: "complete" });
    // And the first answer is still there, intact.
    expect(result.current.messages.map((m) => m.content)).toEqual(["first", "5W-30", "second", "fresh"]);
  });

  it("ignores a second send while a reply is streaming", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.mocked(fetch).mockImplementation(async () => {
      await gate;
      return okResponse(COMPLETE_TURN);
    });

    const { result } = setup();

    let first!: Promise<void>;
    act(() => {
      first = result.current.send("first");
    });
    await waitFor(() => {
      expect(result.current.pending.active).toBe(true);
    });

    await act(async () => {
      await result.current.send("second");
    });

    // The old submit guard cleared as soon as res.body was assigned, so a second
    // question silently discarded the first answer.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(result.current.messages.filter((m) => m.role === "user")).toHaveLength(1);

    await act(async () => {
      release();
      await first;
    });
  });

  it("adopts the conversation id from the meta frame and puts it in the address bar", async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse(COMPLETE_TURN));
    const { result } = setup({ conversationId: null });

    await act(async () => {
      await result.current.send("what oil?");
    });

    expect(result.current.conversationId).toBe("conv-1");
    // The address bar now points at the thread, so a reload lands back on it.
    // Asserted through the URL rather than a spy on replaceState: the URL is the
    // behaviour, the method is the mechanism.
    expect(window.location.pathname).toBe("/ai-chat/conv-1");
  });

  it("does not rewrite the URL when the thread was already open", async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse(COMPLETE_TURN));
    const { result } = setup({ conversationId: "conv-1" });

    await act(async () => {
      await result.current.send("follow up");
    });

    // Nothing to adopt, so the URL is left exactly as the page rendered it.
    expect(window.location.pathname).toBe("/ai-chat");
  });

  it("moves the streamed text into the transcript on done:complete", async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse(COMPLETE_TURN));
    const { result } = setup();

    await act(async () => {
      await result.current.send("what oil?");
    });

    expect(result.current.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "5W-30",
      status: "complete",
    });
    expect(result.current.pending).toEqual({ text: "", active: false });
  });

  it("keeps a truncated answer, marked, when the server reports a stream failure", async () => {
    vi.mocked(fetch).mockResolvedValue(
      okResponse([
        'data: {"meta":{"conversation_id":"conv-1"}}\n\n',
        'data: {"text":"partial"}\n\n',
        'data: {"error":"Stream failed"}\n\n',
        'data: {"done":"error"}\n\n',
        "data: [DONE]\n\n",
      ]),
    );
    const { result } = setup();

    await act(async () => {
      await result.current.send("what oil?");
    });

    // Kept and marked: a truncated answer the user can read beats an empty box,
    // and the status is what stops it being replayed as context.
    expect(result.current.messages.at(-1)).toMatchObject({ content: "partial", status: "error" });
    expect(result.current.error).toEqual({ kind: "server", message: "Stream failed" });
  });

  it("marks a reply aborted and stops the request when the user presses stop", async () => {
    const cancelled = vi.fn();
    const stream = controllableBody(cancelled);
    vi.mocked(fetch).mockResolvedValue(stream.response);
    const { result } = setup();

    let sending!: Promise<void>;
    act(() => {
      sending = result.current.send("long question");
    });

    // Half an answer on screen, and the stream deliberately still open.
    act(() => {
      stream.push('data: {"meta":{"conversation_id":"conv-1"}}\n\n');
      stream.push('data: {"text":"half an ans"}\n\n');
    });
    await waitFor(() => {
      expect(result.current.pending.text).toBe("half an ans");
    });

    act(() => {
      result.current.stop();
    });

    expect(result.current.pending.active).toBe(false);
    expect(result.current.messages.at(-1)).toMatchObject({ role: "assistant", status: "aborted" });
    expect(result.current.messages.at(-1)?.content).toBe("half an ans");

    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(true);
    // The producer is told, which is what stops the body being drained in the
    // background — and server-side, what lets the upstream request be aborted.
    await waitFor(() => {
      expect(cancelled).toHaveBeenCalled();
    });

    await act(async () => {
      await sending;
    });
  });

  it("stop is a no-op when nothing is in flight", () => {
    const { result } = setup();

    act(() => {
      result.current.stop();
    });

    expect(result.current.messages).toEqual([]);
  });

  it("reports a rate limit as its own kind, and appends no assistant message", async () => {
    vi.mocked(fetch).mockResolvedValue(errorResponse(429, "AI assistant is rate-limited"));
    const { result } = setup();

    await act(async () => {
      await result.current.send("what oil?");
    });

    // A rationed assistant is not a broken one, and the UI needs to say so.
    expect(result.current.error).toEqual({ kind: "rate_limited" });
    expect(result.current.messages.filter((m) => m.role === "assistant")).toHaveLength(0);
    // The question stays on screen — the server persisted it too.
    expect(result.current.messages.at(-1)).toMatchObject({ role: "user" });
    expect(result.current.pending.active).toBe(false);
  });

  it("reports a missing conversation as its own kind", async () => {
    vi.mocked(fetch).mockResolvedValue(errorResponse(404, "Conversation not found"));
    const { result } = setup({ conversationId: "gone" });

    await act(async () => {
      await result.current.send("what oil?");
    });

    expect(result.current.error).toEqual({ kind: "conversation_not_found" });
  });

  it("reports a transport failure as a network error", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = setup();

    await act(async () => {
      await result.current.send("what oil?");
    });

    expect(result.current.error).toEqual({ kind: "network" });
    expect(result.current.pending.active).toBe(false);
  });

  it("recovers for the next turn after a failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(errorResponse(429, "AI assistant is rate-limited"));
    const { result } = setup();
    await act(async () => {
      await result.current.send("first");
    });

    vi.mocked(fetch).mockResolvedValue(okResponse(COMPLETE_TURN));
    await act(async () => {
      await result.current.send("second");
    });

    // The in-flight guard must not latch on a failed turn.
    expect(result.current.error).toBeNull();
    expect(result.current.messages.at(-1)).toMatchObject({ role: "assistant", status: "complete" });
  });

  it("ignores an empty or whitespace-only prompt", async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.send("   ");
    });

    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
  });

  it("aborts the in-flight request when the component unmounts", async () => {
    const stream = controllableBody();
    vi.mocked(fetch).mockResolvedValue(stream.response);
    const { result, unmount } = setup();

    let sending!: Promise<void>;
    act(() => {
      sending = result.current.send("question");
    });
    act(() => {
      stream.push('data: {"meta":{"conversation_id":"conv-1"}}\n\n');
    });
    await waitFor(() => {
      expect(result.current.pending.active).toBe(true);
    });

    unmount();

    // Navigating away must not leave a fetch draining in the background.
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(true);

    await act(async () => {
      stream.close();
      await sending;
    });
  });
});
