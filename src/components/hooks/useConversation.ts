import { useState, useRef, useCallback, useEffect } from "react";
import type { ChatMessage, MessageStatus } from "@/types";
import type { ChatFrame } from "@/lib/chat";
import { readChatFrames } from "./sse";

/**
 * What went wrong, in terms the UI can translate.
 *
 * A discriminated union rather than a string because two of these need their own
 * copy: a rate-limited assistant is temporarily rationed, not broken, and a
 * missing conversation means the thread is gone rather than the request bad.
 * `server` carries the API's own fixed literal, which is safe to show — nothing
 * the database authored ever reaches a response body.
 */
export type ChatError =
  | { kind: "rate_limited" }
  | { kind: "conversation_not_found" }
  | { kind: "network" }
  | { kind: "server"; message: string };

export interface PendingTurn {
  /** Text streamed so far for the in-flight reply. */
  text: string;
  active: boolean;
}

export interface UseConversationOptions {
  conversationId: string | null;
  initialMessages: ChatMessage[];
}

export interface UseConversationResult {
  conversationId: string | null;
  messages: ChatMessage[];
  pending: PendingTurn;
  error: ChatError | null;
  send: (prompt: string) => Promise<void>;
  stop: () => void;
}

const ENDPOINT = "/api/ai/chat";

/** Ids for optimistic rows. Replaced on reload by the real ones from the server. */
let localSeq = 0;
function localId(prefix: string): string {
  localSeq += 1;
  return `local-${prefix}-${localSeq.toString()}`;
}

/**
 * The transcript, the in-flight turn, and the abort controller.
 *
 * Replaces the old one-shot streaming hook, which could not be reused: it owned
 * exactly one answer and reset it at the top of every read, so a caller wanting
 * to keep a transcript had to snapshot the text on the done edge, racing that
 * reset.
 *
 * The server remains authoritative. This hook never sends prior turns — only
 * `{ conversation_id, prompt }` — and never invents an assistant message the
 * server did not stream. What it keeps locally is a mirror of what the server
 * persists, so a reload shows the same thing without a round-trip in between.
 */
export function useConversation({ conversationId, initialMessages }: UseConversationOptions): UseConversationResult {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [currentId, setCurrentId] = useState<string | null>(conversationId);
  const [pending, setPending] = useState<PendingTurn>({ text: "", active: false });
  const [error, setError] = useState<ChatError | null>(null);

  // A ref, not state: the guard has to be correct within a single tick, and
  // `pending.active` from a closure is a render old. This is what stops a second
  // question silently discarding the first answer.
  const inFlight = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  // Read by `stop`, which needs the text as of now rather than as of its render.
  const textRef = useRef("");

  useEffect(() => {
    // Unmount mid-answer must not leave a fetch draining in the background.
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  const commitPending = useCallback((status: MessageStatus) => {
    const text = textRef.current;
    textRef.current = "";
    setPending({ text: "", active: false });
    inFlight.current = false;
    controllerRef.current = null;
    // An empty reply is not a message — the same rule the server applies before
    // it writes a row, so the two stay in agreement.
    if (!text) return;
    setMessages((prev) => [...prev, { id: localId("assistant"), role: "assistant", content: text, status }]);
  }, []);

  const stop = useCallback(() => {
    if (!inFlight.current) return;
    controllerRef.current?.abort();
    // Marked aborted, mirroring what the server writes from its own buffer once
    // it notices the reader has gone.
    commitPending("aborted");
  }, [commitPending]);

  const send = useCallback(
    async (prompt: string) => {
      const trimmed = prompt.trim();
      if (!trimmed || inFlight.current) return;

      inFlight.current = true;
      setError(null);
      // Cleared *before* the request, not when the first token arrives. The old
      // hook bailed out ahead of its own reset, so the previous answer stayed on
      // screen for the whole fetch — a stale-answer flash on every follow-up.
      textRef.current = "";
      setPending({ text: "", active: true });
      setMessages((prev) => [...prev, { id: localId("user"), role: "user", content: trimmed, status: "complete" }]);

      const controller = new AbortController();
      controllerRef.current = controller;

      let res: Response;
      try {
        res = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: trimmed, conversation_id: currentId ?? undefined }),
          signal: controller.signal,
        });
      } catch {
        // Includes the abort case, where the user pressed stop before a single
        // byte arrived; `stop` has already reset the pending state.
        if (!controller.signal.aborted) {
          setError({ kind: "network" });
          setPending({ text: "", active: false });
          inFlight.current = false;
          controllerRef.current = null;
        }
        return;
      }

      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; conversation_id?: string };
        // A failure *after* the thread was created still carries its id. Adopt
        // it before reporting the error, so a retry continues this thread
        // instead of opening another one beside it — and so a reload lands on
        // the question the user already asked.
        if (body.conversation_id) {
          adoptConversation(body.conversation_id, currentId, setCurrentId);
        }
        setError(errorForResponse(res.status, body.error));
        setPending({ text: "", active: false });
        inFlight.current = false;
        controllerRef.current = null;
        return;
      }

      const onFrame = (frame: ChatFrame) => {
        if ("meta" in frame) {
          adoptConversation(frame.meta.conversation_id, currentId, setCurrentId);
          return;
        }
        if ("text" in frame) {
          textRef.current += frame.text;
          setPending({ text: textRef.current, active: true });
          return;
        }
        if ("error" in frame) {
          // Keep whatever streamed: a truncated answer the user can read beats
          // an empty box, and the status marks it as incomplete.
          setError({ kind: "server", message: frame.error });
          return;
        }
        // The turn ends exactly here, so commit here. Nothing needs to be
        // carried past the read loop.
        commitPending(frame.done);
      };

      try {
        await readChatFrames(res.body, onFrame, controller.signal);
      } catch {
        setError((prev) => prev ?? { kind: "network" });
      }

      if (controller.signal.aborted) return; // `stop` already committed
      // A stream that ended without a `done` frame is a dropped connection, not
      // a finished answer: keep what arrived and mark it, so the next turn's
      // window skips it. Unconditional because `commitPending` is idempotent —
      // when the `done` frame already committed, the buffer is empty and this
      // call appends nothing.
      commitPending("error");
    },
    [currentId, commitPending],
  );

  return { conversationId: currentId, messages, pending, error, send, stop };
}

/**
 * Learn the thread's id on its first turn, and put it in the address bar.
 *
 * `replaceState` rather than a navigation: the transcript is already on screen
 * and re-rendering the page would throw away the answer currently streaming into
 * it. The point is only that a reload lands back on this thread.
 */
function adoptConversation(id: string, current: string | null, setId: (id: string) => void): void {
  if (current === id) return;
  setId(id);
  if (current === null && typeof history !== "undefined") {
    history.replaceState(null, "", `/ai-chat/${id}`);
  }
}

/**
 * The literal the route sends when the thread is gone or was never the
 * caller's. Matched rather than assumed, because the same 404 status also
 * carries "Car not found" — a stale selected-car cookie, which is a different
 * problem with a different fix, and telling the user their thread vanished
 * sends them to recover the wrong thing.
 */
const CONVERSATION_MISSING = "Conversation not found";

function errorForResponse(status: number, message: string | undefined): ChatError {
  if (status === 429) return { kind: "rate_limited" };
  if (status === 404 && message === CONVERSATION_MISSING) return { kind: "conversation_not_found" };
  return { kind: "server", message: message ?? `Request failed (${status.toString()})` };
}
