import { useState } from "react";
import type { OilChangeEntry, OilChangeEntryFormData } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface OilChangeEntryEditFormProps {
  entry: OilChangeEntry;
  onSuccess: (entry: OilChangeEntry) => void;
  onCancel: () => void;
}

export function OilChangeEntryEditForm({ entry, onSuccess, onCancel }: OilChangeEntryEditFormProps) {
  const [form, setForm] = useState<OilChangeEntryFormData>({
    conducted_at: entry.conducted_at,
    oil_details: entry.oil_details ?? "",
    mileage: entry.mileage,
  });
  const [apiError, setApiError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  function setField<K extends keyof OilChangeEntryFormData>(key: K, value: OilChangeEntryFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setApiError(null);
    setIsLoading(true);
    try {
      const res = await fetch("/api/entries/oil-change", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: entry.id,
          conducted_at: form.conducted_at,
          oil_details: form.oil_details !== "" ? form.oil_details : null,
          mileage: form.mileage,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { entry?: OilChangeEntry; error?: string };
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
          <Label htmlFor="edit_oc_conducted_at">Date</Label>
          <Input
            id="edit_oc_conducted_at"
            type="date"
            value={form.conducted_at}
            onChange={(e) => {
              setField("conducted_at", e.target.value);
            }}
            disabled={isLoading}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="edit_oc_mileage">Mileage (km, optional)</Label>
          <Input
            id="edit_oc_mileage"
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
      <div className="space-y-1">
        <Label htmlFor="edit_oc_oil_details">Oil / filter details (optional)</Label>
        <Textarea
          id="edit_oc_oil_details"
          value={form.oil_details ?? ""}
          onChange={(e) => {
            setField("oil_details", e.target.value);
          }}
          placeholder="e.g. 5W-30 full synthetic, Mann filter"
          rows={2}
          disabled={isLoading}
        />
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
