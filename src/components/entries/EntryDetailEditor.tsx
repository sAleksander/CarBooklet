import { useState } from "react";
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
  children: React.ReactNode;
}

export function EntryDetailEditor({ entry, children }: EntryDetailEditorProps) {
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
        setDeleteError(json.error ?? "An error occurred");
      }
    } catch {
      setDeleteError("Network error. Please try again.");
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
          <hr className="mt-6 border-white/10" />
          <div className="mt-4 flex gap-2">
            <Button
              onClick={() => {
                setEditing(true);
              }}
            >
              Edit
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmOpen(true);
              }}
            >
              Delete
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
            <AlertDialogTitle>Delete entry</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p className="text-destructive text-sm">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isDeleting}
              onClick={() => {
                setConfirmOpen(false);
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
