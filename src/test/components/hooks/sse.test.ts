import { describe, it, expect, vi } from "vitest";
import { readChatFrames } from "@/components/hooks/sse";
import type { ChatFrame } from "@/lib/chat";

/**
 * The framing rules, tested without a DOM or a React render.
 *
 * The previous version of this loop lived inside a `useEffect` and carried four
 * framing bugs that nothing could reach. Each case below is one of them, or one
 * of the two things the old loop got right and must keep getting right.
 */

const encoder = new TextEncoder();

/** A stream that yields exactly the given chunks, in order. */
function streamOf(...chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
}

async function collect(
  stream: ReadableStream<Uint8Array>,
  signal = new AbortController().signal,
): Promise<ChatFrame[]> {
  const frames: ChatFrame[] = [];
  await readChatFrames(stream, (f) => frames.push(f), signal);
  return frames;
}

function textOf(frames: ChatFrame[]): string {
  return frames.map((f) => ("text" in f ? f.text : "")).join("");
}

describe("readChatFrames", () => {
  it("delivers frames in order", async () => {
    const frames = await collect(
      streamOf(
        'data: {"meta":{"conversation_id":"c1"}}\n\n',
        'data: {"text":"hello"}\n\n',
        'data: {"done":"complete"}\n\n',
        "data: [DONE]\n\n",
      ),
    );

    expect(frames).toEqual([{ meta: { conversation_id: "c1" } }, { text: "hello" }, { done: "complete" }]);
  });

  it("stops at [DONE] even when more events sit in the same chunk", async () => {
    // The old loop's `break` left the outer while-loop running, so anything
    // buffered after the terminator was still delivered. Harmless while the
    // server sent [DONE] last; a real bug the moment framing gets richer.
    const frames = await collect(streamOf('data: {"text":"kept"}\n\ndata: [DONE]\n\ndata: {"text":"AFTER"}\n\n'));

    expect(textOf(frames)).toBe("kept");
    expect(JSON.stringify(frames)).not.toContain("AFTER");
  });

  it("reassembles a frame split across chunk boundaries", async () => {
    const frames = await collect(streamOf('data: {"text":"sp', 'lit"}\n\n', "data: [DONE]\n\n"));

    expect(textOf(frames)).toBe("split");
  });

  it("handles several frames arriving in one chunk", async () => {
    const frames = await collect(streamOf('data: {"text":"a"}\n\ndata: {"text":"b"}\n\ndata: [DONE]\n\n'));

    expect(textOf(frames)).toBe("ab");
  });

  it("keeps multi-byte UTF-8 intact when a character is split across chunks", async () => {
    // "ł" is two bytes; the split lands between them. Decoding without
    // `{ stream: true }` yields a replacement character here, which in a Polish
    // conversation is not a rare edge case.
    const payload = encoder.encode('data: {"text":"świeca żarowa"}\n\n');
    const cut = 14;

    const frames = await collect(streamOf(payload.slice(0, cut), payload.slice(cut), "data: [DONE]\n\n"));

    expect(textOf(frames)).toBe("świeca żarowa");
    expect(textOf(frames)).not.toContain("�");
  });

  it("skips SSE comment keepalives", async () => {
    // OpenRouter injects `: OPENROUTER PROCESSING` during slow generations.
    const frames = await collect(
      streamOf(": OPENROUTER PROCESSING\n\n", 'data: {"text":"ok"}\n\n', "data: [DONE]\n\n"),
    );

    expect(textOf(frames)).toBe("ok");
    expect(frames).toHaveLength(1);
  });

  it("ignores a malformed frame instead of failing the whole answer", async () => {
    const frames = await collect(
      streamOf('data: {"text":"before"}\n\ndata: {not json}\n\ndata: {"text":"after"}\n\ndata: [DONE]\n\n'),
    );

    expect(textOf(frames)).toBe("beforeafter");
  });

  it("ends cleanly when the stream closes without a terminator", async () => {
    // What a dropped connection looks like from here.
    const frames = await collect(streamOf('data: {"text":"partial"}\n\n'));

    expect(textOf(frames)).toBe("partial");
  });

  it("leaves a trailing partial event unparsed", async () => {
    const frames = await collect(streamOf('data: {"text":"whole"}\n\ndata: {"text":"trunc'));

    expect(textOf(frames)).toBe("whole");
  });

  it("resolves without throwing when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const frames = await collect(streamOf('data: {"text":"never"}\n\n'), controller.signal);

    expect(frames).toEqual([]);
  });

  it("stops reading when the signal aborts mid-stream", async () => {
    const controller = new AbortController();
    let pushed = 0;

    // A stream that keeps producing until it is cancelled, so "did we stop?" is
    // observable rather than inferred from a fixed-length fixture.
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pushed += 1;
        c.enqueue(encoder.encode(`data: {"text":"${pushed.toString()}"}\n\n`));
      },
    });

    const frames: ChatFrame[] = [];
    await readChatFrames(
      stream,
      (f) => {
        frames.push(f);
        if (frames.length === 3) controller.abort();
      },
      controller.signal,
    );

    // It stopped rather than running forever, and did not keep collecting well
    // past the abort.
    expect(frames.length).toBeGreaterThanOrEqual(3);
    expect(frames.length).toBeLessThan(10);
  });

  it("releases the reader so the body can be cancelled afterwards", async () => {
    // The old loop never released on [DONE], leaking one locked reader per turn.
    const stream = streamOf('data: {"text":"x"}\n\n', "data: [DONE]\n\n");

    await collect(stream);

    expect(stream.locked).toBe(false);
    await expect(stream.cancel()).resolves.toBeUndefined();
  });

  it("cancels the underlying stream when aborted", async () => {
    const cancelled = vi.fn();
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        c.enqueue(encoder.encode('data: {"text":"tick"}\n\n'));
      },
      cancel: cancelled,
    });

    await readChatFrames(
      stream,
      () => {
        controller.abort();
      },
      controller.signal,
    );

    // Not just "we stopped looping" — the producer was told, which is what stops
    // a fetch body from being drained in the background.
    expect(cancelled).toHaveBeenCalled();
  });
});
