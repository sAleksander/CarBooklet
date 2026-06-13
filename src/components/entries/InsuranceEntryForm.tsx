import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { InsuranceEntry, InsuranceEntryFormData } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface InsuranceEntryFormProps {
  carId: string;
  onSuccess: (entry: InsuranceEntry) => void;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface InsuranceFormState {
  conducted_at: string;
  mileage: number | null;
  insurer: string;
  policy_start_date: string;
  renewal_date: string;
}

function emptyForm(): InsuranceFormState {
  return { conducted_at: today(), mileage: null, insurer: "", policy_start_date: "", renewal_date: "" };
}

export function InsuranceEntryForm({ carId, onSuccess }: InsuranceEntryFormProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<InsuranceFormState>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof InsuranceFormState, string>>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  function setField<K extends keyof InsuranceFormState>(key: K, value: InsuranceFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function validate(): boolean {
    const errors: Partial<Record<keyof InsuranceFormState, string>> = {};
    if (!form.renewal_date) errors.renewal_date = t("entries.validation.renewalDateRequired");
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!validate()) return;
    setApiError(null);
    setIsLoading(true);
    try {
      const body: InsuranceEntryFormData & { car_id: string } = {
        car_id: carId,
        conducted_at: form.conducted_at,
        mileage: form.mileage,
        insurer: form.insurer !== "" ? form.insurer : null,
        policy_start_date: form.policy_start_date !== "" ? form.policy_start_date : null,
        renewal_date: form.renewal_date,
      };
      const res = await fetch("/api/entries/insurance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { entry?: InsuranceEntry; error?: string };
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
          <Label htmlFor="ins_conducted_at">{t("entries.fields.dateLogged")}</Label>
          <Input
            id="ins_conducted_at"
            type="date"
            value={form.conducted_at}
            onChange={(e) => {
              setField("conducted_at", e.target.value);
            }}
            disabled={isLoading}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ins_mileage">{t("entries.fields.mileage")}</Label>
          <Input
            id="ins_mileage"
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
        <Label htmlFor="ins_insurer">{t("entries.fields.insurer")}</Label>
        <Input
          id="ins_insurer"
          type="text"
          value={form.insurer}
          onChange={(e) => {
            setField("insurer", e.target.value);
          }}
          placeholder={t("entries.placeholders.insurer")}
          disabled={isLoading}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="ins_policy_start">{t("entries.fields.policyStart")}</Label>
          <Input
            id="ins_policy_start"
            type="date"
            value={form.policy_start_date}
            onChange={(e) => {
              setField("policy_start_date", e.target.value);
            }}
            disabled={isLoading}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ins_renewal">{t("entries.fields.renewalDate")}</Label>
          <Input
            id="ins_renewal"
            type="date"
            value={form.renewal_date}
            onChange={(e) => {
              setField("renewal_date", e.target.value);
            }}
            disabled={isLoading}
          />
          {fieldErrors.renewal_date && <p className="text-destructive text-sm">{fieldErrors.renewal_date}</p>}
        </div>
      </div>
      {apiError && <p className="text-destructive text-sm">{apiError}</p>}
      <Button type="submit" disabled={isLoading}>
        {isLoading ? t("common.saving") : t("entries.actions.logInsurance")}
      </Button>
    </form>
  );
}
