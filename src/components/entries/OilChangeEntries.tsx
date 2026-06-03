import { useState } from "react";
import type { OilChangeEntry } from "@/types";
import { OilChangeEntryForm } from "./OilChangeEntryForm";
import { OilChangeEntryList } from "./OilChangeEntryList";
import { OilChangeEntryEditForm } from "./OilChangeEntryEditForm";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

interface OilChangeEntriesProps {
  initialEntries: OilChangeEntry[];
  carId: string;
}

export function OilChangeEntries({ initialEntries, carId }: OilChangeEntriesProps) {
  const [entries, setEntries] = useState<OilChangeEntry[]>(initialEntries);
  const [formKey, setFormKey] = useState(0);
  const [editingEntry, setEditingEntry] = useState<OilChangeEntry | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<OilChangeEntry | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleSuccess(entry: OilChangeEntry) {
    setEntries((prev) => [entry, ...prev]);
    setFormKey((k) => k + 1);
  }

  async function handleDelete() {
    if (!deletingEntry) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/entries/oil-change?id=${deletingEntry.id}`, { method: "DELETE" });
      if (res.status === 204) {
        setEntries((prev) => prev.filter((e) => e.id !== deletingEntry.id));
        setDeletingEntry(null);
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-4 text-lg font-semibold text-white">Log an oil change</h2>
        <OilChangeEntryForm key={formKey} carId={carId} onSuccess={handleSuccess} />
      </div>
      <div>
        <h2 className="mb-4 text-lg font-semibold text-white">History</h2>
        <OilChangeEntryList
          entries={entries}
          onEdit={(e) => {
            setEditingEntry(e);
          }}
          onDelete={(e) => {
            setDeletingEntry(e);
          }}
        />
      </div>

      <Dialog
        open={editingEntry !== null}
        onOpenChange={(open) => {
          if (!open) setEditingEntry(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit oil change entry</DialogTitle>
          </DialogHeader>
          {editingEntry && (
            <OilChangeEntryEditForm
              entry={editingEntry}
              onSuccess={(updated) => {
                setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
                setEditingEntry(null);
              }}
              onCancel={() => {
                setEditingEntry(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deletingEntry !== null}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setDeletingEntry(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete entry</AlertDialogTitle>
            <AlertDialogDescription>
              Delete oil change entry from{" "}
              {deletingEntry ? new Date(deletingEntry.conducted_at).toLocaleDateString() : ""}? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && <p className="text-destructive text-sm">{deleteError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isDeleting}
              onClick={() => {
                setDeletingEntry(null);
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
    </div>
  );
}
