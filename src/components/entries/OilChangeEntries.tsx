import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { OilChangeEntry } from "@/types";
import { OilChangeEntryForm } from "./OilChangeEntryForm";
import { OilChangeEntryList } from "./OilChangeEntryList";

interface OilChangeEntriesProps {
  initialEntries: OilChangeEntry[];
  carId: string;
}

export function OilChangeEntries({ initialEntries, carId }: OilChangeEntriesProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<OilChangeEntry[]>(initialEntries);
  const [formKey, setFormKey] = useState(0);

  function handleSuccess(entry: OilChangeEntry) {
    setEntries((prev) => [entry, ...prev]);
    setFormKey((k) => k + 1);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-4 text-lg font-semibold text-white">{t("entries.log.oilChange")}</h2>
        <OilChangeEntryForm key={formKey} carId={carId} onSuccess={handleSuccess} />
      </div>
      <div>
        <h2 className="mb-4 text-lg font-semibold text-white">{t("entries.history")}</h2>
        <OilChangeEntryList entries={entries} />
      </div>
    </div>
  );
}
