import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { InspectionEntry, InspectionEntryFormData } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface InspectionEntryFormProps {
  carId: string;
  onSuccess: (entry: InspectionEntry) => void;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface InspectionFormState {
  conducted_at: string;
  mileage: number | null;
  result: "Passed" | "Failed" | null;
  next_inspection_date: string;
}

function emptyForm(): InspectionFormState {
  return { conducted_at: today(), mileage: null, result: null, next_inspection_date: "" };
}

export function InspectionEntryForm({ carId, onSuccess }: InspectionEntryFormProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<InspectionFormState>(emptyForm);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  function setField<K extends keyof InspectionFormState>(key: K, value: InspectionFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    setApiError(null);
    setIsLoading(true);
    try {
      const body: InspectionEntryFormData & { car_id: string } = {
        car_id: carId,
        conducted_at: form.conducted_at,
        mileage: form.mileage,
        result: form.result,
        next_inspection_date: form.next_inspection_date !== "" ? form.next_inspection_date : null,
      };
      const res = await fetch("/api/entries/inspection", {
        method: "POST",
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
          <Label htmlFor="insp_conducted_at">{t("entries.fields.date")}</Label>
          <Input
            id="insp_conducted_at"
            type="date"
            value={form.conducted_at}
            onChange={(e) => {
              setField("conducted_at", e.target.value);
            }}
            disabled={isLoading}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="insp_mileage">{t("entries.fields.mileage")}</Label>
          <Input
            id="insp_mileage"
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
          <Label htmlFor="insp_result">{t("entries.fields.result")}</Label>
          <Select
            value={form.result ?? "none"}
            onValueChange={(v) => {
              setField("result", v === "none" ? null : (v as "Passed" | "Failed"));
            }}
            disabled={isLoading}
          >
            <SelectTrigger id="insp_result">
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
          <Label htmlFor="insp_next_date">{t("entries.fields.nextInspectionDate")}</Label>
          <Input
            id="insp_next_date"
            type="date"
            value={form.next_inspection_date}
            onChange={(e) => {
              setField("next_inspection_date", e.target.value);
            }}
            disabled={isLoading}
          />
        </div>
      </div>
      {apiError && <p className="text-sm text-destructive">{apiError}</p>}
      <Button type="submit" disabled={isLoading}>
        {isLoading ? t("common.saving") : t("entries.actions.logInspection")}
      </Button>
    </form>
  );
}
