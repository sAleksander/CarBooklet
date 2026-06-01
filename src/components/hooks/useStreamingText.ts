import { useState, useEffect } from "react";

export function useStreamingText(stream: ReadableStream<Uint8Array> | null): {
  text: string;
  isDone: boolean;
  error: string | null;
} {
  const [text, setText] = useState("");
  const [isDone, setIsDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!stream) return;

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let cancelled = false;

    async function read() {
      // Reset accumulated state at the start of each new stream
      setText("");
      setIsDone(false);
      setError(null);

      try {
        let reading = true;
        while (reading) {
          const { done, value } = await reader.read();
          if (cancelled) break;
          if (done) {
            setIsDone(true);
            reading = false;
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          // Walk complete SSE events (delimited by \n\n); leave any partial event in buffer
          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const event = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");

            for (const line of event.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              const payload = line.slice(6);
              if (payload === "[DONE]") {
                setIsDone(true);
                reading = false;
                break;
              }
              try {
                const parsed = JSON.parse(payload) as { text?: string; error?: string };
                const delta = parsed.text;
                const streamError = parsed.error;
                if (delta) setText((prev) => prev + delta);
                if (streamError) setError(streamError);
              } catch {
                // ignore malformed chunks
              }
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Stream read failed");
          setIsDone(true);
        }
      }
    }

    void read();

    return () => {
      cancelled = true;
      void reader.cancel();
    };
  }, [stream]);

  return { text, isDone, error };
}
