---
change_id: light-dark-mode
title: Renault-inspired light and dark theme, replacing the starter palette
status: implementing
created: 2026-08-31
updated: 2026-09-02
archived_at: null
---

## Notes

Goal: replace the 10x-starter look with a deliberate Renault-inspired palette
(yellow / black / white) and make a real light mode possible. Today the app is
dark-only by accident, not by design.

### Structural findings (from a pre-plan pass over the code)

These are the reason this change is bigger than "swap some hex values":

1. **The current look is not in the tokens.** `src/styles/global.css:6-67` is
   still stock shadcn `neutral` (pure grayscale, zero chroma) and is barely used
   for app chrome. The visible identity comes from `bg-cosmic`
   (`global.css:107-109` — the starter's navy gradient) plus hardcoded utilities:
   `text-white`, `text-blue-100/70`, `bg-purple-600`, `bg-white/10`.
2. **31 files hardcode dark-only colors.** Regenerate the list with:
   `grep -rlE "(text|bg|border|ring|from|via|to)-(white|black|blue|purple|indigo|sky|pink|amber|red|emerald|green|yellow)[-/]" src`
3. **Light mode is currently impossible, not merely undefined.** `text-white` on a
   light background is unreadable, and the `.dark` block never fires because
   nothing sets that class. There is no theme toggle, no persistence, no
   `prefers-color-scheme` handling anywhere yet.
4. Rough split: ~80% token migration, ~20% palette choice.

### Hard constraint: the deadline traffic light

`src/components/DeadlineCard.astro:11-24` uses red / amber / green as **domain
semantics** (deadline status), not decoration. Renault yellow sits ~6 deg from
`amber-400`, so the brand color and the warning state collide directly. Resolved
by moving the warning state to orange (see tokens) — 33.7 deg of hue separation
and 0.21 of lightness separation from the brand yellow.

### The rule that shapes the whole palette

Renault yellow `#FFCC33` = `oklch(0.867 0.165 88.7)`. Measured:

- black on yellow — **13.94:1** (this is how Renault actually uses it)
- white on yellow — **1.51:1**, fails everything
- yellow on white — **1.46:1**, so it can never be a link, label, or icon in light mode

At L=0.867 this is inherent, not tunable. **Yellow is a surface, never text.**
Light mode therefore needs a second darkened yellow (`--accent-ink`) for the
cases where the brand color must be ink. In dark mode the problem disappears —
the same yellow reaches 12.71:1 on the black background.

### Proposed tokens

```css
:root {                                        .dark {
  --background: oklch(0.990 0.002 90);           --background: oklch(0.170 0.004 90);
  --foreground: oklch(0.160 0.005 90);           --foreground: oklch(0.970 0.002 90);
  --card: oklch(1 0 0);                          --card: oklch(0.215 0.005 90);
  --muted: oklch(0.960 0.004 90);                --muted: oklch(0.270 0.005 90);
  --muted-foreground: oklch(0.500 0.008 90);     --muted-foreground: oklch(0.720 0.006 90);
  --primary: oklch(0.867 0.165 88.7);            --primary: oklch(0.867 0.165 88.7);
  --primary-foreground: oklch(0.160 0.005 90);   --primary-foreground: oklch(0.170 0.004 90);
  --accent-ink: oklch(0.556 0.110 88.7);         --accent-ink: oklch(0.867 0.165 88.7);
  --destructive: oklch(0.550 0.210 27);          --destructive: oklch(0.680 0.190 25);
  --border: oklch(0.900 0.005 90);               --border: oklch(1 0 0 / 12%);
  --input: oklch(0.644 0.020 90);                --input: oklch(0.486 0.020 90);
  --ring: oklch(0.556 0.110 88.7);               --ring: oklch(0.867 0.165 88.7);
  /* deadline traffic light, replacing DeadlineCard's hardcoded classes */
  --status-ok:   oklch(0.600 0.150 150);         --status-ok:   oklch(0.720 0.160 155);
  --status-warn: oklch(0.658 0.160 55);          --status-warn: oklch(0.760 0.160 58);
  --status-bad:  oklch(0.600 0.210 25);          --status-bad:  oklch(0.700 0.190 25);
}
```

`--border` (decorative hairline) and `--input` (form controls, WCAG 1.4.11 needs
3:1) are **deliberately split** — one value cannot do both jobs on a white
background.

### Verified contrast (computed, not estimated)

| pair                               | light              | dark               |
| ---------------------------------- | ------------------ | ------------------ |
| body text fg/bg                    | 18.86:1            | 17.53:1            |
| muted text                         | 5.83:1             | 7.71:1             |
| CTA label on primary               | 12.90:1            | 12.71:1            |
| destructive on bg                  | 5.25:1             | 6.08:1             |
| input border (needs 3:1)           | 3.22:1             | 3.00:1             |
| status ok / warn / bad (needs 3:1) | 3.59 / 3.21 / 4.26 | 8.24 / 8.53 / 6.57 |

Nothing out of sRGB gamut. Values carry a small margin above threshold, so minor
tweaks are safe — but re-verify if any lightness is changed.

### Decisions already taken

- **Sidebar stays black in both modes**, with a yellow active indicator. This is
  on-brand _and_ means the existing always-dark decision at `global.css:31-32`
  does not have to be reopened — less migration, not more. (That comment's
  wording still needs updating, since "app has no dark-mode toggle" stops being
  true.)
- **`bg-cosmic` is deleted, not re-themed.** Renault's identity is flat
  black/white/yellow with no gradient. The 6 files using it collapse to
  `bg-background`. This removes the single most "starterish" element outright.
- **Use classic `#FFCC33`** (hue 88.7), not the post-2021 `#EFDF00` (hue 104) —
  the latter is 15 deg toward green, which walks it closer to the `--status-ok`
  color.

### Open questions for research / plan

- Theme toggle mechanics: where does the `.dark` class get set, how is the choice
  persisted, and how is the FOUC-on-SSR problem handled? The app is fully
  server-rendered (`output: "server"`), so this needs an inline pre-hydration
  script, not a React effect.
- Does the choice follow `prefers-color-scheme` by default, with an explicit
  override? (Recommended, but not yet decided.)
- Do the shadcn `ui/` primitives (`dialog`, `sheet`, `alert-dialog`) need
  changes, or do they already read from tokens once the hardcoded overrides in
  those three files are removed?
- Migration sequencing: is this one sweep, or tokens-first then per-route
  conversion? 31 files is large enough that a staged order probably matters.
