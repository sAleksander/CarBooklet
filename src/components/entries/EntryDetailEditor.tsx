import { useState } from "react";
import { useTranslation, I18nextProvider } from "react-i18next";
import { createClientI18n } from "@/i18n/client";
import type { Locale } from "@/i18n/config";
import type { Entry } from "@/types";
import { Button } from "@/components/ui/button";
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
import { RepairEntryEditForm } from "./RepairEntryEditForm";
import { OilChangeEntryEditForm } from "./OilChangeEntryEditForm";
import { InspectionEntryEditForm } from "./InspectionEntryEditForm";
import { InsuranceEntryEditForm } from "./InsuranceEntryEditForm";

const API_SLUG: Record<Entry["entry_type"], string> = {
  repair: "repair",
  oil_change: "oil-change",
  inspection: "inspection",
  insurance: "insurance",
};

interface EntryDetailEditorProps {
  entry: Entry;
  lang: Locale;
  children: React.ReactNode;
}

export function EntryDetailEditor({ entry, lang, children }: EntryDetailEditorProps) {
  const [i18n] = useState(() => createClientI18n(lang));
  return (
    <I18nextProvider i18n={i18n}>
      <EntryDetailEditorContent entry={entry} lang={lang}>
        {children}
      </EntryDetailEditorContent>
    </I18nextProvider>
  );
}

function EntryDetailEditorContent({ entry, children }: EntryDetailEditorProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/entries/${API_SLUG[entry.entry_type]}?id=${entry.id}`, {
        method: "DELETE",
      });
      if (res.status === 204) {
        window.location.href = "/entries";
      } else {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setDeleteError(json.error ?? t("common.anErrorOccurred"));
      }
    } catch {
      setDeleteError(t("common.networkError"));
    } finally {
      setIsDeleting(false);
    }
  }

  function renderEditForm() {
    switch (entry.entry_type) {
      case "repair":
        return (
          <RepairEntryEditForm
            entry={entry}
            onSuccess={() => {
              window.location.reload();
            }}
            onCancel={() => {
              setEditing(false);
            }}
          />
        );
      case "oil_change":
        return (
          <OilChangeEntryEditForm
            entry={entry}
            onSuccess={() => {
              window.location.reload();
            }}
            onCancel={() => {
              setEditing(false);
            }}
          />
        );
      case "inspection":
        return (
          <InspectionEntryEditForm
            entry={entry}
            onSuccess={() => {
              window.location.reload();
            }}
            onCancel={() => {
              setEditing(false);
            }}
          />
        );
      case "insurance":
        return (
          <InsuranceEntryEditForm
            entry={entry}
            onSuccess={() => {
              window.location.reload();
            }}
            onCancel={() => {
              setEditing(false);
            }}
          />
        );
    }
  }

  return (
    <>
      {!editing ? (
        <>
          {children}
          <hr className="mt-6 border-border" />
          <div className="mt-4 flex gap-2">
            <Button
              onClick={() => {
                setEditing(true);
              }}
            >
              {t("common.edit")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setDeleteError(null);
                setConfirmOpen(true);
              }}
            >
              {t("common.delete")}
            </Button>
          </div>
        </>
      ) : (
        renderEditForm()
      )}

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setConfirmOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("entries.detail.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("entries.detail.deleteDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isDeleting}
              onClick={() => {
                setConfirmOpen(false);
              }}
            >
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? t("common.deleting") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
