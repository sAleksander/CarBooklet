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

  // The accessible progress signal, and the only one a screen reader gets.
  //
  // It announces *transitions*, never content. The obvious implementation —
  // aria-live on the streaming text — would re-announce the whole answer on
  // every token delta, because `Markdown` re-parses the buffer each time. That
  // is hundreds of interruptions per reply, which is worse than silence.
  //
  // The region lives here rather than inside `StreamingText` for a reason that
  // is easy to miss: `StreamingText` is conditionally rendered (below), so it is
  // *removed from the accessibility tree at the exact moment* the turn ends. A
  // live region cannot announce its own unmounting. This one is mounted for the
  // life of the island and merely changes its text.
  //
  // Derived during render rather than in an effect. React documents this as the
  // way to adjust state when something changes, an effect would announce a frame
  // late after a second render pass, and both `react-hooks/set-state-in-effect`
  // and react-compiler's no-ref-reads-in-render rule close the other routes.
  const [announcement, setAnnouncement] = useState("");
  const [announcedFor, setAnnouncedFor] = useState(pending.active);

  if (pending.active !== announcedFor) {
    setAnnouncedFor(pending.active);
    setAnnouncement(pending.active ? t("aiChat.responding") : terminalAnnouncement(messages, error, t));
  }

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

      {/* Named, because `getByRole("status")` would otherwise be ambiguous with
          the error line below — in Playwright's strict mode and for a screen
          reader alike. */}
      <p className="sr-only" role="status" aria-live="polite" aria-label={t("aiChat.progress")}>
        {announcement}
      </p>

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
 * What to announce when a turn ends.
 *
 * The hook has no terminal-reason of its own: `stop()` and a normal `done`
 * frame both land in `commitPending` and leave an identical `pending`. The only
 * surviving discriminator is the status on the message it appended — and when
 * the user aborts before the first token it appends nothing at all, because
 * `commitPending` returns early on an empty buffer. So "the transcript does not
 * end in an assistant turn" is itself the interrupted case, and an announcer
 * keyed on `messages.length` would go silent exactly there.
 *
 * `error` is checked first, and that ordering is the whole point. A non-OK
 * response or a fetch rejection clears `pending` *without* calling
 * `commitPending` (useConversation.ts:129-153), so the transcript also ends on
 * the user's own turn — indistinguishable from an abort by shape alone. Reading
 * the status only would tell a screen-reader user they stopped an answer the
 * server actually dropped, and contradict the error line beside this region.
 * `send` clears `error` before every request (useConversation.ts:110), so a
 * stale failure cannot leak into a later success.
 */
function terminalAnnouncement(messages: ChatMessage[], error: ChatError | null, t: (key: string) => string): string {
  if (error) return errorMessage(error, t);
  const last = messages.at(-1);
  if (last?.role !== "assistant") return t("aiChat.interrupted");
  switch (last.status) {
    case "complete":
      return t("aiChat.responseComplete");
    case "aborted":
      return t("aiChat.interrupted");
    case "error":
      return t("aiChat.failed");
  }
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
