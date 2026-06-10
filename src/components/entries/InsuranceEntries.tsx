import { useState } from "react";
import type { InsuranceEntry } from "@/types";
import { InsuranceEntryForm } from "./InsuranceEntryForm";
import { InsuranceEntryList } from "./InsuranceEntryList";

interface InsuranceEntriesProps {
  initialEntries: InsuranceEntry[];
  carId: string;
}

export function InsuranceEntries({ initialEntries, carId }: InsuranceEntriesProps) {
  const [entries, setEntries] = useState<InsuranceEntry[]>(initialEntries);
  const [formKey, setFormKey] = useState(0);

  function handleSuccess(entry: InsuranceEntry) {
    setEntries((prev) => [entry, ...prev]);
    setFormKey((k) => k + 1);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-4 text-lg font-semibold text-white">Log insurance</h2>
        <InsuranceEntryForm key={formKey} carId={carId} onSuccess={handleSuccess} />
      </div>
      <div>
        <h2 className="mb-4 text-lg font-semibold text-white">History</h2>
        <InsuranceEntryList entries={entries} />
      </div>
    </div>
  );
}
