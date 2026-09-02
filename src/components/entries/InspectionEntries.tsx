import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { InspectionEntry } from "@/types";
import { InspectionEntryForm } from "./InspectionEntryForm";
import { InspectionEntryList } from "./InspectionEntryList";

interface InspectionEntriesProps {
  initialEntries: InspectionEntry[];
  carId: string;
}

export function InspectionEntries({ initialEntries, carId }: InspectionEntriesProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<InspectionEntry[]>(initialEntries);
  const [formKey, setFormKey] = useState(0);

  function handleSuccess(entry: InspectionEntry) {
    setEntries((prev) => [entry, ...prev]);
    setFormKey((k) => k + 1);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-4 text-lg font-semibold text-foreground">{t("entries.log.inspection")}</h2>
        <InspectionEntryForm key={formKey} carId={carId} onSuccess={handleSuccess} />
      </div>
      <div>
        <h2 className="mb-4 text-lg font-semibold text-foreground">{t("entries.history")}</h2>
        <InspectionEntryList entries={entries} />
      </div>
    </div>
  );
}
