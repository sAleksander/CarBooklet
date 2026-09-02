import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";

interface FormFieldProps {
  id: string;
  name?: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  hint?: ReactNode;
  icon: ReactNode;
  endContent?: ReactNode;
}

export function FormField({
  id,
  name,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  error,
  hint,
  icon,
  endContent,
}: FormFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <span className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground">{icon}</span>
        {/* The control itself is ui/input.tsx, which is already fully tokenized.
            This wrapper keeps only what it adds: the label, the leading icon and
            the error slot. Error styling rides on aria-invalid, which the
            primitive handles — and which the hand-rolled version never set. */}
        <Input
          id={id}
          name={name ?? id}
          type={type}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          placeholder={placeholder}
          aria-invalid={!!error}
          className="pl-10"
        />
        {endContent}
      </div>
      {error ? (
        <p className="mt-1 flex items-center gap-1 text-xs text-status-bad-ink">
          <CircleAlert className="size-3" />
          {error}
        </p>
      ) : (
        hint
      )}
    </div>
  );
}
