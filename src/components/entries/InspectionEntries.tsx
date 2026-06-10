import { useState } from "react";
import type { InspectionEntry } from "@/types";
import { InspectionEntryForm } from "./InspectionEntryForm";
import { InspectionEntryList } from "./InspectionEntryList";

interface InspectionEntriesProps {
  initialEntries: InspectionEntry[];
  carId: string;
}

export function InspectionEntries({ initialEntries, carId }: InspectionEntriesProps) {
  const [entries, setEntries] = useState<InspectionEntry[]>(initialEntries);
  const [formKey, setFormKey] = useState(0);

  function handleSuccess(entry: InspectionEntry) {
    setEntries((prev) => [entry, ...prev]);
    setFormKey((k) => k + 1);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-4 text-lg font-semibold text-white">Log an inspection</h2>
        <InspectionEntryForm key={formKey} carId={carId} onSuccess={handleSuccess} />
      </div>
      <div>
        <h2 className="mb-4 text-lg font-semibold text-white">History</h2>
        <InspectionEntryList entries={entries} />
      </div>
    </div>
  );
}
