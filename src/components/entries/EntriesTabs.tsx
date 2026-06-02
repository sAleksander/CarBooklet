import { useState } from "react";
import type { RepairEntry, OilChangeEntry, InspectionEntry, InsuranceEntry } from "@/types";
import { RepairEntries } from "./RepairEntries";
import { OilChangeEntries } from "./OilChangeEntries";
import { InspectionEntries } from "./InspectionEntries";
import { InsuranceEntries } from "./InsuranceEntries";

type Tab = "repairs" | "oil_change" | "inspection" | "insurance";

const TABS: { id: Tab; label: string }[] = [
  { id: "repairs", label: "Repairs" },
  { id: "oil_change", label: "Oil Changes" },
  { id: "inspection", label: "Inspections" },
  { id: "insurance", label: "Insurance" },
];

interface EntriesTabsProps {
  initialRepairEntries: RepairEntry[];
  initialOilChangeEntries: OilChangeEntry[];
  initialInspectionEntries: InspectionEntry[];
  initialInsuranceEntries: InsuranceEntry[];
  carId: string;
}

export function EntriesTabs({
  initialRepairEntries,
  initialOilChangeEntries,
  initialInspectionEntries,
  initialInsuranceEntries,
  carId,
}: EntriesTabsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("repairs");

  return (
    <div>
      <div className="mb-6 flex gap-1 border-b border-white/10">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
            }}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id ? "border-b-2 border-purple-400 text-white" : "text-white/60 hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "repairs" && <RepairEntries initialEntries={initialRepairEntries} carId={carId} />}
      {activeTab === "oil_change" && <OilChangeEntries initialEntries={initialOilChangeEntries} carId={carId} />}
      {activeTab === "inspection" && <InspectionEntries initialEntries={initialInspectionEntries} carId={carId} />}
      {activeTab === "insurance" && <InsuranceEntries initialEntries={initialInsuranceEntries} carId={carId} />}
    </div>
  );
}
