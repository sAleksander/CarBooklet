import { useState } from "react";
import { useTranslation, I18nextProvider } from "react-i18next";
import type { RepairEntry, OilChangeEntry, InspectionEntry, InsuranceEntry } from "@/types";
import { RepairEntries } from "./RepairEntries";
import { OilChangeEntries } from "./OilChangeEntries";
import { InspectionEntries } from "./InspectionEntries";
import { InsuranceEntries } from "./InsuranceEntries";
import { createClientI18n } from "@/i18n/client";
import type { Locale } from "@/i18n/config";

type Tab = "repairs" | "oil_change" | "inspection" | "insurance";

interface EntriesTabsProps {
  initialRepairEntries: RepairEntry[];
  initialOilChangeEntries: OilChangeEntry[];
  initialInspectionEntries: InspectionEntry[];
  initialInsuranceEntries: InsuranceEntry[];
  carId: string;
  lang: Locale;
}

interface ContentProps {
  initialRepairEntries: RepairEntry[];
  initialOilChangeEntries: OilChangeEntry[];
  initialInspectionEntries: InspectionEntry[];
  initialInsuranceEntries: InsuranceEntry[];
  carId: string;
}

function EntriesTabsContent({
  initialRepairEntries,
  initialOilChangeEntries,
  initialInspectionEntries,
  initialInsuranceEntries,
  carId,
}: ContentProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("repairs");

  const TABS: { id: Tab; label: string }[] = [
    { id: "repairs", label: t("entries.tabs.repairs") },
    { id: "oil_change", label: t("entries.tabs.oilChanges") },
    { id: "inspection", label: t("entries.tabs.inspections") },
    { id: "insurance", label: t("entries.tabs.insurance") },
  ];

  return (
    <div>
      <div className="mb-6 flex gap-1 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
            }}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "border-b-2 border-accent-ink text-foreground"
                : "text-muted-foreground hover:text-foreground"
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

export function EntriesTabs({
  initialRepairEntries,
  initialOilChangeEntries,
  initialInspectionEntries,
  initialInsuranceEntries,
  carId,
  lang,
}: EntriesTabsProps) {
  const [i18n] = useState(() => createClientI18n(lang));
  return (
    <I18nextProvider i18n={i18n}>
      <EntriesTabsContent
        initialRepairEntries={initialRepairEntries}
        initialOilChangeEntries={initialOilChangeEntries}
        initialInspectionEntries={initialInspectionEntries}
        initialInsuranceEntries={initialInsuranceEntries}
        carId={carId}
      />
    </I18nextProvider>
  );
}
