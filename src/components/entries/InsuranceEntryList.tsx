import { useTranslation } from "react-i18next";
import type { InsuranceEntry } from "@/types";

interface InsuranceEntryListProps {
  entries: InsuranceEntry[];
}

export function InsuranceEntryList({ entries }: InsuranceEntryListProps) {
  const { t } = useTranslation();

  if (entries.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("entries.empty.insurance")}</p>;
  }

  return (
    <ul className="space-y-3">
      {entries.map((entry) => (
        <li key={entry.id}>
          <a
            href={`/entries/${entry.entry_type}/${entry.id}`}
            className="block rounded-lg border border-white/10 bg-white/5 p-4 text-white transition-colors hover:bg-white/10"
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-semibold">{new Date(entry.conducted_at).toLocaleDateString()}</span>
              {entry.mileage !== null && (
                <span className="text-muted-foreground text-xs">
                  {t("common.mileageKm", { value: entry.mileage.toLocaleString() })}
                </span>
              )}
            </div>
            {entry.insurer && (
              <p className="text-sm">
                <span className="text-muted-foreground font-medium">{t("entries.detail.insurer")}:</span>{" "}
                {entry.insurer}
              </p>
            )}
            {entry.policy_start_date && (
              <p className="text-muted-foreground mt-1 text-xs">
                <span className="font-medium">{t("entries.detail.policyFrom")}:</span>{" "}
                {new Date(entry.policy_start_date).toLocaleDateString()}
              </p>
            )}
            <p className="text-muted-foreground mt-1 text-xs">
              <span className="font-medium">{t("entries.detail.renewalLabel")}:</span>{" "}
              {new Date(entry.renewal_date).toLocaleDateString()}
            </p>
          </a>
        </li>
      ))}
    </ul>
  );
}
