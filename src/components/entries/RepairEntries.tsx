import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { RepairEntry } from "@/types";
import { RepairEntryForm } from "./RepairEntryForm";
import { RepairEntryList } from "./RepairEntryList";

interface RepairEntriesProps {
  initialEntries: RepairEntry[];
  carId: string;
}

export function RepairEntries({ initialEntries, carId }: RepairEntriesProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<RepairEntry[]>(initialEntries);
  const [formKey, setFormKey] = useState(0);

  function handleSuccess(entry: RepairEntry) {
    setEntries((prev) => [entry, ...prev]);
    setFormKey((k) => k + 1);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-4 text-lg font-semibold text-foreground">{t("entries.log.repair")}</h2>
        <RepairEntryForm key={formKey} carId={carId} onSuccess={handleSuccess} />
      </div>
      <div>
        <h2 className="mb-4 text-lg font-semibold text-foreground">{t("entries.history")}</h2>
        <RepairEntryList entries={entries} />
      </div>
    </div>
  );
}
