import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { RepairEntry, RepairEntryFormData } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { statusErrorKey } from "@/lib/http-error-copy";

interface RepairEntryFormProps {
  carId: string;
  onSuccess: (entry: RepairEntry) => void;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(): RepairEntryFormData {
  return { conducted_at: today(), description: "", cause: "", mileage: null };
}

export function RepairEntryForm({ carId, onSuccess }: RepairEntryFormProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<RepairEntryFormData>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof RepairEntryFormData, string>>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  function setField<K extends keyof RepairEntryFormData>(key: K, value: RepairEntryFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function validate(): boolean {
    const errors: Partial<Record<keyof RepairEntryFormData, string>> = {};
    if (!form.description.trim()) errors.description = t("entries.validation.descriptionRequired");
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          car_id: carId,
          conducted_at: form.conducted_at,
          description: form.description,
          cause: form.cause !== "" ? (form.cause ?? null) : null,
          mileage: form.mileage,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { entry?: RepairEntry };
      if (!res.ok) {
        setApiError(t(statusErrorKey(res.status)));
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
          <Label htmlFor="conducted_at">{t("entries.fields.date")}</Label>
          <Input
            id="conducted_at"
            type="date"
            value={form.conducted_at}
            onChange={(e) => {
              setField("conducted_at", e.target.value);
            }}
            disabled={isLoading}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="mileage">{t("entries.fields.mileage")}</Label>
          <Input
            id="mileage"
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
        <Label htmlFor="description">{t("entries.fields.description")}</Label>
        <Textarea
          id="description"
          value={form.description}
          onChange={(e) => {
            setField("description", e.target.value);
          }}
          placeholder={t("entries.placeholders.description")}
          rows={3}
          disabled={isLoading}
        />
        {fieldErrors.description && <p className="text-sm text-destructive">{fieldErrors.description}</p>}
      </div>
      <div className="space-y-1">
        <Label htmlFor="cause">{t("entries.fields.cause")}</Label>
        <Textarea
          id="cause"
          value={form.cause ?? ""}
          onChange={(e) => {
            setField("cause", e.target.value);
          }}
          placeholder={t("entries.placeholders.cause")}
          rows={2}
          disabled={isLoading}
        />
      </div>
      {apiError && <p className="text-sm text-destructive">{apiError}</p>}
      <Button type="submit" disabled={isLoading}>
        {isLoading ? t("common.saving") : t("entries.actions.logRepair")}
      </Button>
    </form>
  );
}
