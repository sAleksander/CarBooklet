import { useState } from "react";
import { useTranslation, I18nextProvider } from "react-i18next";
import { Trash2 } from "lucide-react";
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

interface Props {
  conversationId: string;
  /** Used for the icon's accessible name, so a list of rows is distinguishable. */
  title: string;
  lang: Locale;
}

export function DeleteConversationButton({ conversationId, title, lang }: Props) {
  const [i18n] = useState(() => createClientI18n(lang));
  return (
    <I18nextProvider i18n={i18n}>
      <DeleteConversationButtonContent conversationId={conversationId} title={title} lang={lang} />
    </I18nextProvider>
  );
}

function DeleteConversationButtonContent({ conversationId, title }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setIsDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/conversations/${conversationId}`, { method: "DELETE" });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? t("common.anErrorOccurred"));
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
    <>
      <button
        type="button"
        // The row is a link; a nested button would submit the navigation too.
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={`${t("common.delete")} — ${title}`}
        className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
      >
        <Trash2 className="size-4" />
      </button>

      <AlertDialog open={open}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("aiChat.deleteConversation")}</AlertDialogTitle>
            <AlertDialogDescription>{t("aiChat.deleteConversationDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setOpen(false);
              }}
              disabled={isDeleting}
            >
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={isDeleting}>
              {isDeleting ? t("aiChat.deleting") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
