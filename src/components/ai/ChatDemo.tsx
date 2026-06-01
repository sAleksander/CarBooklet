import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useStreamingText } from "@/components/hooks/useStreamingText";
import { StreamingText } from "./StreamingText";

export function ChatDemo() {
  const [prompt, setPrompt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stream, setStream] = useState<ReadableStream<Uint8Array> | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const { text, isDone, error } = useStreamingText(stream);

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!prompt.trim() || isSubmitting) return;

    setStream(null);
    setFetchError(null);
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setFetchError(data.error ?? `Request failed (${res.status})`);
        return;
      }

      if (res.body) {
        setStream(res.body);
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  const hasResponse = text.length > 0 || error !== null || (stream !== null && !isDone);

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-3">
        <textarea
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
          }}
          placeholder="Ask anything about your car…"
          className="w-full resize-none rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder-white/40 focus:ring-2 focus:ring-purple-400 focus:outline-none"
          rows={3}
          disabled={isSubmitting}
        />
        <Button type="submit" disabled={isSubmitting || !prompt.trim()}>
          {isSubmitting ? "Sending…" : "Ask"}
        </Button>
      </form>

      {fetchError && <p className="text-destructive text-sm">{fetchError}</p>}

      {hasResponse && (
        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          <p className="mb-2 text-xs tracking-wide text-white/40 uppercase">Assistant</p>
          <StreamingText text={text} isDone={isDone} error={error} />
        </div>
      )}
    </div>
  );
}
