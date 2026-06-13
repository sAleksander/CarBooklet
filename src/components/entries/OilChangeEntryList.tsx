import { useTranslation } from "react-i18next";
import type { OilChangeEntry } from "@/types";

interface OilChangeEntryListProps {
  entries: OilChangeEntry[];
}

export function OilChangeEntryList({ entries }: OilChangeEntryListProps) {
  const { t } = useTranslation();

  if (entries.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("entries.empty.oilChange")}</p>;
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
            {entry.oil_details && (
              <p className="text-muted-foreground text-xs">
                <span className="font-medium">{t("entries.detail.detailsLabel")}:</span> {entry.oil_details}
              </p>
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}
