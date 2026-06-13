import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { OilChangeEntry, OilChangeEntryFormData } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface OilChangeEntryFormProps {
  carId: string;
  onSuccess: (entry: OilChangeEntry) => void;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(): OilChangeEntryFormData {
  return { conducted_at: today(), oil_details: "", mileage: null };
}

export function OilChangeEntryForm({ carId, onSuccess }: OilChangeEntryFormProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<OilChangeEntryFormData>(emptyForm);
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          car_id: carId,
          conducted_at: form.conducted_at,
          oil_details: form.oil_details !== "" ? form.oil_details : null,
          mileage: form.mileage,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { entry?: OilChangeEntry; error?: string };
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
          <Label htmlFor="oc_conducted_at">{t("entries.fields.date")}</Label>
          <Input
            id="oc_conducted_at"
            type="date"
            value={form.conducted_at}
            onChange={(e) => {
              setField("conducted_at", e.target.value);
            }}
            disabled={isLoading}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="oc_mileage">{t("entries.fields.mileage")}</Label>
          <Input
            id="oc_mileage"
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
      <div className="space-y-1">
        <Label htmlFor="oc_oil_details">{t("entries.fields.oilDetails")}</Label>
        <Textarea
          id="oc_oil_details"
          value={form.oil_details ?? ""}
          onChange={(e) => {
            setField("oil_details", e.target.value);
          }}
          placeholder={t("entries.placeholders.oilDetails")}
          rows={2}
          disabled={isLoading}
        />
      </div>
      {apiError && <p className="text-destructive text-sm">{apiError}</p>}
      <Button type="submit" disabled={isLoading}>
        {isLoading ? t("common.saving") : t("entries.actions.logOilChange")}
      </Button>
    </form>
  );
}
