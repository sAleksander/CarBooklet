import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act, cleanup } from "@testing-library/react";
import { ChatThread } from "@/components/ai/ChatThread";

/**
 * The accessible progress signal, which is a PRD requirement rather than a
 * nicety: prd.md:92 names the absence of visible feedback during an AI query a
 * regression, and until this change a screen-reader user got none at all — the
 * streaming reply was a `▋` with no role, no name and no live region.
 *
 * These are transition assertions, deliberately. What must not regress is not
 * "the answer is announced" — announcing the answer on every token delta is the
 * failure mode, not the goal — but "the start and the end of the turn are each
 * announced, once".
 *
 * First component render test in the repo: `src/test/client/` held only
 * `useConversation.test.tsx`, which uses `renderHook` and mounts nothing. No
 * `jest-dom` and no `user-event` here on purpose — neither is a dependency, and
 * `fireEvent` plus plain assertions cover this without adding one.
 */

const encoder = new TextEncoder();

/** A body the test drives frame by frame, so a turn can be observed mid-flight. */
function controllableBody() {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });
  return {
    response: { ok: true, status: 200, body } as unknown as Response,
    push: async (line: string) => {
      await act(async () => {
        ctrl.enqueue(encoder.encode(line));
        await Promise.resolve();
      });
    },
    close: async () => {
      await act(async () => {
        try {
          ctrl.close();
        } catch {
          // already closed or cancelled
        }
        await Promise.resolve();
      });
    },
  };
}

/** A non-OK response, for the path where the turn dies before any frame. */
function errorResponse(status: number, error: string): Response {
  return { ok: false, status, body: null, json: () => Promise.resolve({ error }) } as unknown as Response;
}

function renderThread() {
  return render(<ChatThread lang="en" conversationId={null} initialMessages={[]} />);
}

/** The live region, located the way a screen reader and an E2E spec both would. */
function progressText(): string {
  return screen.getByRole("status", { name: "Assistant reply status" }).textContent;
}

async function ask() {
  const box = screen.getByLabelText("Ask anything about your car…");
  fireEvent.change(box, { target: { value: "what oil?" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Ask" }));
    await Promise.resolve();
  });
}

describe("ChatThread progress announcements", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    history.replaceState(null, "", "/ai-chat");
  });

  afterEach(() => {
    // Explicit: RTL only registers its auto-cleanup when vitest runs with
    // `globals: true`, and this project does not. Without it every render
    // accumulates in the same document and `getByRole` starts finding two.
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("is present and silent before anything happens", () => {
    renderThread();
    // Mounted from the first render, not conditionally: a live region that
    // appears along with the stream cannot announce the stream ending.
    expect(progressText()).toBe("");
  });

  it("announces the start of a reply, and does not re-announce per token", async () => {
    const stream = controllableBody();
    vi.mocked(fetch).mockResolvedValue(stream.response);

    renderThread();
    await ask();
    await waitFor(() => {
      expect(progressText()).toBe("Assistant is replying…");
    });

    await stream.push('data: {"meta":{"conversation_id":"conv-1"}}\n\n');
    await stream.push('data: {"text":"5W-"}\n\n');
    await stream.push('data: {"text":"30"}\n\n');

    // The whole point: tokens arriving must not change what is announced.
    await waitFor(() => {
      expect(screen.getByText(/5W-30/)).not.toBeNull();
    });
    expect(progressText()).toBe("Assistant is replying…");
  });

  it("announces completion when the turn ends", async () => {
    const stream = controllableBody();
    vi.mocked(fetch).mockResolvedValue(stream.response);

    renderThread();
    await ask();
    await stream.push('data: {"meta":{"conversation_id":"conv-1"}}\n\n');
    await stream.push('data: {"text":"5W-30"}\n\n');
    await stream.push('data: {"done":"complete"}\n\n');
    await stream.push("data: [DONE]\n\n");
    await stream.close();

    await waitFor(() => {
      expect(progressText()).toBe("Reply complete");
    });
  });

  it("announces an interruption when the user stops mid-reply", async () => {
    const stream = controllableBody();
    vi.mocked(fetch).mockResolvedValue(stream.response);

    renderThread();
    await ask();
    await stream.push('data: {"meta":{"conversation_id":"conv-1"}}\n\n');
    await stream.push('data: {"text":"half an ans"}\n\n');

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop" })).not.toBeNull();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(progressText()).toBe("Answer interrupted");
    });
  });

  it("still announces when the user stops before the first token", async () => {
    // The case a `messages.length`-keyed announcer misses entirely:
    // `commitPending` returns early on an empty buffer, so the transcript never
    // grows and the only evidence the turn happened is `pending.active`.
    const stream = controllableBody();
    vi.mocked(fetch).mockResolvedValue(stream.response);

    renderThread();
    await ask();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop" })).not.toBeNull();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(progressText()).toBe("Answer interrupted");
    });
  });

  it("announces the failure, not an interruption, when the server rejects the turn", async () => {
    // The turn dies without `commitPending`, so the transcript ends on the
    // user's own message — shape-identical to an abort. Reading the status
    // alone told a screen-reader user they had stopped an answer the server
    // actually dropped, and contradicted the error line beside the region.
    vi.mocked(fetch).mockResolvedValue(errorResponse(500, "AI service error"));

    renderThread();
    await ask();

    await waitFor(() => {
      expect(progressText()).toBe("The assistant couldn't finish this answer. Please try again.");
    });
    expect(progressText()).not.toBe("Answer interrupted");
  });

  it("announces a rate limit in its own words", async () => {
    vi.mocked(fetch).mockResolvedValue(errorResponse(429, "AI assistant is rate-limited"));

    renderThread();
    await ask();

    await waitFor(() => {
      expect(progressText()).toBe("The assistant is temporarily rate-limited. Please try again later.");
    });
  });

  it("marks the streaming text busy while it fills, and not after", async () => {
    const stream = controllableBody();
    vi.mocked(fetch).mockResolvedValue(stream.response);

    const { container } = renderThread();
    await ask();
    await stream.push('data: {"meta":{"conversation_id":"conv-1"}}\n\n');
    await stream.push('data: {"text":"5W-30"}\n\n');

    await waitFor(() => {
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    });

    await stream.push('data: {"done":"complete"}\n\n');
    await stream.push("data: [DONE]\n\n");
    await stream.close();

    await waitFor(() => {
      expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    });
  });
});
