import { useState } from "react";
import type { InspectionEntry, InspectionEntryFormData } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface InspectionEntryEditFormProps {
  entry: InspectionEntry;
  onSuccess: (entry: InspectionEntry) => void;
  onCancel: () => void;
}

interface InspectionEditFormState {
  conducted_at: string;
  mileage: number | null;
  result: "Passed" | "Failed" | null;
  next_inspection_date: string;
}

export function InspectionEntryEditForm({ entry, onSuccess, onCancel }: InspectionEntryEditFormProps) {
  const [form, setForm] = useState<InspectionEditFormState>({
    conducted_at: entry.conducted_at,
    mileage: entry.mileage,
    result: entry.result,
    next_inspection_date: entry.next_inspection_date ?? "",
  });
  const [apiError, setApiError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  function setField<K extends keyof InspectionEditFormState>(key: K, value: InspectionEditFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setApiError(null);
    setIsLoading(true);
    try {
      const body: InspectionEntryFormData & { id: string } = {
        id: entry.id,
        conducted_at: form.conducted_at,
        mileage: form.mileage,
        result: form.result,
        next_inspection_date: form.next_inspection_date !== "" ? form.next_inspection_date : null,
      };
      const res = await fetch("/api/entries/inspection", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { entry?: InspectionEntry; error?: string };
      if (!res.ok) {
        setApiError(json.error ?? "An error occurred");
        return;
      }
      if (json.entry) onSuccess(json.entry);
    } catch {
      setApiError("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="edit_insp_conducted_at">Date</Label>
          <Input
            id="edit_insp_conducted_at"
            type="date"
            value={form.conducted_at}
            onChange={(e) => {
              setField("conducted_at", e.target.value);
            }}
            disabled={isLoading}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="edit_insp_mileage">Mileage (km, optional)</Label>
          <Input
            id="edit_insp_mileage"
            type="number"
            min="0"
            value={form.mileage ?? ""}
            onChange={(e) => {
              setField("mileage", e.target.value ? parseInt(e.target.value, 10) : null);
            }}
            placeholder="e.g. 85000"
            disabled={isLoading}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="edit_insp_result">Result (optional)</Label>
          <Select
            value={form.result ?? "none"}
            onValueChange={(v) => {
              setField("result", v === "none" ? null : (v as "Passed" | "Failed"));
            }}
            disabled={isLoading}
          >
            <SelectTrigger id="edit_insp_result">
              <SelectValue placeholder="Select result" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not recorded</SelectItem>
              <SelectItem value="Passed">Passed</SelectItem>
              <SelectItem value="Failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="edit_insp_next_date">Next inspection date (optional)</Label>
          <Input
            id="edit_insp_next_date"
            type="date"
            value={form.next_inspection_date}
            onChange={(e) => {
              setField("next_inspection_date", e.target.value);
            }}
            disabled={isLoading}
          />
        </div>
      </div>
      {apiError && <p className="text-destructive text-sm">{apiError}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Saving…" : "Save changes"}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
