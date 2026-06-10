import type { RepairEntry } from "@/types";

interface RepairEntryListProps {
  entries: RepairEntry[];
}

export function RepairEntryList({ entries }: RepairEntryListProps) {
  if (entries.length === 0) {
    return <p className="text-muted-foreground text-sm">No repair entries yet. Log your first one above.</p>;
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
                <span className="text-muted-foreground text-xs">Mileage: {entry.mileage.toLocaleString()} km</span>
              )}
            </div>
            <p className="text-sm">{entry.description}</p>
            {entry.cause && (
              <p className="text-muted-foreground mt-1 text-xs">
                <span className="font-medium">Cause:</span> {entry.cause}
              </p>
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}
