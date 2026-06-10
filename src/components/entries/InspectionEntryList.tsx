import type { InspectionEntry } from "@/types";
import { Button } from "@/components/ui/button";

interface InspectionEntryListProps {
  entries: InspectionEntry[];
  onEdit: (entry: InspectionEntry) => void;
  onDelete: (entry: InspectionEntry) => void;
}

export function InspectionEntryList({ entries, onEdit, onDelete }: InspectionEntryListProps) {
  if (entries.length === 0) {
    return <p className="text-muted-foreground text-sm">No inspection entries yet. Log your first one above.</p>;
  }

  return (
    <ul className="space-y-3">
      {entries.map((entry) => (
        <li key={entry.id}>
          <a
            href={`/entries/${entry.id}`}
            className="block rounded-lg border border-white/10 bg-white/5 p-4 text-white transition-colors hover:bg-white/10"
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-semibold">{new Date(entry.conducted_at).toLocaleDateString()}</span>
              <div className="flex items-center gap-2">
                {entry.mileage !== null && (
                  <span className="text-muted-foreground text-xs">Mileage: {entry.mileage.toLocaleString()} km</span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onEdit(entry);
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onDelete(entry);
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
            {entry.result && (
              <p className="text-sm">
                <span className="text-muted-foreground font-medium">Result:</span>{" "}
                <span className={entry.result === "Passed" ? "text-green-400" : "text-red-400"}>{entry.result}</span>
              </p>
            )}
            {entry.next_inspection_date && (
              <p className="text-muted-foreground mt-1 text-xs">
                <span className="font-medium">Next due:</span>{" "}
                {new Date(entry.next_inspection_date).toLocaleDateString()}
              </p>
            )}
          </a>
        </li>
      ))}
    </ul>
  );
}
