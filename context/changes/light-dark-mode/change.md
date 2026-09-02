---
change_id: light-dark-mode
title: Renault-inspired light and dark theme, replacing the starter palette
status: implemented
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

## Implementation notes

### Phase 1 (e9a0eb7)

- **Dark `--input` is `oklch(0.510 0.020 90)`, not the planned `0.486`.** The plan's
  table (`plan.md:838`) records 3.00 against a 3.0 threshold, but its own prose says
  the grounds are `--card`. Against `--card` the planned value measures **2.75** — the
  3.00 came from `--background`. Phase 3 puts auth inputs inside `bg-card` panels and
  asserts a 3:1 border, so the planned value would have shipped a known WCAG 1.4.11
  failure. 0.510 gives 3.05 on `--card` and 3.33 on `--background`.
  `--muted-foreground` has the same ground ambiguity but clears 4.5 either way
  (6.00/5.83 light, 7.06/7.71 dark), so it was left as planned.
- **The sidebar rename was not entirely byte-identical.** The 25 `var()` sites were.
  The car switcher also carried four raw `white` literals that Phase 7's gate would
  reject, so they moved onto sidebar tokens now: `border-white/10` →
  `border-sidebar-border` (identical), `bg-white/5` → `bg-sidebar-accent/60` (4.8% vs
  5%), `hover:bg-white/10` → `hover:bg-sidebar-accent` (8% vs 10%).
- **`MobileSidebarTrigger.tsx:33`'s `text-white/80` is deliberately deferred to Phase 3** —
  it sits on the mobile top bar, not inside the sidebar, so it belongs with its sibling
  at `AppLayout.astro:35`.
- **`--sidebar` keeps its navy tint** (`oklch(0.13 0.025 265)`), untouched because Phase 1
  promises no visual change. Phase 6 reuses `bg-sidebar` for a "flat black" hero, so the
  tint should be revisited there.
- **`/cars` is missing from the plan's final route inventory** (`plan.md:880`). The page
  and `components/cars/` are already fully tokenized (zero literals), but they render on
  `bg-cosmic`, so the "My Cars" heading is currently 1.07:1 — a pre-existing defect
  (1.09:1 before this change) that Phase 3 fixes by deleting `bg-cosmic`. Add `/cars` to
  the closing two-mode walkthrough.
- **`research.md:205`'s fence was retagged `astro` → `ts`.** It holds a bare frontmatter
  fragment, which Astro's parser rejects; lint-staged runs `prettier --write` over staged
  `*.md` and the pre-commit hook failed on it.

### Phase 2

- **The dev server wedges after edits that change the import graph.** Adding
  `@/lib/theme-preference` to `src/middleware.ts` made Vite re-optimize `deps_ssr`
  ("Re-optimizing dependencies because vite config has changed" → "optimized
  dependencies changed. reloading"), which briefly loads two copies of React and
  throws `Invalid hook call` / `Cannot read properties of null (reading 'useState')`
  in `SignInForm`. The server then serves **empty 200s** until restarted. Not caused
  by this change and self-healing on a fresh start — but expect it again in Phases 3–6,
  and restart `npm run dev` rather than debugging the page.
- **`class:list` rather than `class` on `<html>`**, because `astro/prefer-class-list-directive`
  warns otherwise. It emits no attribute when the value is `undefined`, so Phase 7's
  "act only when the class is absent" invariant is unaffected.
- The four `Layout.astro`-only routes correctly carry **no** theme toggle, per the plan's
  "What We're NOT Doing" — verified in the served HTML.

### Phase 4

- **Light `--status-warn` moved from `oklch(0.658 0.16 55)` to `oklch(0.638 0.158 55)`.**
  Criterion 4.8 asks whether the dots are discernible against their own 10% wash, and
  the warn dot measured **2.91:1** there — under 3:1 — even though it passes against
  `--card` (3.30), which is the ground the plan's table uses. The wash is what is
  actually adjacent to the dot, so the wash is the correct reference. The new value
  gives 3.13 on the wash, 3.57 on the card, and moves _further_ from brand yellow
  (2.37 vs 2.19). In gamut. `ok` (3.21) and `bad` (3.80) already passed and were left
  alone; dark mode is unaffected (6.58 / 6.74 / 5.29).
- **The light dashboard was unusable before this phase**, which the plan's sequencing
  intends but is worth recording as measured: heading 1.38:1, labels 1.09–1.13:1, links
  1.25:1, and `bg-white/10` / `border-white/10` panels compositing to _exactly_ the page
  colour (1.00:1) — i.e. no card at all. After: 18.86 / 6.00 / 4.76 with real cards.
- **4.6 caveat:** the test car has no entries, so only the `idle` state rendered live.
  The `ok` / `warn` / `bad` variants were verified by injecting the real cva class
  strings into the page and reading back computed styles — all four tones resolve to
  distinct values in both modes — not by rendering a real red/yellow/green deadline.

### Sidebar: theme-following (reverses a recorded decision)

At the user's request the sidebar now **follows the theme** instead of staying black in
both modes. This reverses a decision recorded twice — `change.md`'s "Decisions already
taken" and `plan.md`'s "What We're NOT Doing" — so the reasoning for the new shape:

- **Brand yellow cannot be the light-mode active indicator.** At 1.46:1 on white it is
  invisible as text. The light sidebar therefore uses `--accent-ink` (the darkened brand
  yellow) at **4.76:1**, which is precisely the case `--accent-ink` was introduced for.
  Dark mode keeps the brand yellow proper at 12.04:1 on the active chip.
- **The light active state is a WHITE chip on a warm-grey rail**, not a darker pill. A
  darker pill drove `--accent-ink` down to 3.56:1; inverting it to white lifts the same
  token to 4.76 with no new colour. Dark mode keeps the light wash (`white/8%`).
- **`--sidebar-muted-foreground` is new.** `text-sidebar-foreground/50` measured
  **4.14:1** on a light rail — a fail, and the same alpha-reduced-text anti-pattern this
  change removes everywhere else. The 14 `/50`, `/60`, `/70` usages collapse to one
  token: 6.34 light / 8.11 dark.
- **Dark `--sidebar` was neutralised** from the starter's navy `oklch(0.13 0.025 265)`
  (#040711) to `oklch(0.13 0.004 90)` (#080706), so the rail matches the warm-neutral
  palette instead of reading blue. Yellow contrast is unchanged (13.38 -> 13.37).

Verified pairs (rail / active chip):

| token                           |           light |          dark | needs |
| ------------------------------- | --------------: | ------------: | ----: |
| `--sidebar-foreground`          |   17.28 / 19.41 | 16.87 / 15.20 |   4.5 |
| `--sidebar-muted-foreground`    |     6.34 / 7.12 |   8.11 / 7.31 |   4.5 |
| `--sidebar-primary` (indicator) | 4.24 / **4.76** | 13.37 / 12.04 |   4.5 |

**Consequence for Phase 6:** the landing hero planned to reuse `bg-sidebar` /
`text-sidebar-foreground` for a "flat black section, identical in both modes". Those
tokens are now theme-following, so that plan no longer holds. Phase 6 must either let
the hero follow the theme too, or give it its own always-black values. Decide there.

### Phase 6

- **The landing hero follows the theme** rather than being flat black in both modes.
  The plan's approach reused `bg-sidebar` / `text-sidebar-foreground` for an
  always-black section; that stopped being possible once the sidebar became
  theme-following, and the user chose consistency over an always-black brand
  statement. The hero is `bg-background` / `text-foreground` with the yellow CTA
  carrying the brand. The secondary CTA uses `border-input`, not `border-border`:
  it is an interactive control, so its outline needs 3:1 (WCAG 1.4.11), which the
  decorative hairline does not meet.
- **Banner keeps its scoped CSS and references the custom properties directly**, so
  all three variants follow the theme with no `.dark` block in the component.
  Measured on the rendered page (10% wash over the page background):

  | variant | light ink / border | dark ink / border |
  | ------- | -----------------: | ----------------: |
  | info    |        5.47 / 4.38 |       6.15 / 4.62 |
  | warning |        5.20 / 3.22 |       6.11 / 4.87 |
  | error   |        5.52 / 3.93 |       5.39 / 4.22 |

  Thresholds 4.5 for ink, 3.0 for the border. All pass.

- **`/` redirects signed-in users to `/dashboard`**, so the landing page can only be
  seen signed out; it was verified through a clean Playwright context rather than the
  logged-in browser session.
- **Astro excludes `_`-prefixed files from routing.** Phase 1's `__token_probe.astro`
  was therefore never a route — it worked only because Tailwind's content scan is
  independent of routing. A probe page that must actually be served needs a normal name.

### Phase 7

- **The gate lives in `scripts/lint-colors.sh`, not a package.json one-liner.** The
  pattern deliberately avoids `\b`: this machine's `grep` is **ugrep**, which rejects
  `\b` as an empty sub-expression (it broke an earlier grep during Phase 1). Keeping
  it POSIX-safe means the same script runs here and under GNU grep in CI. It checks
  three literal forms — Tailwind palette utilities, raw hex, and `rgba(` — and
  excludes `src/components/ui/` wholesale.
- **Gate proven to fire** on a bare `text-white`, a suffixed `bg-blue-100/60`, and a
  raw hex, and proven NOT to fire on the four legitimate `ui/` literals
  (`button.tsx`'s contrast-locked `text-white`, the three `bg-black/50` scrims).
  A real commit carrying `text-white` was rejected by `.husky/pre-commit`; HEAD did
  not move. Ordered before `typecheck` so it fails in ~50 ms rather than after the
  slow checks.
- **No-flash evidence.** With no cookie and the OS set to dark, the class is already
  `dark` at navigation _commit_ — before paint — because the `is:inline` script is
  synchronous in `<head>`. With the OS light there is deliberately no class at all,
  since light is `:root`'s default.
- **Verified through Playwright's `prefers-color-scheme` emulation**, which is the
  only way to exercise the OS-preference paths: live OS switch flips the class with
  no reload; an explicit choice overrides the OS and survives a refresh; choosing
  System deletes the cookie and returns to following the OS.
