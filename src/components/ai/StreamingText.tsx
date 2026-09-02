interface Props {
  text: string;
  isDone: boolean;
  error: string | null;
}

export function StreamingText({ text, isDone, error }: Props) {
  if (!text && !error && !isDone) return null;

  return (
    <div className="text-white/90">
      <div className="whitespace-pre-wrap">
        {text}
        {!isDone && !error && <span className="inline-block animate-pulse">▋</span>}
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
