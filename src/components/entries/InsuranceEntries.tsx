import { useState } from "react";
import type { InsuranceEntry } from "@/types";
import { InsuranceEntryForm } from "./InsuranceEntryForm";
import { InsuranceEntryList } from "./InsuranceEntryList";
import { InsuranceEntryEditForm } from "./InsuranceEntryEditForm";
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

interface InsuranceEntriesProps {
  initialEntries: InsuranceEntry[];
  carId: string;
}

export function InsuranceEntries({ initialEntries, carId }: InsuranceEntriesProps) {
  const [entries, setEntries] = useState<InsuranceEntry[]>(initialEntries);
  const [formKey, setFormKey] = useState(0);
  const [editingEntry, setEditingEntry] = useState<InsuranceEntry | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<InsuranceEntry | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleSuccess(entry: InsuranceEntry) {
    setEntries((prev) => [entry, ...prev]);
    setFormKey((k) => k + 1);
  }

  async function handleDelete() {
    if (!deletingEntry) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/entries/insurance?id=${deletingEntry.id}`, { method: "DELETE" });
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
        <h2 className="mb-4 text-lg font-semibold text-white">Log insurance</h2>
        <InsuranceEntryForm key={formKey} carId={carId} onSuccess={handleSuccess} />
      </div>
      <div>
        <h2 className="mb-4 text-lg font-semibold text-white">History</h2>
        <InsuranceEntryList
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
            <DialogTitle>Edit insurance entry</DialogTitle>
          </DialogHeader>
          {editingEntry && (
            <InsuranceEntryEditForm
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
              Delete insurance entry from{" "}
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
