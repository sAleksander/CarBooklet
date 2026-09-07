import { useTranslation } from "react-i18next";
import type { ChatMessage } from "@/types";
import { Markdown } from "./Markdown";
import { cn } from "@/lib/utils";

/**
 * One stored turn of the transcript.
 *
 * User content stays plain text with `whitespace-pre-wrap`: it is the user's own
 * typing, and running it through a markdown parser would silently reformat a
 * question that happened to start with a hyphen.
 *
 * A non-`complete` assistant message is dimmed and captioned rather than hidden.
 * The status is the same one `buildHistoryWindow` reads to drop the pair from
 * the next request's context, so the caption is telling the user something true
 * about what the model will and will not remember.
 */
export function MessageBubble({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();
  const isUser = message.role === "user";
  const interrupted = message.status !== "complete";

  return (
    <div className={cn("space-y-1", interrupted && "opacity-60")}>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {isUser ? t("aiChat.you") : t("aiChat.assistant")}
      </p>
      {isUser ? (
        <p className="text-sm break-words whitespace-pre-wrap text-foreground">{message.content}</p>
      ) : (
        <Markdown content={message.content} />
      )}
      {interrupted && <p className="text-xs text-muted-foreground italic">{t("aiChat.interrupted")}</p>}
    </div>
  );
}
