import { useTranslation } from "react-i18next";
import { Markdown } from "./Markdown";

interface Props {
  /** Whatever has streamed in so far. Re-parsed as markdown on every delta. */
  text: string;
  /** Whether a request is still open. Drives the caret. */
  active: boolean;
}

/**
 * The reply currently arriving.
 *
 * Rendered as markdown mid-stream, which means it is re-parsed on every delta
 * and can flicker through half-formed syntax — a lone `*` reads as a bullet for
 * one frame. That is the cheaper of the two wrongs: the alternative, plain text
 * until the stream ends, reflows the entire answer at the moment the user has
 * just finished reading it.
 *
 * The caret is the only thing distinguishing "thinking" from "finished but
 * short", so it shows while the turn is active even before the first token.
 */
export function StreamingText({ text, active }: Props) {
  const { t } = useTranslation();

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t("aiChat.assistant")}</p>
      <div className="text-sm text-foreground">
        {text && <Markdown content={text} />}
        {active && <span className="inline-block animate-pulse">▋</span>}
      </div>
    </div>
  );
}
