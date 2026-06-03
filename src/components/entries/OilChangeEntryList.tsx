import type { OilChangeEntry } from "@/types";
import { Button } from "@/components/ui/button";

interface OilChangeEntryListProps {
  entries: OilChangeEntry[];
  onEdit: (entry: OilChangeEntry) => void;
  onDelete: (entry: OilChangeEntry) => void;
}

export function OilChangeEntryList({ entries, onEdit, onDelete }: OilChangeEntryListProps) {
  if (entries.length === 0) {
    return <p className="text-muted-foreground text-sm">No oil change entries yet. Log your first one above.</p>;
  }

  return (
    <ul className="space-y-3">
      {entries.map((entry) => (
        <li key={entry.id} className="rounded-lg border border-white/10 bg-white/5 p-4 text-white">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-semibold">{new Date(entry.conducted_at).toLocaleDateString()}</span>
            <div className="flex items-center gap-2">
              {entry.mileage !== null && (
                <span className="text-muted-foreground text-xs">Mileage: {entry.mileage.toLocaleString()} km</span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  onEdit(entry);
                }}
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  onDelete(entry);
                }}
              >
                Delete
              </Button>
            </div>
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
