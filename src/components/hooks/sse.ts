import type { ChatFrame } from "@/lib/chat";
import { DONE_TERMINATOR } from "@/lib/chat";

/**
 * Read one chat response's SSE frames to their end.
 *
 * Pure and hook-free so the parsing rules can be tested without a DOM or a
 * React render — the previous version of this loop lived inside a `useEffect`,
 * which is why four separate framing bugs sat in it unnoticed.
 *
 * Fixes carried forward from that version, each of which multi-turn promotes
 * from harmless to live:
 *
 *   - `[DONE]` stops **both** loops. The old code broke only the inner
 *     per-line loop, so any event still buffered in the same chunk was
 *     delivered after the terminator.
 *   - the reader is released in `finally`, not left locked until the next
 *     effect's cleanup — one leaked connection per turn rather than per page.
 *   - `signal` cancels the reader, so an aborted turn stops pulling instead of
 *     draining a response nobody will read.
 *
 * Two things the old loop got right and this keeps: decoding with
 * `{ stream: true }`, so a multi-byte UTF-8 character split across chunk
 * boundaries is not mangled, and keeping the trailing partial event in the
 * buffer rather than parsing it early.
 */
export async function readChatFrames(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: ChatFrame) => void,
  signal: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abort);

  try {
    let reading = true;
    while (reading) {
      if (signal.aborted) break;

      const { done, value } = await reader.read();
      // `done` alone is enough to notice an abort: the listener above cancels
      // the reader, which resolves this pending read as done. The guard at the
      // top of the loop covers an abort that lands between two reads.
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Walk complete events (delimited by a blank line); anything after the
      // last delimiter is a partial event and stays in the buffer.
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1 && reading) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");

        for (const line of event.split("\n")) {
          // OpenRouter injects `: OPENROUTER PROCESSING` keepalives. They are
          // SSE comments, not data, and a parser that does not skip them tries
          // to JSON.parse a comment on every slow generation.
          if (line.startsWith(":")) continue;
          if (!line.startsWith("data: ")) continue;

          const payload = line.slice(6);
          if (payload === DONE_TERMINATOR) {
            // Stops the inner loop via the `break` and the outer one via the
            // flag the outer `while` actually tests. The old code set a flag the
            // outer loop never read.
            reading = false;
            break;
          }

          let frame: ChatFrame;
          try {
            frame = JSON.parse(payload) as ChatFrame;
          } catch {
            // A malformed frame is not worth failing a whole answer over.
            continue;
          }
          onFrame(frame);
        }
      }
    }
  } finally {
    signal.removeEventListener("abort", abort);
    // Releasing beats leaving it locked for the garbage collector to notice.
    // `cancel` on an already-finished stream is a no-op, not an error.
    try {
      reader.releaseLock();
    } catch {
      // Already released, or cancelled out from under us by the abort handler.
    }
  }
}
