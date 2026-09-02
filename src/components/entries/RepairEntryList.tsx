import { useTranslation } from "react-i18next";
import type { RepairEntry } from "@/types";
import { entryRow } from "@/lib/theme";

interface RepairEntryListProps {
  entries: RepairEntry[];
}

export function RepairEntryList({ entries }: RepairEntryListProps) {
  const { t } = useTranslation();

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("entries.empty.repair")}</p>;
  }

  return (
    <ul className="space-y-3">
      {entries.map((entry) => (
        <li key={entry.id}>
          <a href={`/entries/${entry.entry_type}/${entry.id}`} className={entryRow()}>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-semibold">{new Date(entry.conducted_at).toLocaleDateString()}</span>
              {entry.mileage !== null && (
                <span className="text-xs text-muted-foreground">
                  {t("common.mileageKm", { value: entry.mileage.toLocaleString() })}
                </span>
              )}
            </div>
            <p className="text-sm">{entry.description}</p>
            {entry.cause && (
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="font-medium">{t("entries.detail.cause")}:</span> {entry.cause}
              </p>
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}
