import { useTranslation } from "react-i18next";
import type { InspectionEntry } from "@/types";
import { entryRow, statusText, toneForResult } from "@/lib/theme";

interface InspectionEntryListProps {
  entries: InspectionEntry[];
}

export function InspectionEntryList({ entries }: InspectionEntryListProps) {
  const { t } = useTranslation();

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("entries.empty.inspection")}</p>;
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
            {entry.result && (
              <p className="text-sm">
                <span className="font-medium text-muted-foreground">{t("entries.detail.result")}:</span>{" "}
                <span className={statusText({ tone: toneForResult(entry.result) })}>
                  {entry.result === "Passed" ? t("entries.results.passed") : t("entries.results.failed")}
                </span>
              </p>
            )}
            {entry.next_inspection_date && (
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="font-medium">{t("entries.detail.nextDueLabel")}:</span>{" "}
                {new Date(entry.next_inspection_date).toLocaleDateString()}
              </p>
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}
