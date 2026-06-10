import type { InsuranceEntry } from "@/types";
import { Button } from "@/components/ui/button";

interface InsuranceEntryListProps {
  entries: InsuranceEntry[];
  onEdit: (entry: InsuranceEntry) => void;
  onDelete: (entry: InsuranceEntry) => void;
}

export function InsuranceEntryList({ entries, onEdit, onDelete }: InsuranceEntryListProps) {
  if (entries.length === 0) {
    return <p className="text-muted-foreground text-sm">No insurance entries yet. Log your first one above.</p>;
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
            {entry.insurer && (
              <p className="text-sm">
                <span className="text-muted-foreground font-medium">Insurer:</span> {entry.insurer}
              </p>
            )}
            {entry.policy_start_date && (
              <p className="text-muted-foreground mt-1 text-xs">
                <span className="font-medium">Policy from:</span>{" "}
                {new Date(entry.policy_start_date).toLocaleDateString()}
              </p>
            )}
            <p className="text-muted-foreground mt-1 text-xs">
              <span className="font-medium">Renewal:</span> {new Date(entry.renewal_date).toLocaleDateString()}
            </p>
          </a>
        </li>
      ))}
    </ul>
  );
}
