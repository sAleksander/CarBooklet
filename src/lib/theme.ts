// Domain vocabulary -> token vocabulary. One greppable place answering
// "what color is a warn state?", so the palette can move without touching the
// components that use it.
//
// TWO CROSS-FILE INVARIANTS, both of which fail silently:
//
// 1. Every token named below must exist in src/styles/global.css as a raw value
//    in BOTH `:root` and `.dark` AND as a `--color-*` alias in `@theme inline`.
//    A missing alias compiles the utility to nothing — no error, an unstyled
//    element. Edit global.css and this file together.
//
// 2. Class strings must be written out in FULL. Tailwind scans source text, so
//    `bg-status-warn` is found but `` `bg-status-${tone}` `` is not, and
//    generates no CSS. That is why every variant below repeats the prefix.
//
// The fill/ink split is load-bearing: the bare `--status-*` tokens clear 3:1 and
// are for dots and borders; the `-ink` tokens clear 4.5:1 and are for text.
// Using a fill value as text is a contrast failure, not a style preference.

import { cva } from "class-variance-authority";
import type { DeadlineStatus } from "@/types";

export type Tone = "ok" | "warn" | "bad" | "idle";

/**
 * Translates the database's deadline vocabulary into palette vocabulary.
 *
 * This mapper is the entire adaptation layer between the two: it is what lets
 * the warning state move off Renault yellow without a data migration, and why
 * `DeadlineStatus` keeps its "red" | "yellow" | "green" names in src/types.ts.
 */
export function toneForDeadline(status: DeadlineStatus): Tone {
  switch (status) {
    case "red":
      return "bad";
    case "yellow":
      return "warn";
    case "green":
      return "ok";
    case "no_data":
    case "no_next_date":
      return "idle";
  }
}

/** Inspection pass/fail. A second domain meaning sharing the status tokens. */
export function toneForResult(result: string | null): Tone {
  if (result === "Passed") return "ok";
  if (result === "Failed") return "bad";
  return "idle";
}

/** Card border + background wash for a status-bearing surface. */
export const statusSurface = cva("rounded-xl border", {
  variants: {
    tone: {
      ok: "border-status-ok/50 bg-status-ok/10",
      warn: "border-status-warn/50 bg-status-warn/10",
      bad: "border-status-bad/50 bg-status-bad/10",
      // Deliberately recessed rather than equal to a real card, so "no data"
      // is distinguishable from a card that simply has nothing urgent in it.
      idle: "border-border bg-muted/40",
    },
  },
  defaultVariants: { tone: "idle" },
});

/** The status indicator dot. A fill, so it uses the 3:1 tokens. */
export const statusDot = cva("h-2.5 w-2.5 rounded-full", {
  variants: {
    tone: {
      ok: "bg-status-ok",
      warn: "bg-status-warn",
      bad: "bg-status-bad",
      idle: "bg-status-idle/50",
    },
  },
  defaultVariants: { tone: "idle" },
});

/** Status rendered as text, so it uses the 4.5:1 ink tokens. */
export const statusText = cva("", {
  variants: {
    tone: {
      ok: "text-status-ok-ink",
      warn: "text-status-warn-ink",
      bad: "text-status-bad-ink",
      idle: "text-muted-foreground",
    },
  },
  defaultVariants: { tone: "idle" },
});

/**
 * Opaque content surfaces, replacing the starter's translucent glass panels.
 * Colour and shape only — consumers own their own padding.
 */
export const surface = cva("border border-border bg-card", {
  variants: {
    level: {
      panel: "rounded-2xl",
      row: "rounded-lg",
    },
  },
  defaultVariants: { level: "panel" },
});

/** The clickable entry row shared by all four entry-type lists. */
export const entryRow = cva("block rounded-lg border border-border bg-card p-4 transition-colors hover:bg-accent");
