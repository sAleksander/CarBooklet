import { useState, useEffect } from "react";
import { useTranslation, I18nextProvider } from "react-i18next";
import { createClientI18n } from "@/i18n/client";
import type { Locale } from "@/i18n/config";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { statusErrorKey } from "@/lib/http-error-copy";

interface Target {
  id: string;
  title: string;
}

/**
 * One dialog for the whole thread list.
 *
 * The obvious shape — a delete island per row — costs one React root, one
 * `createClientI18n` instance (which carries every locale resource) and one
 * Radix dialog *per thread*, with nothing bounding the thread count. `CarList`
 * avoids that by owning a single shared dialog, and this is the same idea kept
 * compatible with a server-rendered list: the rows stay plain `.astro` markup
 * and this island picks their clicks up by delegation.
 *
 * Delegation rather than props because the triggers are not React's to render —
 * they are server output, and an island cannot receive children from Astro as
 * component props.
 */
export function DeleteConversationDialog({ lang }: { lang: Locale }) {
  const [i18n] = useState(() => createClientI18n(lang));
  return (
    <I18nextProvider i18n={i18n}>
      <DeleteConversationDialogContent />
    </I18nextProvider>
  );
}

function DeleteConversationDialogContent() {
  const { t } = useTranslation();
  const [target, setTarget] = useState<Target | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      const trigger = (event.target as Element | null)?.closest<HTMLElement>("[data-delete-conversation]");
      if (!trigger) return;
      // The row is a link wrapping most of its width; without this the click
      // navigates to the thread instead of opening the confirmation.
      event.preventDefault();
      const id = trigger.dataset.deleteConversation;
      if (!id) return;
      setError(null);
      setTarget({ id, title: trigger.dataset.conversationTitle ?? "" });
    }

    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
    };
  }, []);

  function close() {
    setTarget(null);
    // Cleared with the dialog: a failure from a previous attempt must not greet
    // the user the next time they open it on a different thread.
    setError(null);
  }

  async function handleConfirm() {
    if (!target) return;
    setIsDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/conversations/${target.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError(t(statusErrorKey(res.status)));
        setIsDeleting(false);
        return;
      }
      // A full navigation, not a client-side removal: the list is server-
      // rendered, and the deleted thread may be the one currently on screen.
      // `/ai-chat` then re-resolves which thread to land on.
      window.location.assign("/ai-chat");
    } catch {
      setError(t("common.networkError"));
      setIsDeleting(false);
    }
  }

  return (
    <AlertDialog open={target !== null}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("aiChat.deleteConversation")}</AlertDialogTitle>
          <AlertDialogDescription>{t("aiChat.deleteConversationDesc")}</AlertDialogDescription>
        </AlertDialogHeader>
        {/* Which thread, so a confirm dialog opened from a list of many is not
            a guess. Not a translated string — it is the user's own title. */}
        {target?.title && <p className="text-sm font-medium break-words text-foreground">{target.title}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={close} disabled={isDeleting}>
            {t("common.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={isDeleting}>
            {isDeleting ? t("aiChat.deleting") : t("common.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
