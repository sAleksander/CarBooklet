import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const [form, setForm] = useState<InspectionEditFormState>({
    conducted_at: entry.conducted_at,
    mileage: entry.mileage,
    result: entry.result,
    next_inspection_date: entry.next_inspection_date ?? "",
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof InspectionEditFormState, string>>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  function setField<K extends keyof InspectionEditFormState>(key: K, value: InspectionEditFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function validate(): boolean {
    const errors: Partial<Record<keyof InspectionEditFormState, string>> = {};
    if (!form.conducted_at) errors.conducted_at = t("entries.validation.dateRequired");
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!validate()) return;
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
        setApiError(json.error ?? t("common.anErrorOccurred"));
        return;
      }
      if (json.entry) onSuccess(json.entry);
    } catch {
      setApiError(t("common.networkError"));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="edit_insp_conducted_at">{t("entries.fields.date")}</Label>
          <Input
            id="edit_insp_conducted_at"
            type="date"
            value={form.conducted_at}
            onChange={(e) => {
              setField("conducted_at", e.target.value);
            }}
            disabled={isLoading}
          />
          {fieldErrors.conducted_at && <p className="text-destructive text-sm">{fieldErrors.conducted_at}</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="edit_insp_mileage">{t("entries.fields.mileage")}</Label>
          <Input
            id="edit_insp_mileage"
            type="number"
            min="0"
            value={form.mileage ?? ""}
            onChange={(e) => {
              setField("mileage", e.target.value ? parseInt(e.target.value, 10) : null);
            }}
            placeholder={t("entries.placeholders.mileage")}
            disabled={isLoading}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="edit_insp_result">{t("entries.fields.result")}</Label>
          <Select
            value={form.result ?? "none"}
            onValueChange={(v) => {
              setField("result", v === "none" ? null : (v as "Passed" | "Failed"));
            }}
            disabled={isLoading}
          >
            <SelectTrigger id="edit_insp_result">
              <SelectValue placeholder={t("entries.placeholders.selectResult")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("entries.results.notRecorded")}</SelectItem>
              <SelectItem value="Passed">{t("entries.results.passed")}</SelectItem>
              <SelectItem value="Failed">{t("entries.results.failed")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="edit_insp_next_date">{t("entries.fields.nextInspectionDate")}</Label>
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
          {isLoading ? t("common.saving") : t("common.save")}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isLoading}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
