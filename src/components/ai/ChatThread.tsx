import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation, I18nextProvider } from "react-i18next";
import { createClientI18n } from "@/i18n/client";
import type { Locale } from "@/i18n/config";
import type { ChatMessage } from "@/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useConversation, type ChatError } from "@/components/hooks/useConversation";
import { MessageBubble } from "./MessageBubble";
import { StreamingText } from "./StreamingText";

interface ChatThreadProps {
  lang: Locale;
  /** `null` starts a new thread; the hook adopts the server's id on the first turn. */
  conversationId: string | null;
  initialMessages: ChatMessage[];
}

export function ChatThread({ lang, conversationId, initialMessages }: ChatThreadProps) {
  const [i18n] = useState(() => createClientI18n(lang));
  return (
    <I18nextProvider i18n={i18n}>
      <ChatThreadContent lang={lang} conversationId={conversationId} initialMessages={initialMessages} />
    </I18nextProvider>
  );
}

/** How close to the bottom still counts as "at the bottom", in CSS pixels. */
const STICK_THRESHOLD_PX = 48;

function ChatThreadContent({ conversationId, initialMessages }: ChatThreadProps) {
  const { t } = useTranslation();
  const { messages, pending, error, send, stop } = useConversation({ conversationId, initialMessages });
  const [prompt, setPrompt] = useState("");

  const viewportRef = useRef<HTMLDivElement>(null);
  // A ref, not state: it is read inside an effect that must not re-run when it
  // changes, and re-rendering the transcript on every scroll event would fight
  // the stream for frames.
  const stickToBottom = useRef(true);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onScroll = () => {
      const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      stickToBottom.current = distance <= STICK_THRESHOLD_PX;
    };
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      viewport.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Follow the answer down, but only while the user is still at the bottom.
  // Scrolling up to re-read an earlier turn has to survive the next delta, or
  // the transcript yanks itself away mid-sentence.
  useEffect(() => {
    if (!stickToBottom.current) return;
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [messages, pending.text, pending.active]);

  const submit = useCallback(() => {
    const trimmed = prompt.trim();
    // The hook ignores a send while a turn is open; clearing the box anyway
    // would throw away what the user typed for no reason.
    if (!trimmed || pending.active) return;
    setPrompt("");
    // A new question is a return to the live end of the transcript, wherever
    // the user had scrolled to.
    stickToBottom.current = true;
    void send(trimmed);
  }, [prompt, pending.active, send]);

  const isEmpty = messages.length === 0 && !pending.active;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <ScrollArea viewportRef={viewportRef} className="min-h-48 flex-1">
        <div className="space-y-6 pr-3">
          {isEmpty && <p className="py-8 text-center text-sm text-muted-foreground">{t("aiChat.emptyState")}</p>}
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          {pending.active && <StreamingText text={pending.text} active />}
        </div>
      </ScrollArea>

      {error && (
        <p role="status" className="text-sm text-destructive">
          {errorMessage(error, t)}
        </p>
      )}

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Textarea
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
          }}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line. `isComposing` guards an
            // IME: pressing Enter to accept a candidate must not send the turn.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={t("aiChat.placeholder")}
          className="resize-none"
          rows={3}
          aria-label={t("aiChat.placeholder")}
        />
        {/* Never disabled while streaming — the composer stays typeable so the
            next question can be written while the current answer arrives. */}
        {pending.active ? (
          <Button type="button" variant="outline" onClick={stop}>
            {t("aiChat.stop")}
          </Button>
        ) : (
          <Button type="submit" disabled={!prompt.trim()}>
            {t("aiChat.ask")}
          </Button>
        )}
      </form>
    </div>
  );
}

/**
 * `ChatError.kind` decides the copy, never the server's own message.
 *
 * The API answers with fixed English literals ("AI service error"), which are
 * safe to show but are not translations. Rate-limited and not-found get their
 * own strings because the user's next move differs: wait, versus go back.
 */
function errorMessage(error: ChatError, t: (key: string) => string): string {
  switch (error.kind) {
    case "rate_limited":
      return t("aiChat.rateLimited");
    case "conversation_not_found":
      return t("aiChat.conversationNotFound");
    case "network":
      return t("common.networkError");
    case "server":
      return t("aiChat.failed");
  }
}
