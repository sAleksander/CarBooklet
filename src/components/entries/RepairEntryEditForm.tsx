import { useState } from "react";
import type { RepairEntry, RepairEntryFormData } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface RepairEntryEditFormProps {
  entry: RepairEntry;
  onSuccess: (entry: RepairEntry) => void;
  onCancel: () => void;
}

export function RepairEntryEditForm({ entry, onSuccess, onCancel }: RepairEntryEditFormProps) {
  const [form, setForm] = useState<RepairEntryFormData>({
    conducted_at: entry.conducted_at,
    description: entry.description,
    cause: entry.cause ?? "",
    mileage: entry.mileage,
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof RepairEntryFormData, string>>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  function setField<K extends keyof RepairEntryFormData>(key: K, value: RepairEntryFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function validate(): boolean {
    const errors: Partial<Record<keyof RepairEntryFormData, string>> = {};
    if (!form.description.trim()) errors.description = "Description is required";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!validate()) return;
    setApiError(null);
    setIsLoading(true);
    try {
      const res = await fetch("/api/entries/repair", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: entry.id,
          conducted_at: form.conducted_at,
          description: form.description,
          cause: form.cause !== "" ? (form.cause ?? null) : null,
          mileage: form.mileage,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { entry?: RepairEntry; error?: string };
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
          <Label htmlFor="edit_conducted_at">Date</Label>
          <Input
            id="edit_conducted_at"
            type="date"
            value={form.conducted_at}
            onChange={(e) => {
              setField("conducted_at", e.target.value);
            }}
            disabled={isLoading}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="edit_mileage">Mileage (km, optional)</Label>
          <Input
            id="edit_mileage"
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
        <Label htmlFor="edit_description">Description</Label>
        <Textarea
          id="edit_description"
          value={form.description}
          onChange={(e) => {
            setField("description", e.target.value);
          }}
          placeholder="What was repaired or replaced?"
          rows={3}
          disabled={isLoading}
        />
        {fieldErrors.description && <p className="text-destructive text-sm">{fieldErrors.description}</p>}
      </div>
      <div className="space-y-1">
        <Label htmlFor="edit_cause">Cause (optional)</Label>
        <Textarea
          id="edit_cause"
          value={form.cause ?? ""}
          onChange={(e) => {
            setField("cause", e.target.value);
          }}
          placeholder="What led to this repair?"
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
