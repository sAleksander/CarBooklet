import type { OilChangeEntry } from "@/types";

interface OilChangeEntryListProps {
  entries: OilChangeEntry[];
}

export function OilChangeEntryList({ entries }: OilChangeEntryListProps) {
  if (entries.length === 0) {
    return <p className="text-muted-foreground text-sm">No oil change entries yet. Log your first one above.</p>;
  }

  return (
    <ul className="space-y-3">
      {entries.map((entry) => (
        <li key={entry.id} className="rounded-lg border border-white/10 bg-white/5 p-4 text-white">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-semibold">{new Date(entry.conducted_at).toLocaleDateString()}</span>
            {entry.mileage !== null && (
              <span className="text-muted-foreground text-xs">Mileage: {entry.mileage.toLocaleString()} km</span>
            )}
          </div>
          {entry.oil_details && (
            <p className="text-muted-foreground text-xs">
              <span className="font-medium">Details:</span> {entry.oil_details}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
